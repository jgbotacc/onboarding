"""Neo4j store using Junior Dev's graph model (neo4j/schema.cypher, queries.cypher)."""
import json

from neo4j import GraphDatabase

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
FIELDS_Q = """
MERGE (c:Client {id:$clientId})
MERGE (d:Document {id:$clientId + '-doc'}) MERGE (c)-[:UPLOADED]->(d)
WITH d UNWIND $fields AS v
MATCH (fd:FieldDef {key:v.key})
MERGE (d)-[:HAS_FIELD]->(fl:Field {key:v.key, docId:d.id}) SET fl.value=v.value, fl.valid=true
MERGE (fl)-[:OF_TYPE]->(fd)"""


class Neo4jStore:
    kind = "neo4j"

    def __init__(self, uri, user, pw):
        self.drv = GraphDatabase.driver(uri, auth=(user, pw))
        self.drv.verify_connectivity()

    def _run(self, q, **p):
        with self.drv.session() as s:
            return list(s.run(q, **p))

    def save(self, st: dict):
        self._run("MERGE (c:Client {id:$id}) SET c.name=$name, c.status=$status, c.state=$state",
                  id=st["id"], name=st["fields"].get("company_name", ""), status=st["status"],
                  state=json.dumps(st))
        if st["fields"]:
            self._run(FIELDS_Q, clientId=st["id"],
                      fields=[{"key": k, "value": v} for k, v in st["fields"].items()])

    def load(self, sid):
        rows = self._run("MATCH (c:Client {id:$id}) RETURN c.state AS s", id=sid)
        return json.loads(rows[0]["s"]) if rows and rows[0]["s"] else None

    def event(self, sid, kind, payload):
        if kind == "round":
            self._run(ROUND_Q, clientId=sid, imageUrls=payload["images"])
        elif kind == "review":
            self._run(FEEDBACK_Q, clientId=sid, feedback=payload.get("feedback") or "",
                      accepted=bool(payload.get("accepted")))
