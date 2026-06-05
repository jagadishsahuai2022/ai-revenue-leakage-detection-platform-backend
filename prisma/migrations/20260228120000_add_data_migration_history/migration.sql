-- CreateTable: DataMigrationHistory
-- Tracks which data-migration scripts have been executed.
-- Safe to run multiple times (idempotent via IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS "DataMigrationHistory" (
    "id"          TEXT NOT NULL,
    "version"     TEXT NOT NULL,
    "executedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataMigrationHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "DataMigrationHistory_version_key"
    ON "DataMigrationHistory"("version");
