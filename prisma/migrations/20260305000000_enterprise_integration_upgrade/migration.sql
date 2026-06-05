-- ============================================================
-- Migration: enterprise_integration_upgrade
-- Purpose  : Add encrypted credential fields + incremental sync
--            support to ProviderConnection, create ConnectorHealth
--            table for health-monitoring, and enforce per-tenant
--            unique constraint on (companyId, provider).
-- ============================================================

-- ── 1. New columns on ProviderConnection ──────────────────────

-- AES-256-GCM encrypted OAuth access token
ALTER TABLE "ProviderConnection"
  ADD COLUMN IF NOT EXISTS "accessToken" TEXT;

-- AES-256-GCM encrypted OAuth refresh token
ALTER TABLE "ProviderConnection"
  ADD COLUMN IF NOT EXISTS "refreshToken" TEXT;

-- AES-256-GCM encrypted API key (non-OAuth providers)
ALTER TABLE "ProviderConnection"
  ADD COLUMN IF NOT EXISTS "apiKey" TEXT;

-- AES-256-GCM encrypted client secret
ALTER TABLE "ProviderConnection"
  ADD COLUMN IF NOT EXISTS "clientSecret" TEXT;

-- OAuth token expiry timestamp
ALTER TABLE "ProviderConnection"
  ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3);

-- Comma-separated OAuth scopes granted by the provider
ALTER TABLE "ProviderConnection"
  ADD COLUMN IF NOT EXISTS "scopes" TEXT;

-- JSON array of integration permission scopes
ALTER TABLE "ProviderConnection"
  ADD COLUMN IF NOT EXISTS "permissions" JSONB NOT NULL DEFAULT '[]';

-- Last successful sync timestamp (used for incremental sync)
ALTER TABLE "ProviderConnection"
  ADD COLUMN IF NOT EXISTS "lastSyncAt" TIMESTAMP(3);

-- Opaque provider cursor for delta / pagination sync
ALTER TABLE "ProviderConnection"
  ADD COLUMN IF NOT EXISTS "syncCursor" TEXT;

-- ── 2. Unique constraint on ProviderConnection(companyId, provider) ──

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ProviderConnection_companyId_provider_key'
  ) THEN
    ALTER TABLE "ProviderConnection"
      ADD CONSTRAINT "ProviderConnection_companyId_provider_key"
      UNIQUE ("companyId", "provider");
  END IF;
END$$;

-- ── 3. Create connector_health table ─────────────────────────

CREATE TABLE IF NOT EXISTS "connector_health" (
    "id"                  TEXT         NOT NULL,
    "companyId"           TEXT         NOT NULL,
    "provider"            "IntegrationProvider" NOT NULL,
    "status"              VARCHAR(20)  NOT NULL DEFAULT 'HEALTHY',
    "lastSyncAt"          TIMESTAMP(3),
    "errorRate"           DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgLatencyMs"        DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastError"           TEXT,
    "consecutiveFailures" INTEGER      NOT NULL DEFAULT 0,
    "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connector_health_pkey" PRIMARY KEY ("id")
);

-- ── 4. Unique + FK constraints on connector_health ───────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'connector_health_companyId_provider_key'
  ) THEN
    ALTER TABLE "connector_health"
      ADD CONSTRAINT "connector_health_companyId_provider_key"
      UNIQUE ("companyId", "provider");
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'connector_health_companyId_fkey'
  ) THEN
    ALTER TABLE "connector_health"
      ADD CONSTRAINT "connector_health_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "Company"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

-- ── 5. Indexes on connector_health ───────────────────────────

CREATE INDEX IF NOT EXISTS "connector_health_companyId_idx"
  ON "connector_health"("companyId");

CREATE INDEX IF NOT EXISTS "connector_health_companyId_status_idx"
  ON "connector_health"("companyId", "status");

-- ── 6. updatedAt trigger for connector_health ─────────────────
-- Prisma expects updatedAt to be managed at the DB level when using
-- @updatedAt; create a simple trigger so manual SQL updates also keep
-- the column accurate.

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'set_connector_health_updated_at'
  ) THEN
    CREATE TRIGGER set_connector_health_updated_at
    BEFORE UPDATE ON "connector_health"
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END$$;
