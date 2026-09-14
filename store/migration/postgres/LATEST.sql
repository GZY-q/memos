-- system_setting
CREATE TABLE system_setting (
  name TEXT NOT NULL PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT NOT NULL
);

-- user
CREATE TABLE "user" (
  id SERIAL PRIMARY KEY,
  created_ts BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()),
  updated_ts BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()),
  row_status TEXT NOT NULL DEFAULT 'NORMAL',
  username TEXT COLLATE "C" NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'USER',
  email TEXT NOT NULL DEFAULT '',
  nickname TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  avatar_url TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT ''
);

-- user_setting
CREATE TABLE user_setting (
  user_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  UNIQUE(user_id, key)
);

-- space
CREATE TABLE space (
  id SERIAL PRIMARY KEY,
  uid TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  payload JSONB NOT NULL DEFAULT '{}'
);

-- space membership
CREATE TABLE space_member (
  space_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ADMIN', 'USER')),
  PRIMARY KEY (space_id, user_id)
);

CREATE INDEX idx_space_member_user_id ON space_member(user_id, space_id);

-- memo
CREATE TABLE memo (
  id SERIAL PRIMARY KEY,
  uid TEXT NOT NULL UNIQUE,
  creator_id INTEGER NOT NULL,
  created_ts BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()),
  updated_ts BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()),
  row_status TEXT NOT NULL DEFAULT 'NORMAL',
  content TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'PRIVATE',
  pinned BOOLEAN NOT NULL DEFAULT FALSE,
  payload JSONB NOT NULL DEFAULT '{}',
  space_id INTEGER DEFAULT NULL
);

CREATE INDEX idx_memo_space_id ON memo(space_id, row_status, created_ts DESC, id DESC);

-- memo_relation
CREATE TABLE memo_relation (
  memo_id INTEGER NOT NULL,
  related_memo_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  UNIQUE(memo_id, related_memo_id, type)
);

CREATE INDEX idx_memo_relation_related_type_memo
  ON memo_relation(related_memo_id, type, memo_id);

-- attachment
CREATE TABLE attachment (
  id SERIAL PRIMARY KEY,
  uid TEXT NOT NULL UNIQUE,
  creator_id INTEGER NOT NULL,
  created_ts BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()),
  updated_ts BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()),
  filename TEXT NOT NULL,
  blob BYTEA,
  type TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL DEFAULT 0,
  memo_id INTEGER DEFAULT NULL,
  storage_type TEXT NOT NULL DEFAULT '',
  reference TEXT NOT NULL DEFAULT '',
  payload TEXT NOT NULL DEFAULT '{}'
);

-- idp
CREATE TABLE idp (
  id SERIAL PRIMARY KEY,
  uid TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  identifier_filter TEXT NOT NULL DEFAULT '',
  config JSONB NOT NULL DEFAULT '{}'
);

-- inbox
CREATE TABLE inbox (
  id SERIAL PRIMARY KEY,
  created_ts BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()),
  sender_id INTEGER NOT NULL,
  receiver_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  message TEXT NOT NULL
);

-- memo reaction
CREATE TABLE reaction (
  id SERIAL PRIMARY KEY,
  created_ts BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()),
  creator_id INTEGER NOT NULL,
  memo_id INTEGER NOT NULL,
  reaction_type TEXT NOT NULL,
  UNIQUE(creator_id, memo_id, reaction_type)
);

-- memo_share
CREATE TABLE memo_share (
  id         SERIAL  PRIMARY KEY,
  uid        TEXT    NOT NULL UNIQUE,
  memo_id    INTEGER NOT NULL,
  creator_id INTEGER NOT NULL,
  created_ts BIGINT  NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()),
  expires_ts BIGINT  DEFAULT NULL,
  FOREIGN KEY (memo_id) REFERENCES memo(id) ON DELETE CASCADE
);

CREATE INDEX idx_memo_share_memo_id ON memo_share(memo_id);

-- user_identity
CREATE TABLE user_identity (
  id         SERIAL  PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  provider   TEXT    NOT NULL,
  extern_uid TEXT    NOT NULL,
  created_ts BIGINT  NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()),
  updated_ts BIGINT  NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()),
  UNIQUE (provider, extern_uid),
  UNIQUE (user_id, provider)
);

CREATE INDEX idx_user_identity_user_id ON user_identity(user_id);

-- memo content trigram (optional; requires pg_trgm). Accelerates ILIKE
-- content.contains when available; otherwise the portable ILIKE path remains.
DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE NOTICE 'pg_trgm unavailable, skipping memo content trigram index: %', SQLERRM;
      RETURN;
  END;

  BEGIN
    CREATE INDEX IF NOT EXISTS idx_memo_content_trgm
      ON memo USING gin (content gin_trgm_ops);
  EXCEPTION
    WHEN OTHERS THEN
      RAISE NOTICE 'failed to create memo content trigram index: %', SQLERRM;
  END;
END $$;

-- audit_log
CREATE TABLE audit_log (
  id SERIAL PRIMARY KEY,
  created_ts BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()),
  actor_user_id INTEGER NOT NULL DEFAULT 0,
  actor_username TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  procedure TEXT NOT NULL DEFAULT '',
  client_ip TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'denied', 'error')) DEFAULT 'success',
  detail TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX idx_audit_log_created_ts ON audit_log(created_ts DESC);
CREATE INDEX idx_audit_log_action ON audit_log(action, created_ts DESC);
CREATE INDEX idx_audit_log_actor ON audit_log(actor_user_id, created_ts DESC);
