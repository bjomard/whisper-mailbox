-- PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS mailboxes (
  mailbox_id TEXT PRIMARY KEY,
  poll_hash  BLOB NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS deposit_tokens (
  mailbox_id TEXT NOT NULL,
  dep_hash   BLOB NOT NULL,
  revoked    INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (mailbox_id, dep_hash),
  FOREIGN KEY (mailbox_id) REFERENCES mailboxes(mailbox_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  mailbox_id  TEXT NOT NULL,
  msg_id      BLOB NOT NULL,
  blob        BLOB NOT NULL,
  received_at INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  FOREIGN KEY (mailbox_id) REFERENCES mailboxes(mailbox_id) ON DELETE CASCADE,
  UNIQUE (mailbox_id, msg_id)
);

CREATE INDEX IF NOT EXISTS idx_messages_mailbox_id_id ON messages(mailbox_id, id);
CREATE INDEX IF NOT EXISTS idx_messages_expires ON messages(expires_at);
