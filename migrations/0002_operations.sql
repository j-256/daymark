CREATE TABLE operations (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL REFERENCES user(id),
  op_id TEXT NOT NULL,
  content TEXT NOT NULL CHECK(json_valid(content)),
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(owner, op_id)
);
CREATE INDEX operations_owner_seq ON operations(owner, seq);
CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT INTO app_settings(key, value) VALUES ('registration', 'invite-only');
