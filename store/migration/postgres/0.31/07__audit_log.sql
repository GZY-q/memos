-- Persisted audit trail for sensitive auth/admin actions.
-- Idempotent: LATEST-built databases already have this table.

CREATE TABLE IF NOT EXISTS audit_log (
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

CREATE INDEX IF NOT EXISTS idx_audit_log_created_ts ON audit_log(created_ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action, created_ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log(actor_user_id, created_ts DESC);
