-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'COMPANY_ADMIN', 'ANALYST', 'VIEWER');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'UNPAID');

-- CreateEnum
CREATE TYPE "SubscriptionPlan" AS ENUM ('STARTER', 'GROWTH', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "LeakageCategory" AS ENUM ('CHURN', 'DUNNING_FAILURE', 'PRICING_GAP', 'FAILED_UPSELL', 'REFUND', 'DISCOUNT_ABUSE', 'INVOICE_ERROR');

-- CreateEnum
CREATE TYPE "IntegrationProvider" AS ENUM ('GITHUB', 'STRIPE', 'SLACK', 'CUSTOM');

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ERROR');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "domain" TEXT,
    "logoUrl" TEXT,
    "subscriptionId" TEXT,
    "stripeCustomerId" TEXT,
    "plan" "SubscriptionPlan" NOT NULL DEFAULT 'STARTER',
    "subscriptionStatus" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "trialEndsAt" TIMESTAMP(3),
    "billingEmail" TEXT,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "name" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'VIEWER',
    "githubId" TEXT,
    "githubUsername" TEXT,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Revenue" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "externalId" TEXT,
    "customerId" TEXT,
    "customerEmail" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "mrr" DECIMAL(14,2),
    "arr" DECIMAL(14,2),
    "product" TEXT,
    "plan" TEXT,
    "period" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Revenue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RevenueLeakage" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "revenueId" TEXT,
    "category" "LeakageCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "riskScore" INTEGER NOT NULL DEFAULT 0,
    "isResolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RevenueLeakage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "stripeInvoiceId" TEXT,
    "stripeCustomerId" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "status" TEXT NOT NULL,
    "invoiceUrl" TEXT,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionItem" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "stripeSubscriptionId" TEXT NOT NULL,
    "stripePriceId" TEXT NOT NULL,
    "plan" "SubscriptionPlan" NOT NULL,
    "status" "SubscriptionStatus" NOT NULL,
    "currentPeriodStart" TIMESTAMP(3) NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Integration" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'INACTIVE',
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "externalId" TEXT,
    "config" JSONB NOT NULL DEFAULT '{}',
    "lastSyncAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Integration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "resourceId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobLog" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "jobName" TEXT NOT NULL,
    "jobId" TEXT,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB NOT NULL DEFAULT '{}',
    "result" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Company_slug_key" ON "Company"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Company_domain_key" ON "Company"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "Company_subscriptionId_key" ON "Company"("subscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "Company_stripeCustomerId_key" ON "Company"("stripeCustomerId");

-- CreateIndex
CREATE INDEX "Company_slug_idx" ON "Company"("slug");

-- CreateIndex
CREATE INDEX "Company_stripeCustomerId_idx" ON "Company"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "User_githubId_key" ON "User"("githubId");

-- CreateIndex
CREATE INDEX "User_companyId_idx" ON "User"("companyId");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_githubId_idx" ON "User"("githubId");

-- CreateIndex
CREATE UNIQUE INDEX "User_companyId_email_key" ON "User"("companyId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_token_key" ON "RefreshToken"("token");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "RefreshToken_token_idx" ON "RefreshToken"("token");

-- CreateIndex
CREATE INDEX "Revenue_companyId_idx" ON "Revenue"("companyId");

-- CreateIndex
CREATE INDEX "Revenue_companyId_period_idx" ON "Revenue"("companyId", "period");

-- CreateIndex
CREATE INDEX "Revenue_companyId_customerId_idx" ON "Revenue"("companyId", "customerId");

-- CreateIndex
CREATE INDEX "Revenue_period_idx" ON "Revenue"("period");

-- CreateIndex
CREATE UNIQUE INDEX "Revenue_companyId_externalId_key" ON "Revenue"("companyId", "externalId");

-- CreateIndex
CREATE INDEX "RevenueLeakage_companyId_idx" ON "RevenueLeakage"("companyId");

-- CreateIndex
CREATE INDEX "RevenueLeakage_companyId_category_idx" ON "RevenueLeakage"("companyId", "category");

-- CreateIndex
CREATE INDEX "RevenueLeakage_companyId_isResolved_idx" ON "RevenueLeakage"("companyId", "isResolved");

-- CreateIndex
CREATE INDEX "RevenueLeakage_companyId_detectedAt_idx" ON "RevenueLeakage"("companyId", "detectedAt");

-- CreateIndex
CREATE INDEX "RevenueLeakage_riskScore_idx" ON "RevenueLeakage"("riskScore");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_stripeInvoiceId_key" ON "Invoice"("stripeInvoiceId");

-- CreateIndex
CREATE INDEX "Invoice_companyId_idx" ON "Invoice"("companyId");

-- CreateIndex
CREATE INDEX "Invoice_stripeInvoiceId_idx" ON "Invoice"("stripeInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionItem_stripeSubscriptionId_key" ON "SubscriptionItem"("stripeSubscriptionId");

-- CreateIndex
CREATE INDEX "SubscriptionItem_companyId_idx" ON "SubscriptionItem"("companyId");

-- CreateIndex
CREATE INDEX "Integration_companyId_idx" ON "Integration"("companyId");

-- CreateIndex
CREATE INDEX "Integration_provider_idx" ON "Integration"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "Integration_companyId_provider_key" ON "Integration"("companyId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "ApiKey_companyId_idx" ON "ApiKey"("companyId");

-- CreateIndex
CREATE INDEX "ApiKey_keyHash_idx" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "AuditLog_companyId_idx" ON "AuditLog"("companyId");

-- CreateIndex
CREATE INDEX "AuditLog_companyId_action_idx" ON "AuditLog"("companyId", "action");

-- CreateIndex
CREATE INDEX "AuditLog_companyId_createdAt_idx" ON "AuditLog"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "JobLog_companyId_idx" ON "JobLog"("companyId");

-- CreateIndex
CREATE INDEX "JobLog_jobName_status_idx" ON "JobLog"("jobName", "status");

-- CreateIndex
CREATE INDEX "JobLog_createdAt_idx" ON "JobLog"("createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Revenue" ADD CONSTRAINT "Revenue_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevenueLeakage" ADD CONSTRAINT "RevenueLeakage_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevenueLeakage" ADD CONSTRAINT "RevenueLeakage_revenueId_fkey" FOREIGN KEY ("revenueId") REFERENCES "Revenue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionItem" ADD CONSTRAINT "SubscriptionItem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Integration" ADD CONSTRAINT "Integration_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
