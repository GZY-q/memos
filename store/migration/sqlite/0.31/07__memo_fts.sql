-- FTS5 trigram index over memo.content for substring search.
-- Trigram keeps CEL `content.contains("...")` semantics (unlike word tokenizers).
-- External-content table stays in sync via AFTER INSERT/UPDATE/DELETE triggers.
-- Idempotent: migration fixtures may already have a LATEST-built memo_fts.

DROP TABLE IF EXISTS `memo_fts`;

CREATE VIRTUAL TABLE `memo_fts` USING fts5(
  `content`,
  content_rowid = 'id',
  content = 'memo',
  tokenize = 'trigram'
);

DROP TRIGGER IF EXISTS `memo_fts_ai`;
CREATE TRIGGER `memo_fts_ai`
AFTER INSERT ON `memo` BEGIN
  INSERT INTO `memo_fts` (`rowid`, `content`) VALUES (new.`id`, new.`content`);
END;

DROP TRIGGER IF EXISTS `memo_fts_ad`;
CREATE TRIGGER `memo_fts_ad`
AFTER DELETE ON `memo` BEGIN
  INSERT INTO `memo_fts` (`memo_fts`, `rowid`, `content`) VALUES ('delete', old.`id`, old.`content`);
END;

DROP TRIGGER IF EXISTS `memo_fts_au`;
CREATE TRIGGER `memo_fts_au`
AFTER UPDATE OF `content` ON `memo` BEGIN
  INSERT INTO `memo_fts` (`memo_fts`, `rowid`, `content`) VALUES ('delete', old.`id`, old.`content`);
  INSERT INTO `memo_fts` (`rowid`, `content`) VALUES (new.`id`, new.`content`);
END;

-- Backfill existing rows for upgrades.
INSERT INTO `memo_fts` (`rowid`, `content`)
SELECT `id`, `content` FROM `memo`;
