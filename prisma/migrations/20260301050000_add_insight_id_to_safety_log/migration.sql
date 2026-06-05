-- Add insightId soft-link column to ai_safety_logs
-- Allows joining safety verdicts back to the AIInsight that triggered them.
-- Guarded: ai_safety_logs may not exist yet if the governance migration hasn't
-- run — the column will be included when that CREATE TABLE runs instead.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'ai_safety_logs'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'ai_safety_logs'
        AND column_name = 'insightId'
    ) THEN
      ALTER TABLE "ai_safety_logs" ADD COLUMN "insightId" VARCHAR(30);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename  = 'ai_safety_logs'
        AND indexname  = 'ai_safety_logs_insightId_idx'
    ) THEN
      CREATE INDEX "ai_safety_logs_insightId_idx" ON "ai_safety_logs"("insightId");
    END IF;
  END IF;
END$$;
