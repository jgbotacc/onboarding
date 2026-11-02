"""Data layer: Neo4j when NEO4J_* env set, else durable SQLite fallback."""
import contextlib
import json
import sqlite3
import threading
from pathlib import Path

from src.shared.config import SQLITE_PATH, neo4j_env


class SqliteStore:
    kind = "sqlite"

    def __init__(self, path=SQLITE_PATH):
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.lock = threading.Lock()
        mig = Path(__file__).resolve().parents[2] / "db" / "migrations"
        for f in sorted(mig.glob("*.sql")):
            self.db.executescript(f.read_text())

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

    def add_looks(self, sid, round_n, looks: list[dict]):
        with self._txn():
            self.db.executemany("INSERT OR REPLACE INTO looks(id, session_id, round, url, title, brief) VALUES(?,?,?,?,?,?)",
                                [(l.get("id"), sid, round_n, l.get("url"), l.get("title"), l.get("brief")) for l in looks])

    def mark_looks(self, sid, ids: list[str]):
        if not ids:
            return
        with self._txn():
            self.db.execute(f"UPDATE looks SET selected=1 WHERE session_id=? AND id IN ({','.join('?' * len(ids))})",
                            (sid, *ids))

    def looks(self, sid=None) -> list[dict]:
        with self.lock:
            q = "SELECT id, session_id, round, url, title, brief, selected, created_at FROM looks"
            args = []
            if sid is not None:
                q += " WHERE session_id=?"
                args.append(sid)
            q += " ORDER BY round, created_at, id"
            cols = ("id", "session_id", "round", "url", "title", "brief", "selected", "created_at")
            return [dict(zip(cols, r)) for r in self.db.execute(q, args).fetchall()]

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
