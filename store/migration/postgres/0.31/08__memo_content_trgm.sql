-- Optional pg_trgm GIN index over memo.content.
-- Accelerates ILIKE '%needle%' for content.contains without changing CEL/SQL
-- semantics: the planner uses the trigram index when the extension is present.
-- Self-hosted roles often lack CREATE EXTENSION, so both steps are best-effort.
-- Nested DO blocks keep the extension if index creation is the step that fails.
-- Idempotent: migration fixtures may already have a LATEST-built index.

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
