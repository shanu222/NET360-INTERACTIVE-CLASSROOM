-- NET360 Classroom — Cloudflare D1 schema.
-- Applied automatically when the server starts (every statement is idempotent),
-- or by hand: npx wrangler d1 execute <db-name> --remote --file apps/server/db/schema.sql

-- One row per lecture.
CREATE TABLE IF NOT EXISTS class_sessions (
  id            TEXT PRIMARY KEY,
  code          TEXT NOT NULL,
  subject       TEXT NOT NULL,
  topic         TEXT NOT NULL DEFAULT '',
  teacher_uid   TEXT NOT NULL,
  teacher_name  TEXT NOT NULL,
  board_key     TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'live',   -- live | ended
  started_at    INTEGER NOT NULL,               -- ms epoch
  ended_at      INTEGER,
  last_active   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_live ON class_sessions (status, last_active);
CREATE INDEX IF NOT EXISTS idx_sessions_teacher ON class_sessions (teacher_uid, started_at);

-- Latest board state per lecture (gzip + base64 JSON). Lets a class survive a server restart
-- and keeps the notes after class.
CREATE TABLE IF NOT EXISTS board_snapshots (
  session_id    TEXT PRIMARY KEY REFERENCES class_sessions (id),
  seq           INTEGER NOT NULL,
  pages         INTEGER NOT NULL,
  strokes       INTEGER NOT NULL,
  data          TEXT NOT NULL,
  updated_at    INTEGER NOT NULL
);

-- Attendance: who joined each lecture and when they were last seen.
CREATE TABLE IF NOT EXISTS session_participants (
  session_id    TEXT NOT NULL REFERENCES class_sessions (id),
  user_id       TEXT NOT NULL,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL,                  -- teacher | student
  joined_at     INTEGER NOT NULL,
  last_seen     INTEGER NOT NULL,
  PRIMARY KEY (session_id, user_id)
);

-- Participation: every raised hand.
CREATE TABLE IF NOT EXISTS hand_raises (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id    TEXT NOT NULL REFERENCES class_sessions (id),
  user_id       TEXT NOT NULL,
  raised_at     INTEGER NOT NULL,
  lowered_at    INTEGER,
  lowered_by    TEXT                            -- student | teacher
);
CREATE INDEX IF NOT EXISTS idx_hands_session ON hand_raises (session_id, user_id);
