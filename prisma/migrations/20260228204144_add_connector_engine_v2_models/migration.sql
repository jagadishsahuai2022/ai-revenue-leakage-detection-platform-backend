-- CreateTable
CREATE TABLE "ProviderConnection" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'INACTIVE',
    "encryptedConfig" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConnectorEventRecord" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "eventType" TEXT NOT NULL,
    "externalId" TEXT,
    "rawPayload" JSONB NOT NULL DEFAULT '{}',
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConnectorEventRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RevenueEventLog" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RevenueEventLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProviderConnection_companyId_provider_idx" ON "ProviderConnection"("companyId", "provider");

-- CreateIndex
CREATE INDEX "ConnectorEventRecord_companyId_idx" ON "ConnectorEventRecord"("companyId");

-- CreateIndex
CREATE INDEX "ConnectorEventRecord_companyId_provider_idx" ON "ConnectorEventRecord"("companyId", "provider");

-- CreateIndex
CREATE INDEX "ConnectorEventRecord_companyId_eventType_idx" ON "ConnectorEventRecord"("companyId", "eventType");

-- CreateIndex
CREATE INDEX "ConnectorEventRecord_companyId_externalId_idx" ON "ConnectorEventRecord"("companyId", "externalId");

-- CreateIndex
CREATE INDEX "RevenueEventLog_companyId_idx" ON "RevenueEventLog"("companyId");

-- CreateIndex
CREATE INDEX "RevenueEventLog_companyId_type_idx" ON "RevenueEventLog"("companyId", "type");

-- CreateIndex
CREATE INDEX "RevenueEventLog_companyId_createdAt_idx" ON "RevenueEventLog"("companyId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "ProviderConnection" ADD CONSTRAINT "ProviderConnection_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevenueEventLog" ADD CONSTRAINT "RevenueEventLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
