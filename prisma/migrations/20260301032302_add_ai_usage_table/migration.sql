-- CreateTable
CREATE TABLE "ai_usage" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "totalRuns" INTEGER NOT NULL DEFAULT 0,
    "totalInsights" INTEGER NOT NULL DEFAULT 0,
    "tokensUsed" INTEGER NOT NULL DEFAULT 0,
    "quotaRemaining" INTEGER NOT NULL DEFAULT 100,
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_usage_companyId_key" ON "ai_usage"("companyId");

-- CreateIndex
CREATE INDEX "ai_usage_companyId_idx" ON "ai_usage"("companyId");

-- AddForeignKey
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
