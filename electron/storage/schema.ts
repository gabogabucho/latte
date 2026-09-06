/**
 * Schema is applied idempotently on every start. Revisions are immutable by
 * contract AND by database triggers: no code path can update or delete them.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS brands (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  context    TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS works (
  id         TEXT PRIMARY KEY,
  brand_id   TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  brief      TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_works_brand ON works(brand_id, updated_at DESC);

-- A work holds one or more tracked Markdown documents. brief.md is the default
-- one (kind 'brief') and keeps its path, so existing work folders need no move.
CREATE TABLE IF NOT EXISTS documents (
  id             TEXT PRIMARY KEY,
  work_id        TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL DEFAULT 'brief',
  title          TEXT NOT NULL,
  file_name      TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'draft',
  base_doc_id    TEXT,
  base_rev_id    TEXT,
  base_print     TEXT,
  last_print     TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_documents_work ON documents(work_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_file ON documents(work_id, file_name);

-- document_id NULL means "the work's brief document" (rows written before v4;
-- revisions are immutable by trigger, so they are never back-filled).
CREATE TABLE IF NOT EXISTS revisions (
  id          TEXT PRIMARY KEY,
  work_id     TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  document_id TEXT,
  source      TEXT NOT NULL DEFAULT 'human',
  content     TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_revisions_work ON revisions(work_id, created_at);

CREATE TRIGGER IF NOT EXISTS revisions_immutable_update
BEFORE UPDATE ON revisions
BEGIN
  SELECT RAISE(ABORT, 'revisions are immutable');
END;

CREATE TRIGGER IF NOT EXISTS revisions_immutable_delete
BEFORE DELETE ON revisions
BEGIN
  SELECT RAISE(ABORT, 'revisions are immutable');
END;

CREATE TABLE IF NOT EXISTS decisions (
  id         TEXT PRIMARY KEY,
  work_id    TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  text       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_decisions_work ON decisions(work_id, created_at);

CREATE TABLE IF NOT EXISTS team_members (
  id         TEXT PRIMARY KEY,
  work_id    TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  role_id    TEXT NOT NULL,
  role_name  TEXT NOT NULL,
  initial    TEXT NOT NULL,
  runtime    TEXT NOT NULL,
  model      TEXT,
  account_id TEXT,
  session_id TEXT NOT NULL DEFAULT '',
  done       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_team_members_work ON team_members(work_id, created_at);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export const SCHEMA_VERSION = '4';
