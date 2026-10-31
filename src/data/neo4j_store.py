"""Neo4j store using the graph model (neo4j/schema.cypher, queries.cypher)."""
import json
import os

import httpx

from src.shared import relay

ROUND_Q = """
MATCH (c:Client {id:$clientId})
OPTIONAL MATCH (c)-[:HAS_ROUND]->(prev:GenerationRound) WHERE NOT (prev)-[:NEXT]->()
WITH c, prev, coalesce(prev.n,0)+1 AS n
CREATE (g:GenerationRound {id:randomUUID(), n:n, imageUrls:$imageUrls, accepted:false, createdAt:datetime()})
MERGE (c)-[:HAS_ROUND]->(g)
FOREACH (_ IN CASE WHEN prev IS NULL THEN [] ELSE [1] END | MERGE (prev)-[:NEXT]->(g))
SET c.status='awaiting_review'
RETURN g.id, g.n"""
FEEDBACK_Q = """
MATCH (c:Client {id:$clientId})-[:HAS_ROUND]->(g:GenerationRound) WHERE NOT (g)-[:NEXT]->()
SET g.feedback=$feedback, g.accepted=$accepted
WITH c, g
FOREACH (_ IN CASE WHEN g.accepted THEN [1] ELSE [] END | SET c.status='accepted')
FOREACH (_ IN CASE WHEN NOT g.accepted AND g.n >= 3 THEN [1] ELSE [] END |
  MERGE (c)-[:ESCALATED_TO]->(:HumanHandoff {id:c.id+'-handoff', reason:'3 rounds not accepted', createdAt:datetime()})
  SET c.status='handed_off')
FOREACH (_ IN CASE WHEN NOT g.accepted AND g.n < 3 THEN [1] ELSE [] END | SET c.status='generating')
RETURN c.status"""
REFS_Q = """
MERGE (c:Client {id:$clientId})
WITH c UNWIND $refs AS r
MERGE (ri:ReferenceImage {id:r.id})
  SET ri.url='/media/' + split(r.path, '/')[-1], ri.path=r.path, ri.filename=r.filename, ri.uploadedAt=datetime()
MERGE (c)-[:PROVIDED]->(ri)"""
FIELDS_Q = """
MERGE (c:Client {id:$clientId})
MERGE (d:Document {id:$clientId + '-doc'}) MERGE (c)-[:UPLOADED]->(d)
WITH d UNWIND $fields AS v
MATCH (fd:FieldDef {key:v.key})
MERGE (d)-[:HAS_FIELD]->(fl:Field {key:v.key, docId:d.id}) SET fl.value=v.value, fl.valid=v.valid, fl.issue=v.issue
MERGE (fl)-[:OF_TYPE]->(fd)"""


class Neo4jStore:
    kind = "neo4j"

    def __init__(self, uri=None, user=None, pw=None, via_relay=False):
        """Uses the HTTPS Query API (port 443): Bolt port 7687 is blocked on the box and on Daytona.
        With via_relay, queries go through the Vercel relay, which adds the Aura credentials."""
        self.http = httpx.Client(timeout=20)
        self.via_relay = via_relay
        if via_relay:
            self.kind = "neo4j (relay)"
            self.url, self.auth, self.hdrs = relay.url("/api/neo4j"), None, relay.headers()
        else:
            host = uri.split("://", 1)[1].split(":")[0].split("/")[0]
            db = os.getenv("NEO4J_DATABASE") or "neo4j"
            self.url, self.auth, self.hdrs = f"https://{host}/db/{db}/query/v2", (user, pw), {}
        self._run("RETURN 1 AS ok")

    def _run(self, q, **p):
        r = self.http.post(self.url, auth=self.auth, headers=self.hdrs, json={"statement": q, "parameters": p})
        body = r.json()
        if r.status_code >= 400 or body.get("errors"):
            raise RuntimeError(f"Neo4j query failed: {body.get('errors') or r.status_code}")
        data = body.get("data") or {}
        return [dict(zip(data.get("fields", []), row)) for row in data.get("values", [])]

    def save(self, st: dict):
        self._run("MERGE (c:Client {id:$id}) SET c.name=$name, c.status=$status, c.state=$state, "
                  "c.updatedAt=datetime(), c.resumeToken=$token",
                  id=st["id"], name=st["fields"].get("business_name", ""), status=st["status"],
                  state=json.dumps(st), token=st.get("resume_token"))
        if st["fields"]:
            self._run(FIELDS_Q, clientId=st["id"],
                      fields=[{"key": k, "value": v, "valid": k not in st.get("invalid", {}),
                               "issue": st.get("invalid", {}).get(k, {}).get("message")}
                              for k, v in st["fields"].items()])

    def list_states(self):
        rows = self._run("MATCH (c:Client) WHERE c.state IS NOT NULL RETURN c.state AS s")
        return [json.loads(r["s"]) for r in rows]

    def find_by_token(self, token):
        rows = self._run("MATCH (c:Client {resumeToken:$t}) RETURN c.state AS s", t=token)
        return json.loads(rows[0]["s"]) if rows and rows[0]["s"] else None

    def load(self, sid):
        rows = self._run("MATCH (c:Client {id:$id}) RETURN c.state AS s", id=sid)
        return json.loads(rows[0]["s"]) if rows and rows[0]["s"] else None

    def event(self, sid, kind, payload):
        if kind == "decision":
            self._run("MATCH (c:Client {id:$id}) CREATE (d:Decision {id:$did, decision:$decision, fields:$fields, "
                      "note:$note, createdAt:datetime()}) MERGE (c)-[:HAS_DECISION]->(d)", id=sid, did=payload["id"],
                      decision=payload["decision"], fields=payload["fields"], note=payload["note"] or "")
        elif kind == "email":
            self._run("MATCH (c:Client {id:$id}) CREATE (e:Email {to:$to, subject:$subject, body:$body, status:$status, emailId:$eid, "
                      "sentAt:$sent_at}) MERGE (c)-[:SENT_EMAIL]->(e)", id=sid, **{k: payload[k] for k in
                      ("to", "subject", "body", "status", "sent_at")}, eid=payload.get("id") or "")
        elif kind == "refs":
            self._run(REFS_Q, clientId=sid, refs=payload["refs"])
        elif kind == "round":
            self._run(ROUND_Q, clientId=sid, imageUrls=payload["images"])
        elif kind == "review":
            self._run(FEEDBACK_Q, clientId=sid, feedback=payload.get("feedback") or "",
                      accepted=bool(payload.get("accepted")))
