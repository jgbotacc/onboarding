"""Data layer: Neo4j when NEO4J_* env set, else durable SQLite fallback."""
import contextlib
import json
import sqlite3
import threading
from pathlib import Path

from src.shared.config import SQLITE_PATH, neo4j_env

_UNSET = object()


class SqliteStore:
    kind = "sqlite"

    def __init__(self, path=SQLITE_PATH):
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.lock = threading.Lock()
        mig = Path(__file__).resolve().parents[2] / "db" / "migrations"
        for f in sorted(mig.glob("*.sql")):
            self.db.executescript(f.read_text())
        # SQLite ALTER TABLE ADD COLUMN is not idempotent, so guard it:
        # rerunning migrations on an existing file must never fail.
        with self.lock:
            cols = [r[1] for r in self.db.execute("PRAGMA table_info(looks)").fetchall()]
            if cols and "source" not in cols:
                self.db.execute("ALTER TABLE looks ADD COLUMN source TEXT DEFAULT 'agent'")
                self.db.commit()

    @contextlib.contextmanager
    def _txn(self):
        """One locked transaction; rollback then re-raise on any error."""
        with self.lock:
            try:
                yield
                self.db.commit()
            except Exception:
                self.db.rollback()
                raise

    def save(self, s: dict):
        with self._txn():
            self.db.execute("INSERT OR REPLACE INTO sessions(id, state) VALUES(?, ?)", (s["id"], json.dumps(s)))
            bad = s.get("invalid", {})
            self.db.execute("DELETE FROM field_values WHERE session_id=?", (s["id"],))
            self.db.executemany("INSERT INTO field_values(session_id, key, value, valid, issue) VALUES(?,?,?,?,?)",
                                [(s["id"], k, v, int(k not in bad), (bad.get(k) or {}).get("message"))
                                 for k, v in s.get("fields", {}).items()])

    def list_states(self):
        with self.lock:
            return [json.loads(r[0]) for r in self.db.execute("SELECT state FROM sessions").fetchall()]

    def find_by_token(self, token: str):
        with self.lock:
            row = self.db.execute("SELECT session_id FROM resume_tokens WHERE token=?", (token,)).fetchone()
            if not row:
                return None
            row = self.db.execute("SELECT state FROM sessions WHERE id=?", (row[0],)).fetchone()
            return json.loads(row[0]) if row else None

    def load(self, sid: str):
        with self.lock:
            row = self.db.execute("SELECT state FROM sessions WHERE id=?", (sid,)).fetchone()
            return json.loads(row[0]) if row else None

    def event(self, sid: str, kind: str, payload: dict):
        with self._txn():
            if kind == "decision":
                self.db.execute("INSERT INTO decisions(id, session_id, decision, fields, note) VALUES(?,?,?,?,?)",
                                (payload["id"], sid, payload["decision"], json.dumps(payload["fields"]), payload["note"]))
                if payload.get("token"):
                    self.db.execute("INSERT OR REPLACE INTO resume_tokens(token, session_id) VALUES(?,?)",
                                    (payload["token"], sid))
            if kind == "email":
                self.db.execute("INSERT INTO emails(session_id, to_addr, subject, body, status, sent_at) VALUES(?,?,?,?,?,?)",
                                (sid, payload["to"], payload["subject"], payload["body"], payload["status"], payload["sent_at"]))
            for ref in payload.get("refs", []) if kind == "refs" else []:
                self.db.execute("INSERT OR IGNORE INTO reference_images(id, session_id, path, filename) VALUES(?,?,?,?)",
                                (ref["id"], sid, ref["path"], ref.get("filename")))
            self.db.execute("INSERT INTO events(session_id, kind, payload) VALUES(?,?,?)",
                            (sid, kind, json.dumps(payload)))

    def add_looks(self, sid, round_n, looks: list[dict], source="agent"):
        with self._txn():
            self.db.executemany("INSERT OR REPLACE INTO looks(id, session_id, round, url, title, brief, source) VALUES(?,?,?,?,?,?,?)",
                                [(l.get("id"), sid, round_n, l.get("url"), l.get("title"), l.get("brief"),
                                  l.get("source", source)) for l in looks])

    def mark_looks(self, sid, ids: list[str]):
        if not ids:
            return
        with self._txn():
            self.db.execute(f"UPDATE looks SET selected=1 WHERE session_id=? AND id IN ({','.join('?' * len(ids))})",
                            (sid, *ids))

    def looks(self, sid=None) -> list[dict]:
        with self.lock:
            q = "SELECT id, session_id, round, url, title, brief, source, selected, created_at FROM looks"
            args = []
            if sid is not None:
                q += " WHERE session_id=?"
                args.append(sid)
            q += " ORDER BY round, created_at, id"
            cols = ("id", "session_id", "round", "url", "title", "brief", "source", "selected", "created_at")
            return [dict(zip(cols, r)) for r in self.db.execute(q, args).fetchall()]

    _DRAFT_COLS = ("id", "session_id", "run_id", "parent_id", "parent_kind", "preset", "width",
                   "height", "marketer_prompt", "chips", "style_title", "style", "prompt", "url",
                   "status", "error", "author", "starred", "pinned_to", "pinned_consult_id",
                   "sent_at", "sent_by", "created_at")

    @staticmethod
    def _draft_row(row) -> dict:
        d = dict(zip(SqliteStore._DRAFT_COLS, row))
        try:
            chips = json.loads(d["chips"]) if d["chips"] else None
            d["chips"] = chips if isinstance(chips, list) else d["chips"]
        except (ValueError, TypeError):
            pass
        return d

    def reserve_drafts(self, sid, rows: list[dict], cap=9) -> list[str] | None:
        """Atomically reserve up to cap drafts per session.

        Counts rows with status in ('reserved','ok'); if count + len(rows) exceeds
        cap, inserts nothing and returns None. Otherwise inserts one 'reserved'
        row per dict and returns their ids.
        """
        import uuid
        with self._txn():
            (count,) = self.db.execute(
                "SELECT COUNT(*) FROM staff_drafts WHERE session_id=? AND status IN ('reserved','ok')",
                (sid,)).fetchone()
            if count + len(rows) > cap:
                return None
            ids = []
            for r in rows:
                did = r.get("id") or uuid.uuid4().hex
                chips = r.get("chips")
                if isinstance(chips, (list, dict)):
                    chips = json.dumps(chips)
                self.db.execute(
                    "INSERT INTO staff_drafts(id, session_id, run_id, parent_id, parent_kind, preset,"
                    " width, height, marketer_prompt, chips, style_title, style, prompt, url,"
                    " status, error, author, starred, pinned_to, pinned_consult_id, sent_at, sent_by)"
                    " VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (did, sid, r.get("run_id"), r.get("parent_id"), r.get("parent_kind"),
                     r.get("preset"), r.get("width"), r.get("height"), r.get("marketer_prompt"),
                     chips, r.get("style_title"), r.get("style"), r.get("prompt"), r.get("url"),
                     "reserved", r.get("error"), r.get("author"), int(bool(r.get("starred", 0))),
                     r.get("pinned_to"), r.get("pinned_consult_id"), r.get("sent_at"), r.get("sent_by")))
                ids.append(did)
            return ids

    def finish_draft(self, id, url, status, error=None) -> dict | None:
        with self._txn():
            self.db.execute("UPDATE staff_drafts SET url=?, status=?, error=? WHERE id=?",
                            (url, status, error, id))
        return self.get_draft(id)

    def drafts(self, sid) -> list[dict]:
        with self.lock:
            return [self._draft_row(r) for r in self.db.execute(
                "SELECT {} FROM staff_drafts WHERE session_id=? ORDER BY created_at, id".format(
                    ", ".join(self._DRAFT_COLS)), (sid,)).fetchall()]

    def get_draft(self, id) -> dict | None:
        with self.lock:
            row = self.db.execute(
                "SELECT {} FROM staff_drafts WHERE id=?".format(", ".join(self._DRAFT_COLS)),
                (id,)).fetchone()
            return self._draft_row(row) if row else None

    def set_draft_flags(self, id, starred=None, pinned_to=_UNSET,
                        pinned_consult_id=_UNSET) -> dict | None:
        sets, args = [], []
        if starred is not None:
            sets.append("starred=?")
            args.append(int(bool(starred)))
        if pinned_to is not _UNSET:
            sets.append("pinned_to=?")
            args.append(pinned_to)
        if pinned_consult_id is not _UNSET:
            sets.append("pinned_consult_id=?")
            args.append(pinned_consult_id)
        if sets:
            with self._txn():
                self.db.execute("UPDATE staff_drafts SET {} WHERE id=?".format(", ".join(sets)),
                                (*args, id))
        return self.get_draft(id)

    def mark_draft_sent(self, id, actor, at) -> dict | None:
        with self._txn():
            self.db.execute("UPDATE staff_drafts SET sent_at=?, sent_by=? WHERE id=?", (at, actor, id))
        return self.get_draft(id)

    def sweep_stale_drafts(self, sid, older_than_s=600) -> int:
        """Mark 'reserved' rows older than the limit as failed ('timed out'),
        freeing their cap slots. Returns the number swept."""
        with self._txn():
            cur = self.db.execute(
                "UPDATE staff_drafts SET status='failed', error='timed out' WHERE session_id=?"
                " AND status='reserved' AND created_at < datetime('now', ? || ' seconds')",
                (sid, -int(older_than_s)))
            return cur.rowcount

    def save_consult(self, card: dict):
        with self._txn():
            self.db.execute("INSERT OR REPLACE INTO consults(id, session_id, status, card, approved_by, decided_at) VALUES(?,?,?,?,?,?)",
                            (card["id"], card.get("session_id"), card.get("status"), json.dumps(card),
                             card.get("approved_by"), card.get("decided_at")))

    def consults(self) -> list[dict]:
        with self.lock:
            return [json.loads(r[0]) for r in
                    self.db.execute("SELECT card FROM consults ORDER BY created_at DESC, rowid DESC").fetchall()]

    def get_consult(self, cid) -> dict | None:
        with self.lock:
            row = self.db.execute("SELECT card FROM consults WHERE id=?", (cid,)).fetchone()
            return json.loads(row[0]) if row else None

    def audit(self, sid, actor, action, target=None, details: dict | None = None):
        with self._txn():
            self.db.execute("INSERT INTO audit(session_id, actor, action, target, details) VALUES(?,?,?,?,?)",
                            (sid, actor, action, target, json.dumps(details) if details is not None else None))

    def audit_log(self, sid=None, limit=200) -> list[dict]:
        with self.lock:
            q, args = "SELECT id, session_id, actor, action, target, details, at FROM audit", []
            if sid is not None:
                q += " WHERE session_id=?"
                args.append(sid)
            q += " ORDER BY id DESC LIMIT ?"
            args.append(limit)
            out = []
            for r in self.db.execute(q, args).fetchall():
                d = dict(zip(("id", "session_id", "actor", "action", "target", "details", "at"), r))
                d["details"] = json.loads(d["details"]) if d["details"] else None
                out.append(d)
            return out

    def trace(self, row: dict):
        with self._txn():
            self.db.execute("INSERT INTO traces(session_id, step, model, ok, latency_ms, cost_sgd, error, at) VALUES(?,?,?,?,?,?,?,?)",
                            (row.get("session_id"), row.get("step"), row.get("model"), int(bool(row.get("ok"))),
                             row.get("latency_ms"), row.get("cost_sgd", 0.0), row.get("error"), row.get("at")))

    def _trace_rows(self, sid=None, limit=None) -> list[dict]:
        q = "SELECT id, session_id, step, model, ok, latency_ms, cost_sgd, error, at FROM traces"
        args: list = []
        if sid is not None:
            q += " WHERE session_id=?"
            args.append(sid)
        q += " ORDER BY id DESC"
        if limit is not None:
            q += " LIMIT ?"
            args.append(limit)
        out = []
        for r in self.db.execute(q, args).fetchall():
            d = dict(zip(("id", "session_id", "step", "model", "ok", "latency_ms", "cost_sgd", "error", "at"), r))
            d["ok"] = bool(d["ok"])
            out.append(d)
        return out

    def traces(self, sid=None, limit=200) -> list[dict]:
        with self.lock:
            return self._trace_rows(sid, limit)

    def all_traces(self) -> list[dict]:
        with self.lock:
            return self._trace_rows()

    def add_eval(self, kind, score, n, details: dict):
        with self._txn():
            self.db.execute("INSERT INTO evals(kind, score, n, details) VALUES(?,?,?,?)",
                            (kind, score, n, json.dumps(details)))

    def latest_evals(self) -> dict:
        with self.lock:
            out = {}
            for kind, score, n, details, at in self.db.execute(
                    "SELECT kind, score, n, details, at FROM evals ORDER BY id DESC").fetchall():
                out.setdefault(kind, {"kind": kind, "score": score, "n": n,
                                      "details": json.loads(details) if details else None, "at": at})
            return out

    def events_for(self, sid) -> list[dict]:
        with self.lock:
            return [{"kind": k, "payload": json.loads(p), "created_at": c} for k, p, c in
                    self.db.execute("SELECT kind, payload, created_at FROM events WHERE session_id=? ORDER BY id",
                                    (sid,)).fetchall()]


def get_store():
    from src.shared import relay, trace
    env = neo4j_env()
    if relay.enabled():
        try:
            from src.data.neo4j_store import Neo4jStore
            st = Neo4jStore(via_relay=True)
            print("[data] Using Neo4j store via relay")
            trace.set_sink(st.trace)
            return st
        except Exception as e:
            print(f"[data] Neo4j relay unavailable ({e})")
    if env:
        try:
            from src.data.neo4j_store import Neo4jStore
            st = Neo4jStore(*env)
            print("[data] Using Neo4j store")
            trace.set_sink(st.trace)
            return st
        except Exception as e:
            print(f"[data] Neo4j unavailable ({e}); FALLING BACK to SQLite at {SQLITE_PATH}")
    if not env:
        print(f"[data] NEO4J_* env not set; FALLING BACK to SQLite at {SQLITE_PATH}")
    st = SqliteStore()
    trace.set_sink(st.trace)
    return st
