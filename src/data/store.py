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

    def load(self, sid: str):
        row = self.db.execute("SELECT state FROM sessions WHERE id=?", (sid,)).fetchone()
        return json.loads(row[0]) if row else None

    def event(self, sid: str, kind: str, payload: dict):
        with self.lock:
            self.db.execute("INSERT INTO events(session_id, kind, payload) VALUES(?,?,?)",
                            (sid, kind, json.dumps(payload)))
            self.db.commit()


def get_store():
    env = neo4j_env()
    if env:
        try:
            from src.data.neo4j_store import Neo4jStore
            st = Neo4jStore(*env)
            print("[data] Using Neo4j store")
            return st
        except Exception as e:
            print(f"[data] Neo4j unavailable ({e}); FALLING BACK to SQLite at {SQLITE_PATH}")
    else:
        print(f"[data] NEO4J_* env not set; FALLING BACK to SQLite at {SQLITE_PATH}")
    return SqliteStore()
