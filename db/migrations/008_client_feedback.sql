CREATE TABLE IF NOT EXISTS draft_feedback (
  id TEXT PRIMARY KEY,                 -- uuid hex
  session_id TEXT NOT NULL,            -- client id (matches sessions.id)
  draft_id TEXT NOT NULL,              -- staff_drafts.id (sent drafts only)
  kind TEXT NOT NULL,                  -- 'heart' | 'reject' | 'approve' | 'changes'
  note TEXT,                           -- change-request text, guard-scrubbed; NULL otherwise
  actor TEXT NOT NULL,                 -- 'client:share' | 'staff:<x-staff-name>'
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS feedback_session ON draft_feedback(session_id, created_at);
CREATE TABLE IF NOT EXISTS shortlist (
  session_id TEXT NOT NULL,
  draft_id TEXT NOT NULL,
  added_by TEXT NOT NULL,              -- 'client:share' | 'staff:<x-staff-name>'
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (session_id, draft_id)
);
CREATE TABLE IF NOT EXISTS share_tokens (
  id TEXT PRIMARY KEY,                 -- uuid hex, used in audit details (never the token)
  session_id TEXT NOT NULL,            -- the one client this link opens
  token_hash TEXT NOT NULL UNIQUE,     -- SHA-256 of the token (same helper as session secrets)
  created_by TEXT NOT NULL,            -- 'staff:<x-staff-name>'
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,            -- created + 7 days by default
  revoked_at TEXT,                     -- set on revoke; NULL while live
  used_at TEXT                         -- first successful public read (info only)
);
CREATE INDEX IF NOT EXISTS share_tokens_session ON share_tokens(session_id, created_at);
