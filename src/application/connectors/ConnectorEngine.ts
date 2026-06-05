import { PrismaClient, IntegrationProvider, Prisma } from "@prisma/client";

import { RevenueIntelligenceEngine } from "../../domain/intelligence";
import { ProviderRegistry } from "./ProviderRegistry";
import { ConnectorHealthService } from "./ConnectorHealthService";
import {
  IntegrationAuditService,
  AuditContext,
} from "./IntegrationAuditService";
import { IntegrationPermissionService } from "./IntegrationPermissionService";
import { TokenRefreshService } from "./TokenRefreshService";
import {
  executeWithRetry,
  sendToDeadLetterQueue,
} from "../../shared/utils/dlq-retry";

/**
 * Options accepted by `ConnectorEngine.sync`.
 */
export interface SyncOptions {
  /**
   * Only fetch data created/updated after this timestamp (incremental sync).
   * When omitted AND the connection has a `lastSyncAt`, uses that for incremental.
   * Pass `null` explicitly for a forced full sync.
   */
  since?: Date | null;

  /**
   * If provided, AI-derived insights will be generated after data ingestion.
   * Omit (or pass `undefined`) to skip the intelligence phase.
   */
  intelligenceEngine?: RevenueIntelligenceEngine;

  /** Audit context for logging the sync action */
  auditContext?: AuditContext;

  /** Connection ID to use for permission checks and token refresh */
  connectionId?: string;
}

/**
 * Summary returned after a completed sync.
 */
export interface SyncResult {
  provider: string;
  companyId: string;
  transactionsIngested: number;
  subscriptionsFound: number;
  insightsGenerated: number;
  startedAt: Date;
  completedAt: Date;
  durationMs: number;
  incremental: boolean;
  syncCursor?: string;
}

/**
 * Maximum retry attempts for failed sync operations.
 * Kept low (1) so that interactive manual syncs fail fast;
 * scheduled cron jobs rely on the job scheduler for retries.
 */
const MAX_SYNC_RETRIES = 1;

/**
 * ConnectorEngine v2 — orchestrates the full revenue-data sync lifecycle.
 *
 * Responsibilities:
 *  1. Resolve the correct `RevenueProvider` adapter for the given provider.
 *  2. Emit a `SYNC_STARTED` event record.
 *  3. Fetch normalised transactions and subscriptions.
 *  4. Upsert each transaction into the `Revenue` table (idempotent).
 *  5. Optionally run the `RevenueIntelligenceEngine`.
 *  6. Emit a `SYNC_COMPLETED` (or `SYNC_FAILED` on error) event record.
 *  7. Write a summary entry to `RevenueEventLog`.
 *  8. Update ConnectorHealth metrics.
 *  9. Log to ConnectorSyncLog for observability.
 * 10. Support incremental sync via lastSyncAt / syncCursor.
 * 11. Retry with exponential backoff; DLQ on exhaustion.
 *
 * @example
 * const engine = new ConnectorEngine(fastify.prisma);
 * const result = await engine.sync('company-cuid', IntegrationProvider.STRIPE);
 */
export class ConnectorEngine {
  private readonly registry: ProviderRegistry;
  private readonly healthService: ConnectorHealthService;
  private readonly auditService: IntegrationAuditService;
  private readonly permissionService: IntegrationPermissionService;
  private readonly tokenRefreshService: TokenRefreshService;

  constructor(private readonly prisma: PrismaClient) {
    this.registry = new ProviderRegistry(prisma);
    this.healthService = new ConnectorHealthService(prisma);
    this.auditService = new IntegrationAuditService(prisma);
    this.permissionService = new IntegrationPermissionService(prisma);
    this.tokenRefreshService = new TokenRefreshService(prisma);
  }

  async sync(
    companyId: string,
    provider: IntegrationProvider,
    options: SyncOptions = {},
  ): Promise<SyncResult> {
    const { intelligenceEngine, auditContext, connectionId } = options;
    const startedAt = new Date();
    const adapter = this.registry.resolve(provider);
    const requestId = auditContext?.requestId ?? crypto.randomUUID();

    // ── 0. Permission check ────────────────────────────────────────────────
    if (connectionId) {
      await this.permissionService.enforcePermission(
        connectionId,
        "TRIGGER_SYNC",
      );
    }

    // ── 0b. Token refresh if needed ────────────────────────────────────────
    if (connectionId) {
      try {
        await this.tokenRefreshService.getValidToken(connectionId);
      } catch {
        // Token refresh failed — continue anyway (adapter may use its own credentials)
      }
    }

    // ── 0c. Determine incremental sync boundary ────────────────────────────
    let since = options.since;
    if (since === undefined && connectionId) {
      // Auto-incremental: use connection's lastSyncAt
      const conn = await this.prisma.providerConnection.findUnique({
        where: { id: connectionId },
        select: { lastSyncAt: true, syncCursor: true },
      });
      since = conn?.lastSyncAt ?? undefined;
    }

    const isIncremental = since != null;

    // ── Audit: sync triggered ──────────────────────────────────────────────
    if (auditContext) {
      await this.auditService.logSyncTriggered(
        auditContext,
        provider,
        connectionId ?? companyId,
      );
    }

    // ── 1. Emit SYNC_STARTED event ─────────────────────────────────────────
    await this.emitEvent(companyId, provider, "SYNC_STARTED", {
      since,
      incremental: isIncremental,
      requestId,
    });

    let transactionsIngested = 0;
    let subscriptionsFound = 0;
    let insightsGenerated = 0;

    try {
      // ── 2. Fetch provider data with retry + DLQ ──────────────────────────
      const { transactions, subscriptions } = await executeWithRetry(
        async () => {
          const [txs, subs] = await Promise.all([
            adapter.fetchTransactions(companyId, since ?? undefined),
            adapter.fetchSubscriptions(companyId),
          ]);
          return { transactions: txs, subscriptions: subs };
        },
        {
          maxRetries: MAX_SYNC_RETRIES,
          baseDelayMs: 1000,
          maxDelayMs: 30_000,
        },
        async (error, attempts) => {
          // On exhaustion → send to Dead Letter Queue
          await sendToDeadLetterQueue(this.prisma, {
            companyId,
            source: `ConnectorEngine.sync.${provider}`,
            eventType: "SYNC_FETCH_FAILED",
            payload: { provider, since: since?.toISOString(), requestId },
            error: error.message,
            retryCount: attempts,
          });
        },
      );

      subscriptionsFound = subscriptions.length;

      // ── 3. Upsert transactions into Revenue table ────────────────────────
      for (const tx of transactions) {
        if (!tx.externalId) continue;

        await this.prisma.revenue.upsert({
          where: {
            companyId_externalId: { companyId, externalId: tx.externalId },
          },
          create: {
            companyId,
            externalId: tx.externalId,
            customerId: tx.customerId ?? null,
            amount: tx.amountCents / 100,
            currency: tx.currency.toUpperCase(),
            period: tx.occurredAt,
            source: provider.toLowerCase(),
            metadata: (tx.metadata ?? {}) as object,
          },
          update: {
            // Do not overwrite manually-adjusted amounts; only update mutable fields
            metadata: (tx.metadata ?? {}) as object,
          },
        });

        transactionsIngested++;

        await this.emitEvent(
          companyId,
          provider,
          "TRANSACTION_RECEIVED",
          {
            externalId: tx.externalId,
            amountCents: tx.amountCents,
            currency: tx.currency,
          },
          tx.externalId,
        );
      }

      // ── 4. Optional AI analysis ──────────────────────────────────────────
      if (
        intelligenceEngine &&
        (transactions.length > 0 || subscriptions.length > 0)
      ) {
        const [txInsights, subInsights, leakInsights] = await Promise.all([
          intelligenceEngine.analyseTransactions(companyId, transactions),
          intelligenceEngine.analyseSubscriptions(companyId, subscriptions),
          intelligenceEngine.detectLeakage(
            companyId,
            transactions,
            subscriptions,
          ),
        ]);

        const allInsights = [...txInsights, ...subInsights, ...leakInsights];
        insightsGenerated = allInsights.length;

        for (const insight of allInsights) {
          await this.writeRevenueEventLog(companyId, "LEAKAGE_DETECTED", {
            type: insight.type,
            severity: insight.severity,
            title: insight.title,
            estimatedImpactCents: insight.estimatedImpactCents,
            currency: insight.currency,
            affectedExternalIds: insight.affectedExternalIds,
          });
        }
      }

      // ── 5. Emit SYNC_COMPLETED event ─────────────────────────────────────
      const completedAt = new Date();
      const durationMs = completedAt.getTime() - startedAt.getTime();

      await this.emitEvent(companyId, provider, "SYNC_COMPLETED", {
        transactionsIngested,
        subscriptionsFound,
        insightsGenerated,
        durationMs,
        incremental: isIncremental,
        requestId,
      });

      await this.writeRevenueEventLog(companyId, "SYNC_COMPLETED", {
        provider,
        transactionsIngested,
        subscriptionsFound,
        insightsGenerated,
        since,
        startedAt,
        completedAt,
      });

      // ── 6. Update ConnectorSyncLog ───────────────────────────────────────
      await this.prisma.connectorSyncLog.create({
        data: {
          companyId,
          connector: provider,
          status: "SUCCESS",
          recordsSynced: transactionsIngested,
          durationMs,
        },
      });

      // ── 7. Update ConnectorHealth ────────────────────────────────────────
      await this.healthService.recordSuccess(companyId, provider, durationMs);

      // ── 8. Update ProviderConnection incremental sync state ──────────────
      if (connectionId) {
        await this.prisma.providerConnection.update({
          where: { id: connectionId },
          data: {
            lastSyncAt: completedAt,
            // syncCursor could be updated from provider response if available
          },
        });
      }

      // ── 9. Audit: sync completed ────────────────────────────────────────
      if (auditContext) {
        await this.auditService.logSyncCompleted(
          auditContext,
          provider,
          connectionId ?? companyId,
          {
            transactionsIngested,
            subscriptionsFound,
            insightsGenerated,
            durationMs,
          },
        );
      }

      return {
        provider: adapter.providerId,
        companyId,
        transactionsIngested,
        subscriptionsFound,
        insightsGenerated,
        startedAt,
        completedAt,
        durationMs,
        incremental: isIncremental,
      };
    } catch (error) {
      const completedAt = new Date();
      const durationMs = completedAt.getTime() - startedAt.getTime();
      const errorMsg = error instanceof Error ? error.message : String(error);

      // ── Emit SYNC_FAILED event ───────────────────────────────────────────
      await this.emitEvent(companyId, provider, "SYNC_FAILED", {
        error: errorMsg,
        durationMs,
        requestId,
      });

      // ── Update ConnectorSyncLog (failure) ────────────────────────────────
      await this.prisma.connectorSyncLog.create({
        data: {
          companyId,
          connector: provider,
          status: "FAILED",
          recordsSynced: transactionsIngested,
          error: errorMsg.slice(0, 2000),
          durationMs,
        },
      });

      // ── Update ConnectorHealth (failure) ─────────────────────────────────
      await this.healthService.recordFailure(
        companyId,
        provider,
        errorMsg,
        durationMs,
      );

      // ── Audit: sync failed ───────────────────────────────────────────────
      if (auditContext) {
        await this.auditService.logSyncFailed(
          auditContext,
          provider,
          connectionId ?? companyId,
          errorMsg,
        );
      }

      throw error;
    }
  }

  // ── helpers ─────────────────────────────────────────────────────────────────

  private async emitEvent(
    companyId: string,
    provider: IntegrationProvider,
    eventType: string,
    metadata?: Record<string, unknown>,
    externalId?: string,
  ): Promise<void> {
    await this.prisma.connectorEventRecord.create({
      data: {
        companyId,
        provider,
        eventType,
        externalId: externalId ?? null,
        rawPayload: (metadata ?? {}) as Prisma.InputJsonValue,
        processed: false,
      },
    });
  }

  private async writeRevenueEventLog(
    companyId: string,
    type: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.revenueEventLog.create({
      data: { companyId, type, payload: payload as Prisma.InputJsonValue },
    });
  }
}
