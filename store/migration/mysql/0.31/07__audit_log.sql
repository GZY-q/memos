-- Persisted audit trail for sensitive auth/admin actions.
-- Idempotent: skip when LATEST already created the table.

SET @audit_log_exists := (
  SELECT COUNT(*) FROM information_schema.tables
  WHERE table_schema = DATABASE() AND table_name = 'audit_log'
);

SET @audit_ddl := IF(
  @audit_log_exists = 0,
  'CREATE TABLE `audit_log` (
    `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `created_ts` BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
    `actor_user_id` INT NOT NULL DEFAULT 0,
    `actor_username` VARCHAR(256) NOT NULL DEFAULT '',
    `action` VARCHAR(256) NOT NULL,
    `procedure` VARCHAR(512) NOT NULL DEFAULT '',
    `client_ip` VARCHAR(128) NOT NULL DEFAULT '',
    `outcome` VARCHAR(32) NOT NULL DEFAULT ''success'',
    `detail` TEXT NOT NULL,
    CHECK (`outcome` IN (''success'', ''denied'', ''error''))
  )',
  'SELECT 1'
);

PREPARE audit_stmt FROM @audit_ddl;
EXECUTE audit_stmt;
DEALLOCATE PREPARE audit_stmt;

SET @idx_created := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'audit_log' AND index_name = 'idx_audit_log_created_ts'
);
SET @idx_ddl := IF(
  @idx_created = 0,
  'CREATE INDEX `idx_audit_log_created_ts` ON `audit_log`(`created_ts` DESC)',
  'SELECT 1'
);
PREPARE idx_created_stmt FROM @idx_ddl;
EXECUTE idx_created_stmt;
DEALLOCATE PREPARE idx_created_stmt;

SET @idx_action := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'audit_log' AND index_name = 'idx_audit_log_action'
);
SET @idx_action_ddl := IF(
  @idx_action = 0,
  'CREATE INDEX `idx_audit_log_action` ON `audit_log`(`action`, `created_ts` DESC)',
  'SELECT 1'
);
PREPARE idx_action_stmt FROM @idx_action_ddl;
EXECUTE idx_action_stmt;
DEALLOCATE PREPARE idx_action_stmt;

SET @idx_actor := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'audit_log' AND index_name = 'idx_audit_log_actor'
);
SET @idx_actor_ddl := IF(
  @idx_actor = 0,
  'CREATE INDEX `idx_audit_log_actor` ON `audit_log`(`actor_user_id`, `created_ts` DESC)',
  'SELECT 1'
);
PREPARE idx_actor_stmt FROM @idx_actor_ddl;
EXECUTE idx_actor_stmt;
DEALLOCATE PREPARE idx_actor_stmt;
