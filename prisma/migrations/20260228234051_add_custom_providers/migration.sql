-- CreateTable
CREATE TABLE "CustomProvider" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(300) NOT NULL DEFAULT '',
    "iconBg" VARCHAR(7) NOT NULL DEFAULT '#6b7280',
    "iconSvgPath" TEXT NOT NULL DEFAULT '',
    "iconPresetKey" VARCHAR(50) NOT NULL DEFAULT '',
    "authType" TEXT NOT NULL DEFAULT 'api_key',
    "baseUrl" VARCHAR(500),
    "fields" JSONB NOT NULL DEFAULT '[]',
    "webhookSupport" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'DISCONNECTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomProvider_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomProvider_companyId_idx" ON "CustomProvider"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomProvider_companyId_name_key" ON "CustomProvider"("companyId", "name");

-- AddForeignKey
ALTER TABLE "CustomProvider" ADD CONSTRAINT "CustomProvider_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomProvider" ADD CONSTRAINT "CustomProvider_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
