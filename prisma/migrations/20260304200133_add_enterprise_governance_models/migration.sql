-- CreateTable
CREATE TABLE "api_idempotency_keys" (
    "id" TEXT NOT NULL,
    "key" VARCHAR(255) NOT NULL,
    "companyId" TEXT NOT NULL,
    "route" VARCHAR(500) NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "responseBody" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "api_idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dead_letter_events" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "source" VARCHAR(100) NOT NULL,
    "eventType" VARCHAR(100) NOT NULL,
    "payload" JSONB NOT NULL,
    "error" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dead_letter_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_approvals" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "approver1Id" TEXT,
    "approver1At" TIMESTAMP(3),
    "approver2Id" TEXT,
    "approver2At" TIMESTAMP(3),
    "status" VARCHAR(30) NOT NULL DEFAULT 'PENDING_FIRST',
    "rejectedBy" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "action_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_safety_logs" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "model" VARCHAR(120) NOT NULL,
    "promptSnippet" TEXT NOT NULL,
    "completionSnippet" TEXT NOT NULL,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER,
    "flaggedHallucination" BOOLEAN NOT NULL DEFAULT false,
    "flaggedPolicyViolation" BOOLEAN NOT NULL DEFAULT false,
    "flaggedPromptInjection" BOOLEAN NOT NULL DEFAULT false,
    "safetyNotes" TEXT,
    "verdict" VARCHAR(20) NOT NULL DEFAULT 'SAFE',
    "insightId" VARCHAR(30),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_safety_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_idempotency_keys_key_key" ON "api_idempotency_keys"("key");

-- CreateIndex
CREATE INDEX "api_idempotency_keys_companyId_idx" ON "api_idempotency_keys"("companyId");

-- CreateIndex
CREATE INDEX "api_idempotency_keys_expiresAt_idx" ON "api_idempotency_keys"("expiresAt");

-- CreateIndex
CREATE INDEX "dead_letter_events_companyId_idx" ON "dead_letter_events"("companyId");

-- CreateIndex
CREATE INDEX "dead_letter_events_companyId_source_idx" ON "dead_letter_events"("companyId", "source");

-- CreateIndex
CREATE INDEX "dead_letter_events_resolved_idx" ON "dead_letter_events"("resolved");

-- CreateIndex
CREATE INDEX "action_approvals_companyId_idx" ON "action_approvals"("companyId");

-- CreateIndex
CREATE INDEX "action_approvals_companyId_status_idx" ON "action_approvals"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "action_approvals_proposalId_key" ON "action_approvals"("proposalId");

-- CreateIndex
CREATE INDEX "ai_safety_logs_companyId_idx" ON "ai_safety_logs"("companyId");

-- CreateIndex
CREATE INDEX "ai_safety_logs_companyId_createdAt_idx" ON "ai_safety_logs"("companyId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ai_safety_logs_verdict_idx" ON "ai_safety_logs"("verdict");

-- CreateIndex
CREATE INDEX "ai_safety_logs_flaggedHallucination_idx" ON "ai_safety_logs"("flaggedHallucination");

-- CreateIndex
CREATE INDEX "ai_safety_logs_insightId_idx" ON "ai_safety_logs"("insightId");
