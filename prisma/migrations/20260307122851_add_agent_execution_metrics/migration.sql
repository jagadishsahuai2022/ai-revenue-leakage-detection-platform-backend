-- Create AgentExecutionMetrics table for cron job analytics
CREATE TABLE IF NOT EXISTS "agent_execution_metrics" (
    "id"              TEXT         NOT NULL,
    "runAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalProcessed"  INTEGER      NOT NULL DEFAULT 0,
    "successes"       INTEGER      NOT NULL DEFAULT 0,
    "failures"        INTEGER      NOT NULL DEFAULT 0,
    "skipped"         INTEGER      NOT NULL DEFAULT 0,
    "cancelled"       INTEGER      NOT NULL DEFAULT 0,
    "totalDurationMs" INTEGER      NOT NULL DEFAULT 0,
    "avgDurationMs"   INTEGER      NOT NULL DEFAULT 0,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_execution_metrics_pkey" PRIMARY KEY ("id")
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS "agent_execution_metrics_runAt_idx"
  ON "agent_execution_metrics"("runAt" DESC);

CREATE INDEX IF NOT EXISTS "agent_execution_metrics_createdAt_idx"
  ON "agent_execution_metrics"("createdAt" DESC);
