"""Neo4j store using the graph model (neo4j/schema.cypher, queries.cypher)."""
import json
import os
import uuid

import httpx

from src.shared import relay

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

    _BOARD_COLS = ("session_id", "version", "colours", "tone_words", "style_words",
                   "summary", "photos", "status", "approved_by", "decided_at",
                   "note", "created_at", "updated_at")
    BOARD_RET = ("b.session_id AS session_id, b.version AS version, b.colours AS colours, "
                 "b.tone_words AS tone_words, b.style_words AS style_words, b.summary AS summary, "
                 "b.photos AS photos, b.status AS status, b.approved_by AS approved_by, "
                 "b.decided_at AS decided_at, b.note AS note, "
                 "toString(b.created_at) AS created_at, toString(b.updated_at) AS updated_at")

    @staticmethod
    def _board_row(row: dict) -> dict:
        d = {k: row.get(k) for k in Neo4jStore._BOARD_COLS}
        for k in ("colours", "tone_words", "style_words", "photos"):
            v = d.get(k)
            if isinstance(v, str):
                try:
                    v = json.loads(v)
                except (ValueError, TypeError):
                    v = []
            d[k] = v if isinstance(v, list) else []
        try:
            d["version"] = int(d.get("version") or 0)
        except (ValueError, TypeError):
            d["version"] = 0
        return d

    @staticmethod
    def _board_params(board: dict) -> dict:
        def _js(v):
            return json.dumps(v if isinstance(v, list) else [])
        return {"colours": _js(board.get("colours")), "tone_words": _js(board.get("tone_words")),
                "style_words": _js(board.get("style_words")), "summary": board.get("summary") or "",
                "photos": _js(board.get("photos")), "status": board.get("status") or "pending_review",
                "approved_by": board.get("approved_by"), "decided_at": board.get("decided_at"),
                "note": board.get("note")}

    def save_brand_board(self, sid, board: dict) -> dict | None:
        """One statement: upsert the client's BrandBoard node (version +1 per new read)."""
        rows = self._run(
            "MERGE (c:Client {id:$sid}) "
            "MERGE (c)-[:HAS_BOARD]->(b:BrandBoard {session_id:$sid}) "
            "SET b.version=coalesce($version, coalesce(b.version, 0) + 1), "
            "b.colours=$colours, b.tone_words=$tone_words, b.style_words=$style_words, "
            "b.summary=$summary, b.photos=$photos, b.status=$status, b.approved_by=$approved_by, "
            "b.decided_at=$decided_at, b.note=$note, b.updated_at=datetime(), "
            "b.created_at=coalesce(b.created_at, datetime()) "
            f"RETURN {self.BOARD_RET}",
            sid=sid, version=int(board["version"]) if board.get("version") else None,
            **self._board_params(board))
        return self._board_row(rows[0]) if rows else None

    def get_brand_board(self, sid) -> dict | None:
        rows = self._run(f"MATCH (b:BrandBoard {{session_id:$sid}}) RETURN {self.BOARD_RET}",
                         sid=sid)
        return self._board_row(rows[0]) if rows else None

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
