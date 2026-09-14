-- Optional InnoDB FULLTEXT ngram index over memo.content.
--
-- CEL content.contains with a needle of >= 2 runes compiles to
-- MATCH(memo.content) AGAINST(? IN BOOLEAN MODE) (internal/filter/render.go).
-- Shorter needles and startsWith/endsWith keep the portable LIKE path.
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
