CREATE TABLE IF NOT EXISTS staff_drafts (
  id TEXT PRIMARY KEY,               -- uuid hex, also the media file stem
  session_id TEXT NOT NULL,          -- client id (matches sessions.id)
  run_id TEXT NOT NULL,              -- one id per Generate/Remix click
  parent_id TEXT,                    -- draft id or look id this was remixed from
  parent_kind TEXT,                  -- 'draft' | 'look' | NULL
  preset TEXT NOT NULL,              -- 'post' | 'story' | 'flyer'
  width INTEGER NOT NULL, height INTEGER NOT NULL,
  marketer_prompt TEXT,              -- after guard scrub
  chips TEXT,                        -- JSON list of chip ids
  style_title TEXT, style TEXT,      -- variant used for this draft
  prompt TEXT,                       -- full prompt sent to Meta (scrubbed, no contact fields)
  url TEXT,                          -- /media/<id>.png, NULL until ok
  status TEXT NOT NULL,              -- 'reserved' | 'ok' | 'failed'
  error TEXT,
  author TEXT NOT NULL,              -- 'staff:<x-staff-name>'
  starred INTEGER NOT NULL DEFAULT 0,
  pinned_to TEXT,                    -- NULL | 'client' | 'consult'
  pinned_consult_id TEXT,
  sent_at TEXT, sent_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS staff_drafts_session ON staff_drafts(session_id, created_at);
