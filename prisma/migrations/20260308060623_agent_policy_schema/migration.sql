-- AlterTable
ALTER TABLE "agent_action_proposals" ADD COLUMN     "impactScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "riskScore" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "agent_execution_metrics" ADD COLUMN     "actionType" VARCHAR(60),
ADD COLUMN     "companyId" TEXT,
ADD COLUMN     "error" TEXT,
ADD COLUMN     "executionTimeMs" INTEGER,
ADD COLUMN     "revenueRecovered" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "success" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "ai_safety_logs" ADD COLUMN     "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "flagged" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "hallucinationRiskScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "promptHash" VARCHAR(64) NOT NULL DEFAULT '',
ADD COLUMN     "responseHash" VARCHAR(64) NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "connector_health" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "agent_policy_configs" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "refundThreshold" DOUBLE PRECISION NOT NULL DEFAULT 500,
    "autoExecuteImpactLimit" DOUBLE PRECISION NOT NULL DEFAULT 200,
    "confidenceThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_policy_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_policy_configs_companyId_key" ON "agent_policy_configs"("companyId");

-- CreateIndex
CREATE INDEX "agent_policy_configs_companyId_idx" ON "agent_policy_configs"("companyId");

-- CreateIndex
CREATE INDEX "agent_execution_metrics_companyId_idx" ON "agent_execution_metrics"("companyId");

-- CreateIndex
CREATE INDEX "agent_execution_metrics_companyId_actionType_idx" ON "agent_execution_metrics"("companyId", "actionType");

-- AddForeignKey
ALTER TABLE "agent_policy_configs" ADD CONSTRAINT "agent_policy_configs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
