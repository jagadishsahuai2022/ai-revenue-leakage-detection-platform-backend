// ─────────────────────────────────────────────────────────────────────────────
// Scheduled Connector Sync Job
//
// A cron-friendly, zero-infrastructure job that:
//   1. Queries all ACTIVE ProviderConnections
//   2. Runs ConnectorEngine.sync() for each
//   3. Logs success/failure per connection
//   4. Exits with code 0 (success) or 1 (any failures)
//
// Run via:
//   npx tsx src/jobs/scheduledConnectorSync.ts
//   — or —
//   npm run job:sync-connectors
//
// Schedule with Render Cron Jobs, Railway Cron, or OS-level cron.
// No Redis, no BullMQ, no queues required.
// ─────────────────────────────────────────────────────────────────────────────

import { PrismaClient } from "@prisma/client";
import pino from "pino";
import { env } from "../config/env";
import { ConnectorEngine } from "../application/connectors/ConnectorEngine";
import { ProviderRegistry } from "../application/connectors/ProviderRegistry";
import { startupJitter } from "../shared/utils/jitter";

const log = pino({ name: "scheduled-connector-sync", level: env.LOG_LEVEL });

async function runConnectorSyncJob(): Promise<void> {
  const prisma = new PrismaClient();

  try {
    // Stagger startup so multiple cron instances (multi-dyno / replicas) don't
    // all hit the database at the same instant.
    const staggerMs = await startupJitter(30_000);
    log.info(
      { staggerMs },
      "Startup jitter applied — beginning connector sync",
    );

    const registry = new ProviderRegistry(prisma);
    const supportedProviders = registry.supportedProviders();

    // Only sync connections whose provider has a registered adapter
    const connections = await prisma.providerConnection.findMany({
      where: {
        status: "ACTIVE",
        provider: { in: supportedProviders },
      },
      select: {
        id: true,
        companyId: true,
        provider: true,
        lastSyncAt: true,
      },
    });

    log.info(
      { totalConnections: connections.length, supportedProviders },
      `Found ${connections.length} active connection(s) to sync`,
    );

    if (connections.length === 0) {
      log.info("No active connections to sync. Exiting.");
      return;
    }

    const engine = new ConnectorEngine(prisma);
    let successes = 0;
    let failures = 0;

    for (const conn of connections) {
      const label = `${conn.provider}/${conn.companyId}`;
      try {
        log.info(
          {
            connectionId: conn.id,
            provider: conn.provider,
            companyId: conn.companyId,
          },
          `Syncing ${label}`,
        );

        const result = await engine.sync(conn.companyId, conn.provider, {
          connectionId: conn.id,
          // Incremental sync: ConnectorEngine auto-uses lastSyncAt when `since` is omitted
        });

        log.info(
          {
            connectionId: conn.id,
            provider: conn.provider,
            transactions: result.transactionsIngested,
            subscriptions: result.subscriptionsFound,
            durationMs: result.durationMs,
          },
          `Sync OK: ${label} — ${result.transactionsIngested} txn, ${result.durationMs}ms`,
        );
        successes++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error(
          { connectionId: conn.id, provider: conn.provider, error: msg },
          `Sync FAILED: ${label}`,
        );
        failures++;
      }
    }

    log.info(
      { successes, failures, total: connections.length },
      `Scheduled sync complete: ${successes} OK, ${failures} failed out of ${connections.length}`,
    );

    if (failures > 0) {
      process.exitCode = 1;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.fatal({ error: msg }, "Scheduled connector sync crashed");
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

// ── Execute ──────────────────────────────────────────────────────────────────
runConnectorSyncJob();
