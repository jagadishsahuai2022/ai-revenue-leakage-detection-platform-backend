-- AlterTable
ALTER TABLE "ai_recommendations" ADD COLUMN     "explanation" TEXT;

-- AlterTable
ALTER TABLE "ai_usage" ADD COLUMN     "monthlyLimit" INTEGER NOT NULL DEFAULT 1000,
ADD COLUMN     "monthlyResetAt" TIMESTAMP(3),
ADD COLUMN     "monthlyUsed" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "product_event_logs" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT,
    "eventType" VARCHAR(80) NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_event_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_event_logs_companyId_idx" ON "product_event_logs"("companyId");

-- CreateIndex
CREATE INDEX "product_event_logs_companyId_eventType_idx" ON "product_event_logs"("companyId", "eventType");

-- CreateIndex
CREATE INDEX "product_event_logs_createdAt_idx" ON "product_event_logs"("createdAt" DESC);

-- AddForeignKey
ALTER TABLE "product_event_logs" ADD CONSTRAINT "product_event_logs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
