-- AlterTable
ALTER TABLE "ai_insights" ADD COLUMN     "modelId" VARCHAR(120);

-- AlterTable
ALTER TABLE "ai_usage" ADD COLUMN     "lastModelUsed" VARCHAR(120);

-- CreateTable
CREATE TABLE "ai_models" (
    "id" VARCHAR(120) NOT NULL,
    "displayName" VARCHAR(80) NOT NULL,
    "provider" VARCHAR(40) NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "isFree" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_models_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_models_provider_idx" ON "ai_models"("provider");

-- CreateIndex
CREATE INDEX "ai_models_isEnabled_idx" ON "ai_models"("isEnabled");

-- AddForeignKey
ALTER TABLE "ai_insights" ADD CONSTRAINT "ai_insights_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "ai_models"("id") ON DELETE SET NULL ON UPDATE CASCADE;
