-- Per-field value + sense-check result (mirrors Neo4j Field.valid / Field.issue)
CREATE TABLE IF NOT EXISTS field_values (
  session_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT, valid INTEGER NOT NULL DEFAULT 1, issue TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (session_id, key)
);
