-- Optional InnoDB FULLTEXT ngram index over memo.content.
--
-- CEL content.contains keeps the portable LIKE path (render.go is intentionally
-- unchanged): the MySQL optimizer does not use FULLTEXT for LIKE '%x%'. The
-- ngram parser is installed so a future MATCH AGAINST path can adopt the index
-- without another schema migration.
--
-- Idempotent: LATEST.sql installs the same index; MySQL rejects a duplicate
-- FULLTEXT ADD, so only issue the ALTER when information_schema has no such
-- index. Prepared statements + user variables run as one multi-statement batch.

SET @ngram_exists = (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'memo'
    AND index_name = 'idx_memo_content_ngram'
);

SET @ngram_sql = IF(
  @ngram_exists = 0,
  'ALTER TABLE `memo` ADD FULLTEXT INDEX `idx_memo_content_ngram` (`content`) WITH PARSER ngram',
  'SELECT 1'
);

PREPARE ngram_stmt FROM @ngram_sql;
EXECUTE ngram_stmt;
DEALLOCATE PREPARE ngram_stmt;
