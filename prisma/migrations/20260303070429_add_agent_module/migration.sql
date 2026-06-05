-- CreateTable
CREATE TABLE "agent_action_proposals" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "insightId" TEXT NOT NULL,
    "actionType" VARCHAR(60) NOT NULL,
    "priorityScore" DOUBLE PRECISION NOT NULL,
    "confidenceScore" DOUBLE PRECISION NOT NULL,
    "estimatedImpact" DOUBLE PRECISION NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "rationale" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PROPOSED',
    "requiresApproval" BOOLEAN NOT NULL DEFAULT true,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_action_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_execution_logs" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "executionType" VARCHAR(60) NOT NULL,
    "payload" JSONB NOT NULL,
    "result" JSONB,
    "status" VARCHAR(20) NOT NULL,
    "errorMessage" TEXT,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_execution_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_action_proposals_companyId_idx" ON "agent_action_proposals"("companyId");

-- CreateIndex
CREATE INDEX "agent_action_proposals_insightId_idx" ON "agent_action_proposals"("insightId");

-- CreateIndex
CREATE INDEX "agent_action_proposals_companyId_status_idx" ON "agent_action_proposals"("companyId", "status");

-- CreateIndex
CREATE INDEX "agent_execution_logs_companyId_idx" ON "agent_execution_logs"("companyId");

-- CreateIndex
CREATE INDEX "agent_execution_logs_proposalId_idx" ON "agent_execution_logs"("proposalId");

-- CreateIndex
CREATE INDEX "agent_execution_logs_companyId_status_idx" ON "agent_execution_logs"("companyId", "status");

-- AddForeignKey
ALTER TABLE "agent_execution_logs" ADD CONSTRAINT "agent_execution_logs_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "agent_action_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
