-- Accounts, the contributor review queue, and an audit log. Content itself
-- stays in git (_data/*.yml); see docs/ARCHITECTURE-PLAN.md for why.

CREATE TABLE users (
  email      TEXT PRIMARY KEY,            -- lowercase; must match the Access login
  name       TEXT NOT NULL DEFAULT '',    -- shown in the UI and in commit messages
  role       TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'contributor')),
  added_by   TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- A contributor's change, waiting for an editor. `op` is the engine
-- operation as JSON (see src/engine.js) minus any photo bytes, which live in
-- submission_files. Approving re-applies the op to the CURRENT file, so queued
-- submissions never conflict with each other the way branches would.
CREATE TABLE submissions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  email       TEXT NOT NULL,
  collection  TEXT NOT NULL,
  summary     TEXT NOT NULL,
  op          TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
  reviewed_by TEXT,
  reviewed_at TEXT,
  note        TEXT,
  commit_sha  TEXT
);
CREATE INDEX submissions_status ON submissions (status, id);
CREATE INDEX submissions_email ON submissions (email, id);

CREATE TABLE submission_files (
  submission_id INTEGER NOT NULL REFERENCES submissions (id) ON DELETE CASCADE,
  field         TEXT NOT NULL,
  ext           TEXT NOT NULL,
  bytes         BLOB NOT NULL,
  PRIMARY KEY (submission_id, field)
);

CREATE TABLE audit (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  email      TEXT NOT NULL,
  action     TEXT NOT NULL,     -- publish | submit | approve | reject | withdraw | user
  collection TEXT,
  summary    TEXT NOT NULL,
  commit_sha TEXT
);
CREATE INDEX audit_at ON audit (id DESC);
