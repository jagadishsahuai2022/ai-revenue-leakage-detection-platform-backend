-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "after" JSONB,
ADD COLUMN     "before" JSONB;

-- CreateTable
CREATE TABLE "ai_recommendations" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "insightId" TEXT NOT NULL,
    "recommendationType" VARCHAR(60) NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "impactScore" DOUBLE PRECISION NOT NULL,
    "llmModel" VARCHAR(120) NOT NULL,
    "promptVersion" VARCHAR(30) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_executions" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "actionRequestId" TEXT NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "executedAt" TIMESTAMP(3),
    "result" JSONB,
    "error" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "action_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_flags" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "feature" VARCHAR(100) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connector_sync_logs" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "connector" VARCHAR(40) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "recordsSynced" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connector_sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_recommendations_companyId_idx" ON "ai_recommendations"("companyId");

-- CreateIndex
CREATE INDEX "ai_recommendations_companyId_insightId_idx" ON "ai_recommendations"("companyId", "insightId");

-- CreateIndex
CREATE INDEX "ai_recommendations_companyId_status_idx" ON "ai_recommendations"("companyId", "status");

-- CreateIndex
CREATE INDEX "ai_recommendations_companyId_recommendationType_idx" ON "ai_recommendations"("companyId", "recommendationType");

-- CreateIndex
CREATE UNIQUE INDEX "action_executions_idempotencyKey_key" ON "action_executions"("idempotencyKey");

-- CreateIndex
CREATE INDEX "action_executions_companyId_idx" ON "action_executions"("companyId");

-- CreateIndex
CREATE INDEX "action_executions_companyId_actionRequestId_idx" ON "action_executions"("companyId", "actionRequestId");

-- CreateIndex
CREATE INDEX "action_executions_companyId_status_idx" ON "action_executions"("companyId", "status");

-- CreateIndex
CREATE INDEX "feature_flags_companyId_idx" ON "feature_flags"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "feature_flags_companyId_feature_key" ON "feature_flags"("companyId", "feature");

-- CreateIndex
CREATE INDEX "connector_sync_logs_companyId_idx" ON "connector_sync_logs"("companyId");

-- CreateIndex
CREATE INDEX "connector_sync_logs_companyId_connector_idx" ON "connector_sync_logs"("companyId", "connector");

-- CreateIndex
CREATE INDEX "connector_sync_logs_companyId_createdAt_idx" ON "connector_sync_logs"("companyId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "ai_recommendations" ADD CONSTRAINT "ai_recommendations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_executions" ADD CONSTRAINT "action_executions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connector_sync_logs" ADD CONSTRAINT "connector_sync_logs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
