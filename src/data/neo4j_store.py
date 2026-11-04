"""Neo4j store using the graph model (neo4j/schema.cypher, queries.cypher)."""
import json
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import httpx

from src.shared import relay
from src.shared.security import token_hash

_UNSET = object()

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
SAVE_Q = """
MERGE (c:Client {id:$id})
SET c.name=$name, c.status=$status, c.state=$state, c.updatedAt=datetime(), c.resumeToken=$token
WITH c
CALL {
  WITH c
  WITH c WHERE size($fields) > 0
  MERGE (d:Document {id:c.id + '-doc'})
  MERGE (c)-[:UPLOADED]->(d)
  WITH d UNWIND $fields AS v
  MATCH (fd:FieldDef {key:v.key})
  MERGE (d)-[:HAS_FIELD]->(fl:Field {key:v.key, docId:d.id})
  SET fl.value=v.value, fl.valid=v.valid, fl.issue=v.issue
  MERGE (fl)-[:OF_TYPE]->(fd)
}
RETURN c.id AS id"""
TRACE_RET = ("t.id AS id, t.sessionId AS session_id, t.step AS step, t.model AS model, t.ok AS ok, "
             "t.latencyMs AS latency_ms, t.costSgd AS cost_sgd, t.error AS error, t.at AS at")
DRAFT_COLS = ("id", "session_id", "run_id", "parent_id", "parent_kind", "preset", "width",
              "height", "marketer_prompt", "chips", "style_title", "style", "prompt", "url",
              "status", "error", "author", "starred", "pinned_to", "pinned_consult_id",
              "sent_at", "sent_by", "created_at")
DRAFT_RET = ("d.id AS id, d.session_id AS session_id, d.run_id AS run_id, d.parent_id AS parent_id, "
             "d.parent_kind AS parent_kind, d.preset AS preset, d.width AS width, d.height AS height, "
             "d.marketer_prompt AS marketer_prompt, d.chips AS chips, d.style_title AS style_title, "
             "d.style AS style, d.prompt AS prompt, d.url AS url, d.status AS status, d.error AS error, "
             "d.author AS author, d.starred AS starred, d.pinned_to AS pinned_to, "
             "d.pinned_consult_id AS pinned_consult_id, d.sent_at AS sent_at, d.sent_by AS sent_by, "
             "toString(d.created_at) AS created_at")
FEEDBACK_KINDS = ("heart", "reject", "approve", "changes")
FEEDBACK_RET = ("f.id AS id, f.session_id AS session_id, f.draft_id AS draft_id, f.kind AS kind, "
                "f.note AS note, f.actor AS actor, toString(f.created_at) AS created_at")
RECORD_FEEDBACK_Q = f"""
MATCH (d:Draft {{id:$did, session_id:$sid}}) WHERE d.sent_at IS NOT NULL
CREATE (f:Feedback {{id:randomUUID(), session_id:$sid, draft_id:$did, kind:$kind, note:$note,
  actor:$actor, created_at:datetime()}})
MERGE (c:Client {{id:$sid}}) MERGE (c)-[:GAVE_FEEDBACK]->(f)
FOREACH (_ IN CASE WHEN $kind = 'heart' THEN [1] ELSE [] END |
  MERGE (c)-[:SHORTLISTED]->(d))
WITH c, d, f
OPTIONAL MATCH (c)-[sl:SHORTLISTED]->(d) WHERE $kind = 'reject'
DELETE sl
WITH c, f
CREATE (a:Audit {{id:randomUUID(), sessionId:$sid, actor:$actor, action:'feedback_' + $kind,
  target:f.id, details:$details, at:datetime()}})
MERGE (c)-[:AUDITED]->(a)
RETURN {FEEDBACK_RET}"""
SHARE_RET = ("t.id AS id, t.session_id AS session_id, t.created_by AS created_by, "
             "toString(t.created_at) AS created_at, toString(t.expires_at) AS expires_at, "
             "toString(t.revoked_at) AS revoked_at, toString(t.used_at) AS used_at")
ISSUE_SHARE_Q = f"""
MERGE (c:Client {{id:$sid}})
CREATE (t:ShareToken {{id:$tid, session_id:$sid, token_hash:$hash, created_by:$actor,
  created_at:datetime(), expires_at:datetime($expires), revoked_at:null, used_at:null}})
MERGE (c)-[:HAS_SHARE]->(t)
CREATE (a:Audit {{id:randomUUID(), sessionId:$sid, actor:$actor, action:'share_issued',
  target:$tid, details:$details, at:datetime()}})
MERGE (c)-[:AUDITED]->(a)
RETURN t.id AS id, toString(t.expires_at) AS expires_at"""
REVOKE_SHARE_Q = f"""
MATCH (t:ShareToken {{id:$tid}})
SET t.revoked_at = coalesce(t.revoked_at, datetime($now))
WITH t
MATCH (c:Client {{id:t.session_id}})
CREATE (a:Audit {{id:randomUUID(), sessionId:t.session_id, actor:$actor, action:'share_revoked',
  target:$tid, details:$details, at:datetime()}})
MERGE (c)-[:AUDITED]->(a)
RETURN {SHARE_RET}"""
RESERVE_DRAFTS_Q = """
MERGE (c:Client {id:$sid})
WITH c
OPTIONAL MATCH (c)-[:HAS_DRAFT]->(d:Draft) WHERE d.status IN ['reserved','ok']
WITH c, count(d) AS cnt WHERE cnt + size($rows) <= $cap
UNWIND $rows AS r
CREATE (nd:Draft {id:coalesce(r.id, randomUUID()), session_id:$sid, run_id:r.run_id,
  parent_id:r.parent_id, parent_kind:r.parent_kind, preset:r.preset, width:r.width, height:r.height,
  marketer_prompt:r.marketer_prompt, chips:r.chips, style_title:r.style_title, style:r.style,
  prompt:r.prompt, url:r.url, status:'reserved', error:r.error, author:r.author,
  starred:toInteger(coalesce(r.starred, 0)), pinned_to:r.pinned_to,
  pinned_consult_id:r.pinned_consult_id, sent_at:r.sent_at, sent_by:r.sent_by, created_at:datetime()})
MERGE (c)-[:HAS_DRAFT]->(nd)
RETURN nd.id AS id"""


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
        bad = st.get("invalid", {})
        self._run(SAVE_Q, id=st["id"], name=st["fields"].get("business_name", ""), status=st["status"],
                  state=json.dumps(st), token=st.get("resume_token"),
                  fields=[{"key": k, "value": v, "valid": k not in bad,
                           "issue": (bad.get(k) or {}).get("message")} for k, v in st["fields"].items()])

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

    def add_looks(self, sid, round_n, looks: list[dict], source="agent"):
        self._run("MERGE (c:Client {id:$sid}) WITH c UNWIND $looks AS l MERGE (k:Look {id:l.id}) "
                  "SET k.round=$round, k.url=l.url, k.title=l.title, k.brief=l.brief, k.selected=0, "
                  "k.source=coalesce(l.source, $source), "
                  "k.createdAt=coalesce(k.createdAt, datetime()) MERGE (c)-[:SHOWN]->(k)",
                  sid=sid, round=round_n, source=source,
                  looks=[{"id": l.get("id"), "url": l.get("url"), "title": l.get("title"),
                          "brief": l.get("brief"), "source": l.get("source")} for l in looks])

    def mark_looks(self, sid, ids: list[str]):
        if not ids:
            return
        self._run("MATCH (c:Client {id:$sid})-[:SHOWN]->(l:Look) WHERE l.id IN $ids SET l.selected=1",
                  sid=sid, ids=list(ids))

    def looks(self, sid=None) -> list[dict]:
        q = "MATCH (c:Client)-[:SHOWN]->(l:Look)"
        p: dict = {}
        if sid is not None:
            q += " WHERE c.id=$sid"
            p["sid"] = sid
        q += (" RETURN c.id AS session_id, l.id AS id, l.round AS round, l.url AS url, l.title AS title, "
              "l.brief AS brief, coalesce(l.source, 'agent') AS source, l.selected AS selected, "
              "toString(l.createdAt) AS created_at ORDER BY l.round, l.createdAt")
        rows = self._run(q, **p)
        for r in rows:
            r["selected"] = int(r["selected"] or 0)
        return rows

    @staticmethod
    def _draft_row(row: dict) -> dict:
        d = {k: row.get(k) for k in DRAFT_COLS}
        try:
            chips = json.loads(d["chips"]) if d["chips"] else None
            d["chips"] = chips if isinstance(chips, list) else d["chips"]
        except (ValueError, TypeError):
            pass
        if d["starred"] is not None:
            try:
                d["starred"] = int(d["starred"])
            except (ValueError, TypeError):
                pass
        return d

    @staticmethod
    def _draft_params(sid, r: dict) -> dict:
        chips = r.get("chips")
        if isinstance(chips, (list, dict)):
            chips = json.dumps(chips)
        return {"id": r.get("id") or uuid.uuid4().hex, "run_id": r.get("run_id"),
                "parent_id": r.get("parent_id"), "parent_kind": r.get("parent_kind"),
                "preset": r.get("preset"), "width": r.get("width"), "height": r.get("height"),
                "marketer_prompt": r.get("marketer_prompt"), "chips": chips,
                "style_title": r.get("style_title"), "style": r.get("style"),
                "prompt": r.get("prompt"), "url": r.get("url"), "error": r.get("error"),
                "author": r.get("author"), "starred": int(bool(r.get("starred", 0))),
                "pinned_to": r.get("pinned_to"), "pinned_consult_id": r.get("pinned_consult_id"),
                "sent_at": r.get("sent_at"), "sent_by": r.get("sent_by")}

    def reserve_drafts(self, sid, rows: list[dict], cap=9) -> list[str] | None:
        """One conditional statement: create the new Draft nodes only when the
        count of status in ('reserved','ok') plus len(rows) fits within cap."""
        params = [self._draft_params(sid, r) for r in rows]
        got = self._run(RESERVE_DRAFTS_Q, sid=sid, cap=cap, rows=params)
        if not got:
            return None
        return [r["id"] for r in got]

    def finish_draft(self, id, url, status, error=None) -> dict | None:
        rows = self._run(f"MATCH (d:Draft {{id:$id}}) SET d.url=$url, d.status=$status, "
                         f"d.error=$error RETURN {DRAFT_RET}",
                         id=id, url=url, status=status, error=error)
        return self._draft_row(rows[0]) if rows else None

    def drafts(self, sid) -> list[dict]:
        rows = self._run(f"MATCH (c:Client {{id:$sid}})-[:HAS_DRAFT]->(d:Draft) RETURN {DRAFT_RET} "
                         "ORDER BY d.created_at, d.id", sid=sid)
        return [self._draft_row(r) for r in rows]

    def get_draft(self, id) -> dict | None:
        rows = self._run(f"MATCH (d:Draft {{id:$id}}) RETURN {DRAFT_RET}", id=id)
        return self._draft_row(rows[0]) if rows else None

    def set_draft_flags(self, id, starred=None, pinned_to=_UNSET,
                        pinned_consult_id=_UNSET) -> dict | None:
        sets, params = [], {"id": id}
        if starred is not None:
            sets.append("d.starred=$starred")
            params["starred"] = int(bool(starred))
        if pinned_to is not _UNSET:
            sets.append("d.pinned_to=$pinned_to")
            params["pinned_to"] = pinned_to
        if pinned_consult_id is not _UNSET:
            sets.append("d.pinned_consult_id=$pinned_consult_id")
            params["pinned_consult_id"] = pinned_consult_id
        q = "MATCH (d:Draft {id:$id})"
        if sets:
            q += " SET " + ", ".join(sets)
        rows = self._run(q + f" RETURN {DRAFT_RET}", **params)
        return self._draft_row(rows[0]) if rows else None

    def mark_draft_sent(self, id, actor, at) -> dict | None:
        rows = self._run(f"MATCH (d:Draft {{id:$id}}) SET d.sent_at=$at, d.sent_by=$actor "
                         f"RETURN {DRAFT_RET}", id=id, actor=actor, at=at)
        return self._draft_row(rows[0]) if rows else None

    def sweep_stale_drafts(self, sid, older_than_s=600) -> int:
        rows = self._run("MATCH (c:Client {id:$sid})-[:HAS_DRAFT]->(d:Draft) "
                         "WHERE d.status='reserved' AND d.created_at < datetime() - duration({seconds:$older}) "
                         "SET d.status='failed', d.error='timed out' RETURN count(d) AS n",
                         sid=sid, older=int(older_than_s))
        if not rows:
            return 0
        try:
            return int(rows[0]["n"])
        except (ValueError, TypeError, KeyError):
            return 0

    def record_feedback(self, sid, draft_id, kind, note, actor) -> dict:
        """One Cypher statement: feedback node, shortlist edge add/remove, audit node.

        Validates kind (and the change-request note) in Python and the sent
        draft in Cypher; empty result means the draft isn't sent for this
        session. Raises ValueError either way.
        """
        if kind not in FEEDBACK_KINDS:
            raise ValueError(f"Unknown feedback kind: {kind!r}.")
        text = (note or "").strip()
        if kind == "changes":
            if not text:
                raise ValueError("A short note is required for a change request.")
            if len(text) > 500:
                raise ValueError("Note is too long (max 500 chars).")
            note = text
        else:
            note = None
        details = {"draft_id": draft_id}
        if note is not None:
            details["note"] = note
        rows = self._run(RECORD_FEEDBACK_Q, sid=sid, did=draft_id, kind=kind,
                         note=note, actor=actor, details=json.dumps(details))
        if not rows:
            raise ValueError("Draft not found.")
        return dict(rows[0])

    def feedback_for(self, sid) -> list[dict]:
        rows = self._run(f"MATCH (f:Feedback {{session_id:$sid}}) RETURN {FEEDBACK_RET} "
                         "ORDER BY f.created_at, f.id", sid=sid)
        return [dict(r) for r in rows]

    def shortlist_add(self, sid, draft_id, actor) -> list[str]:
        self._run("MERGE (c:Client {id:$sid}) WITH c MATCH (d:Draft {id:$did, session_id:$sid}) "
                  "MERGE (c)-[sl:SHORTLISTED]->(d) ON CREATE SET sl.created_at=datetime()",
                  sid=sid, did=draft_id)
        return self.shortlist_for(sid)

    def shortlist_remove(self, sid, draft_id) -> list[str]:
        self._run("MATCH (:Client {id:$sid})-[sl:SHORTLISTED]->(:Draft {id:$did}) DELETE sl",
                  sid=sid, did=draft_id)
        return self.shortlist_for(sid)

    def shortlist_for(self, sid) -> list[str]:
        rows = self._run("MATCH (:Client {id:$sid})-[sl:SHORTLISTED]->(d:Draft) "
                         "RETURN d.id AS id ORDER BY sl.created_at, d.id", sid=sid)
        return [r["id"] for r in rows]

    def issue_share_token(self, sid, actor, days=7) -> tuple[str, str]:
        """One Cypher statement: token node plus the audit node.

        Returns (id, token). The plaintext token is returned once and never
        stored; the audit row holds only the id and expiry, never token or hash.
        """
        token, tid = secrets.token_urlsafe(32), uuid.uuid4().hex
        expires = (datetime.now(timezone.utc) + timedelta(days=int(days))).isoformat(timespec="seconds")
        rows = self._run(ISSUE_SHARE_Q, sid=sid, tid=tid, hash=token_hash(token),
                         actor=actor, expires=expires,
                         details=json.dumps({"expires_at": expires}))
        if not rows:
            raise RuntimeError("Share token issue failed.")
        return tid, token

    def find_share_token(self, token: str) -> dict | None:
        """Hash the token, then check session, expiry and revoked_at. None when
        unknown or revoked (so a revoked link reads exactly like a made-up one)."""
        rows = self._run(f"MATCH (t:ShareToken {{token_hash:$hash}}) RETURN {SHARE_RET}",
                         hash=token_hash(token))
        if not rows:
            return None
        d = dict(rows[0])
        if d["revoked_at"]:
            return None
        return d

    def mark_share_used(self, tid, at=None) -> None:
        self._run("MATCH (t:ShareToken {id:$tid}) "
                  "SET t.used_at = coalesce(t.used_at, datetime($at))",
                  tid=tid, at=at or datetime.now(timezone.utc).isoformat(timespec="seconds"))

    def revoke_share_token(self, tid, actor) -> dict | None:
        now = datetime.now(timezone.utc).isoformat(timespec="seconds")
        rows = self._run(REVOKE_SHARE_Q, tid=tid, actor=actor, now=now,
                         details=json.dumps({"revoked_at": now}))
        return dict(rows[0]) if rows else None

    def shares_for(self, sid) -> list[dict]:
        """Token id, expiry and status per session; never hashes or tokens."""
        rows = self._run(f"MATCH (t:ShareToken {{session_id:$sid}}) RETURN {SHARE_RET} "
                         "ORDER BY t.created_at, t.id", sid=sid)
        return [dict(r) for r in rows]

    def sweep_expired_tokens(self) -> int:
        """Delete rows past expiry. Returns the count removed."""
        rows = self._run("MATCH (t:ShareToken) WHERE t.expires_at <= datetime() "
                         "DETACH DELETE t RETURN count(t) AS n")
        if not rows:
            return 0
        try:
            return int(rows[0]["n"])
        except (ValueError, TypeError, KeyError):
            return 0

    def save_consult(self, card: dict):
        self._run("MERGE (c:Client {id:$sid}) MERGE (k:Consult {id:$cid}) "
                  "SET k.status=$status, k.card=$card, k.approvedBy=$approvedBy, k.decidedAt=$decidedAt, "
                  "k.createdAt=coalesce(k.createdAt, datetime()) MERGE (c)-[:NEEDS_CONSULT]->(k)",
                  sid=card.get("session_id"), cid=card["id"], status=card.get("status"),
                  card=json.dumps(card), approvedBy=card.get("approved_by"), decidedAt=card.get("decided_at"))

    def consults(self) -> list[dict]:
        rows = self._run("MATCH (k:Consult) RETURN k.card AS card ORDER BY k.createdAt DESC")
        return [json.loads(r["card"]) for r in rows if r["card"]]

    def get_consult(self, cid) -> dict | None:
        rows = self._run("MATCH (k:Consult {id:$cid}) RETURN k.card AS card", cid=cid)
        return json.loads(rows[0]["card"]) if rows and rows[0]["card"] else None

    def audit(self, sid, actor, action, target=None, details: dict | None = None):
        base = "MERGE (c:Client {id:$sid})" if sid is not None else "MERGE (c:System {id:'system'})"
        self._run(base + " CREATE (a:Audit {id:randomUUID(), sessionId:$sid, actor:$actor, action:$action, "
                  "target:$target, details:$details, at:datetime()}) MERGE (c)-[:AUDITED]->(a)",
                  sid=sid, actor=actor, action=action, target=target,
                  details=json.dumps(details) if details is not None else None)

    def audit_log(self, sid=None, limit=200) -> list[dict]:
        q = "MATCH (a:Audit)"
        p: dict = {"limit": limit}
        if sid is not None:
            q += " WHERE a.sessionId=$sid"
            p["sid"] = sid
        q += (" RETURN a.id AS id, a.sessionId AS session_id, a.actor AS actor, a.action AS action, "
              "a.target AS target, a.details AS details, toString(a.at) AS at ORDER BY a.at DESC LIMIT $limit")
        out = []
        for r in self._run(q, **p):
            r["details"] = json.loads(r["details"]) if r["details"] else None
            out.append(r)
        return out

    def trace(self, row: dict):
        base = ("MERGE (c:Client {id:$sid})" if row.get("session_id") is not None
                else "MERGE (c:System {id:'system'})")
        self._run(base + " CREATE (t:Trace {id:randomUUID(), sessionId:$sid, step:$step, model:$model, ok:$ok, "
                  "latencyMs:$ms, costSgd:$cost, error:$error, at:$at}) MERGE (c)-[:TRACED]->(t)",
                  sid=row.get("session_id"), step=row.get("step"), model=row.get("model"),
                  ok=bool(row.get("ok")), ms=row.get("latency_ms"), cost=row.get("cost_sgd", 0.0),
                  error=row.get("error"), at=row.get("at"))

    def traces(self, sid=None, limit=200) -> list[dict]:
        q = "MATCH (t:Trace)"
        p: dict = {"limit": limit}
        if sid is not None:
            q += " WHERE t.sessionId=$sid"
            p["sid"] = sid
        rows = self._run(q + f" RETURN {TRACE_RET} ORDER BY t.at DESC LIMIT $limit", **p)
        for r in rows:
            r["ok"] = bool(r["ok"])
        return rows

    def all_traces(self) -> list[dict]:
        rows = self._run(f"MATCH (t:Trace) RETURN {TRACE_RET} ORDER BY t.at DESC")
        for r in rows:
            r["ok"] = bool(r["ok"])
        return rows

    def add_eval(self, kind, score, n, details: dict):
        self._run("CREATE (e:Eval {kind:$kind, score:$score, n:$n, details:$details, at:datetime()})",
                  kind=kind, score=score, n=n, details=json.dumps(details))

    def latest_evals(self) -> dict:
        rows = self._run("MATCH (e:Eval) WITH e ORDER BY e.at DESC WITH e.kind AS kind, collect(e)[0] AS e "
                         "RETURN e.kind AS kind, e.score AS score, e.n AS n, e.details AS details, "
                         "toString(e.at) AS at")
        return {r["kind"]: {"kind": r["kind"], "score": r["score"], "n": r["n"],
                            "details": json.loads(r["details"]) if r["details"] else None, "at": r["at"]}
                for r in rows}

    def events_for(self, sid) -> list[dict]:
        return []  # no generic Event nodes in the graph model
