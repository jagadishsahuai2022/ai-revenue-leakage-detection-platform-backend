-- CreateTable
CREATE TABLE "test_credentials" (
    "id" TEXT NOT NULL,
    "providerId" VARCHAR(50) NOT NULL,
    "label" VARCHAR(100) NOT NULL DEFAULT 'Test Credentials',
    "credentials" JSONB NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "test_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "test_credentials_providerId_key" ON "test_credentials"("providerId");

-- CreateIndex
CREATE INDEX "test_credentials_providerId_idx" ON "test_credentials"("providerId");

-- CreateIndex
CREATE INDEX "test_credentials_isActive_idx" ON "test_credentials"("isActive");
