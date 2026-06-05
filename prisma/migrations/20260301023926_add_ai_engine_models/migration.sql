-- CreateTable
CREATE TABLE "ai_insights" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "insightType" VARCHAR(50) NOT NULL DEFAULT 'COMPOSITE',
    "severity" VARCHAR(20) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "summary" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "riskScore" INTEGER NOT NULL DEFAULT 0,
    "windowStart" TIMESTAMP(3),
    "windowEnd" TIMESTAMP(3),
    "llmEnriched" BOOLEAN NOT NULL DEFAULT false,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_insights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_model_usage" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "model" VARCHAR(100) NOT NULL,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(10,6),
    "purpose" VARCHAR(100) NOT NULL,
    "insightId" TEXT,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_model_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_insights_companyId_idx" ON "ai_insights"("companyId");

-- CreateIndex
CREATE INDEX "ai_insights_companyId_createdAt_idx" ON "ai_insights"("companyId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ai_insights_companyId_severity_idx" ON "ai_insights"("companyId", "severity");

-- CreateIndex
CREATE INDEX "ai_insights_companyId_isRead_idx" ON "ai_insights"("companyId", "isRead");

-- CreateIndex
CREATE INDEX "ai_model_usage_companyId_idx" ON "ai_model_usage"("companyId");

-- CreateIndex
CREATE INDEX "ai_model_usage_companyId_createdAt_idx" ON "ai_model_usage"("companyId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ai_model_usage_insightId_idx" ON "ai_model_usage"("insightId");

-- AddForeignKey
ALTER TABLE "ai_insights" ADD CONSTRAINT "ai_insights_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_model_usage" ADD CONSTRAINT "ai_model_usage_insightId_fkey" FOREIGN KEY ("insightId") REFERENCES "ai_insights"("id") ON DELETE SET NULL ON UPDATE CASCADE;
