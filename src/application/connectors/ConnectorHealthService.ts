// ─────────────────────────────────────────────────────────────────────────────
// Connector Health Monitoring Service
//
// Tracks the health, error rate, and latency of each provider connection.
// Updated after every sync operation. Provides dashboard-ready health data.
// ─────────────────────────────────────────────────────────────────────────────

import { PrismaClient, IntegrationProvider } from '@prisma/client';

export type HealthStatus = 'HEALTHY' | 'DEGRADED' | 'FAILED';

export interface ConnectorHealthSummary {
  id: string;
  companyId: string;
  provider: IntegrationProvider;
  status: HealthStatus;
  lastSyncAt: Date | null;
  errorRate: number;
  avgLatencyMs: number;
  lastError: string | null;
  consecutiveFailures: number;
  updatedAt: Date;
}

/** Thresholds for health status determination */
const HEALTH_THRESHOLDS = {
  /** Error rate above this → DEGRADED */
  degradedErrorRate: 0.2,
  /** Error rate above this → FAILED */
  failedErrorRate: 0.5,
  /** Consecutive failures above this → FAILED */
  failedConsecutiveFailures: 3,
  /** Consecutive failures above this → DEGRADED */
  degradedConsecutiveFailures: 1,
  /** Number of recent syncs to consider for rolling error rate */
  rollingWindow: 10,
};

export class ConnectorHealthService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Record a successful sync and update health metrics.
   */
  async recordSuccess(
    companyId: string,
    provider: IntegrationProvider,
    durationMs: number,
  ): Promise<void> {
    const health = await this.getOrCreateHealth(companyId, provider);

    // Update rolling average latency (exponential moving average)
    const newAvgLatency =
      health.avgLatencyMs === 0
        ? durationMs
        : health.avgLatencyMs * 0.7 + durationMs * 0.3;

    // Calculate new error rate (decay on success)
    const newErrorRate = Math.max(0, health.errorRate * 0.8);

    const status = this.computeStatus(newErrorRate, 0);

    await this.prisma.connectorHealth.update({
      where: { id: health.id },
      data: {
        status,
        lastSyncAt: new Date(),
        errorRate: parseFloat(newErrorRate.toFixed(4)),
        avgLatencyMs: parseFloat(newAvgLatency.toFixed(2)),
        lastError: null,
        consecutiveFailures: 0,
      },
    });
  }

  /**
   * Record a failed sync and update health metrics.
   */
  async recordFailure(
    companyId: string,
    provider: IntegrationProvider,
    error: string,
    durationMs?: number,
  ): Promise<void> {
    const health = await this.getOrCreateHealth(companyId, provider);

    const newConsecutiveFailures = health.consecutiveFailures + 1;

    // Increase error rate on failure
    const newErrorRate = Math.min(1, health.errorRate * 0.8 + 0.2);

    // Update latency if duration provided
    const newAvgLatency =
      durationMs != null
        ? health.avgLatencyMs * 0.7 + durationMs * 0.3
        : health.avgLatencyMs;

    const status = this.computeStatus(newErrorRate, newConsecutiveFailures);

    await this.prisma.connectorHealth.update({
      where: { id: health.id },
      data: {
        status,
        lastSyncAt: new Date(),
        errorRate: parseFloat(newErrorRate.toFixed(4)),
        avgLatencyMs: parseFloat(newAvgLatency.toFixed(2)),
        lastError: error.slice(0, 2000), // Truncate to prevent overflow
        consecutiveFailures: newConsecutiveFailures,
      },
    });
  }

  /**
   * Get health status for all providers of a company.
   */
  async getCompanyHealth(companyId: string): Promise<ConnectorHealthSummary[]> {
    const records = await this.prisma.connectorHealth.findMany({
      where: { companyId },
      orderBy: { provider: 'asc' },
    });

    return records.map((r) => ({
      id: r.id,
      companyId: r.companyId,
      provider: r.provider,
      status: r.status as HealthStatus,
      lastSyncAt: r.lastSyncAt,
      errorRate: r.errorRate,
      avgLatencyMs: r.avgLatencyMs,
      lastError: r.lastError,
      consecutiveFailures: r.consecutiveFailures,
      updatedAt: r.updatedAt,
    }));
  }

  /**
   * Get health status for a specific provider.
   */
  async getProviderHealth(
    companyId: string,
    provider: IntegrationProvider,
  ): Promise<ConnectorHealthSummary | null> {
    const record = await this.prisma.connectorHealth.findUnique({
      where: { companyId_provider: { companyId, provider } },
    });

    if (!record) return null;

    return {
      id: record.id,
      companyId: record.companyId,
      provider: record.provider,
      status: record.status as HealthStatus,
      lastSyncAt: record.lastSyncAt,
      errorRate: record.errorRate,
      avgLatencyMs: record.avgLatencyMs,
      lastError: record.lastError,
      consecutiveFailures: record.consecutiveFailures,
      updatedAt: record.updatedAt,
    };
  }

  /**
   * Ensure a health record exists for a provider — called on initial connect
   * so newly connected integrations immediately appear as HEALTHY in the
   * dashboard rather than showing 'null / NO DATA'.
   * Safe to call multiple times (upsert with no-op update).
   */
  async ensureHealthRecord(
    companyId: string,
    provider: IntegrationProvider,
  ): Promise<void> {
    await this.getOrCreateHealth(companyId, provider);
  }

  // ── Private Helpers ───────────────────────────────────────────────────────

  private async getOrCreateHealth(
    companyId: string,
    provider: IntegrationProvider,
  ) {
    return this.prisma.connectorHealth.upsert({
      where: { companyId_provider: { companyId, provider } },
      create: {
        companyId,
        provider,
        status: 'HEALTHY',
      },
      update: {},
    });
  }

  private computeStatus(
    errorRate: number,
    consecutiveFailures: number,
  ): HealthStatus {
    if (
      errorRate >= HEALTH_THRESHOLDS.failedErrorRate ||
      consecutiveFailures >= HEALTH_THRESHOLDS.failedConsecutiveFailures
    ) {
      return 'FAILED';
    }

    if (
      errorRate >= HEALTH_THRESHOLDS.degradedErrorRate ||
      consecutiveFailures >= HEALTH_THRESHOLDS.degradedConsecutiveFailures
    ) {
      return 'DEGRADED';
    }

    return 'HEALTHY';
  }
}
