-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "defaultLanguage" TEXT NOT NULL DEFAULT 'en';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "preferredLanguage" TEXT;

-- CreateTable
CREATE TABLE "ui_typography_configs" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "headingFont" VARCHAR(100),
    "headingFontSize" VARCHAR(20),
    "gridHeaderFont" VARCHAR(100),
    "gridHeaderFontSize" VARCHAR(20),
    "gridRowFont" VARCHAR(100),
    "gridRowFontSize" VARCHAR(20),
    "menuFont" VARCHAR(100),
    "menuFontSize" VARCHAR(20),
    "navigationFont" VARCHAR(100),
    "navigationFontSize" VARCHAR(20),
    "labelFont" VARCHAR(100),
    "labelFontSize" VARCHAR(20),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ui_typography_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ui_typography_configs_companyId_key" ON "ui_typography_configs"("companyId");

-- CreateIndex
CREATE INDEX "ui_typography_configs_companyId_idx" ON "ui_typography_configs"("companyId");

-- AddForeignKey
ALTER TABLE "ui_typography_configs" ADD CONSTRAINT "ui_typography_configs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
