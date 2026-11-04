CREATE TABLE IF NOT EXISTS brand_boards (
  session_id TEXT PRIMARY KEY,         -- client id (matches sessions.id), one board per client
  version INTEGER NOT NULL DEFAULT 1,  -- +1 on every new model read
  colours TEXT NOT NULL DEFAULT '[]',  -- JSON list of hex strings, e.g. ["#A63D2F","#F3E6D3"]
  tone_words TEXT NOT NULL DEFAULT '[]',   -- JSON list of short strings, max 6
  style_words TEXT NOT NULL DEFAULT '[]',   -- JSON list of short strings, max 6
  summary TEXT NOT NULL DEFAULT '',    -- one short plain-English paragraph, max 300 chars
  photos TEXT NOT NULL DEFAULT '[]',   -- JSON list of /media/brand-*.jpg urls, max 6
  status TEXT NOT NULL DEFAULT 'pending_review',  -- 'pending_review' | 'approved' | 'rejected'
  approved_by TEXT, decided_at TEXT,
  note TEXT,                           -- staff reject/edit note
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
