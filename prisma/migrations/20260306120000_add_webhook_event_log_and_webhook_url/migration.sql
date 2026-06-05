-- Add webhookUrl field to ProviderConnection
ALTER TABLE "ProviderConnection" ADD COLUMN "webhookUrl" TEXT;

-- Create WebhookEventLog table for webhook deduplication
CREATE TABLE "webhook_event_logs" (
    "id" TEXT NOT NULL,
    "provider" VARCHAR(40) NOT NULL,
    "eventId" VARCHAR(255) NOT NULL,
    "companyId" TEXT,
    "payloadHash" VARCHAR(64) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_event_logs_pkey" PRIMARY KEY ("id")
);

-- Unique constraint for deduplication
CREATE UNIQUE INDEX "webhook_event_logs_provider_eventId_key" ON "webhook_event_logs"("provider", "eventId");

-- Performance indexes
CREATE INDEX "webhook_event_logs_provider_idx" ON "webhook_event_logs"("provider");
CREATE INDEX "webhook_event_logs_companyId_idx" ON "webhook_event_logs"("companyId");
CREATE INDEX "webhook_event_logs_receivedAt_idx" ON "webhook_event_logs"("receivedAt");
