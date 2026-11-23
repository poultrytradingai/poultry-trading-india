CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT,
  whatsapp TEXT,
  whatsapp_verified INTEGER NOT NULL DEFAULT 0,
  has_listing INTEGER NOT NULL DEFAULT 0,
  banned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT,
  last_login TEXT
);
CREATE INDEX IF NOT EXISTS idx_members_email ON members(email);
CREATE TABLE IF NOT EXISTS unlocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  day TEXT NOT NULL,
  created_at TEXT,
  UNIQUE(member_id, target_type, target_id)
);
CREATE INDEX IF NOT EXISTS idx_unlocks_day ON unlocks(member_id, day);
