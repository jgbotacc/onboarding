"""Data layer: Neo4j when NEO4J_* env set, else durable SQLite fallback."""
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

    def save(self, s: dict):
        with self.lock:
            self.db.execute("INSERT OR REPLACE INTO sessions(id, state) VALUES(?, ?)", (s["id"], json.dumps(s)))
            self.db.commit()

    def list_states(self):
        return [json.loads(r[0]) for r in self.db.execute("SELECT state FROM sessions").fetchall()]

    def find_by_token(self, token: str):
        row = self.db.execute("SELECT session_id FROM resume_tokens WHERE token=?", (token,)).fetchone()
        return self.load(row[0]) if row else None

    def load(self, sid: str):
        row = self.db.execute("SELECT state FROM sessions WHERE id=?", (sid,)).fetchone()
        return json.loads(row[0]) if row else None

    def event(self, sid: str, kind: str, payload: dict):
        with self.lock:
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
            self.db.commit()


def get_store():
    from src.shared import relay
    env = neo4j_env()
    if relay.enabled():
        try:
            from src.data.neo4j_store import Neo4jStore
            st = Neo4jStore(via_relay=True)
            print("[data] Using Neo4j store via relay")
            return st
        except Exception as e:
            print(f"[data] Neo4j relay unavailable ({e})")
    if env:
        try:
            from src.data.neo4j_store import Neo4jStore
            st = Neo4jStore(*env)
            print("[data] Using Neo4j store")
            return st
        except Exception as e:
            print(f"[data] Neo4j unavailable ({e}); FALLING BACK to SQLite at {SQLITE_PATH}")
    if not env:
        print(f"[data] NEO4J_* env not set; FALLING BACK to SQLite at {SQLITE_PATH}")
    return SqliteStore()
