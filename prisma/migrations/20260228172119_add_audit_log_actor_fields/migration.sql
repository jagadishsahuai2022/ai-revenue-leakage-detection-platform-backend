/*
  Warnings:

  - You are about to drop the column `userId` on the `AuditLog` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_userId_fkey";

-- DropIndex
DROP INDEX "AuditLog_companyId_createdAt_idx";

-- DropIndex
DROP INDEX "AuditLog_userId_idx";

-- AlterTable
ALTER TABLE "AuditLog" DROP COLUMN "userId",
ADD COLUMN     "actorEmail" TEXT,
ADD COLUMN     "actorId" TEXT,
ADD COLUMN     "actorName" TEXT,
ADD COLUMN     "detail" TEXT,
ADD COLUMN     "resourceType" TEXT,
ALTER COLUMN "resource" SET DEFAULT '';

-- CreateIndex
CREATE INDEX "AuditLog_companyId_createdAt_idx" ON "AuditLog"("companyId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");
