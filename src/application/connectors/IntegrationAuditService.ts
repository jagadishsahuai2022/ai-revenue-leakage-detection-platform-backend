// ─────────────────────────────────────────────────────────────────────────────
// Integration Audit Logging Service
//
// Logs all integration actions to the AuditLog table:
//   CONNECT_PROVIDER, DISCONNECT_PROVIDER, ROTATE_TOKEN,
//   SYNC_TRIGGERED, SYNC_FAILED, PERMISSIONS_UPDATED
// ─────────────────────────────────────────────────────────────────────────────

import { PrismaClient, Prisma } from '@prisma/client';

export type IntegrationAuditAction =
  | 'CONNECT_PROVIDER'
  | 'DISCONNECT_PROVIDER'
  | 'ROTATE_TOKEN'
  | 'SYNC_TRIGGERED'
  | 'SYNC_COMPLETED'
  | 'SYNC_FAILED'
  | 'PERMISSIONS_UPDATED'
  | 'WEBHOOK_RECEIVED'
  | 'CREDENTIALS_ROTATED';

export interface AuditContext {
  companyId: string;
  actorId?: string;
  actorEmail?: string;
  actorName?: string;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
}

export interface AuditPayload {
  action: IntegrationAuditAction;
  resourceType: string;
  resourceId?: string;
  detail: string;
  metadata?: Record<string, unknown>;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

export class IntegrationAuditService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Log an integration action to the audit trail.
   */
  async log(context: AuditContext, payload: AuditPayload): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        companyId: context.companyId,
        actorId: context.actorId ?? null,
        actorEmail: context.actorEmail ?? null,
        actorName: context.actorName ?? null,
        action: payload.action,
        resourceType: payload.resourceType,
        resourceId: payload.resourceId ?? null,
        detail: payload.detail,
        resource: 'INTEGRATION',
        ipAddress: context.ipAddress ?? null,
        userAgent: context.userAgent ?? null,
        metadata: {
          ...(payload.metadata ?? {}),
          requestId: context.requestId,
          module: 'integrations',
        } as Prisma.InputJsonValue,
        before: payload.before
          ? (payload.before as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        after: payload.after
          ? (payload.after as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      },
    });
  }

  /**
   * Log a provider connection event.
   */
  async logConnect(
    context: AuditContext,
    provider: string,
    connectionId: string,
  ): Promise<void> {
    await this.log(context, {
      action: 'CONNECT_PROVIDER',
      resourceType: 'PROVIDER_CONNECTION',
      resourceId: connectionId,
      detail: `Connected provider ${provider}`,
      metadata: { provider },
    });
  }

  /**
   * Log a provider disconnection event.
   */
  async logDisconnect(
    context: AuditContext,
    provider: string,
    connectionId: string,
  ): Promise<void> {
    await this.log(context, {
      action: 'DISCONNECT_PROVIDER',
      resourceType: 'PROVIDER_CONNECTION',
      resourceId: connectionId,
      detail: `Disconnected provider ${provider}`,
      metadata: { provider },
    });
  }

  /**
   * Log a sync trigger event.
   */
  async logSyncTriggered(
    context: AuditContext,
    provider: string,
    connectionId: string,
  ): Promise<void> {
    await this.log(context, {
      action: 'SYNC_TRIGGERED',
      resourceType: 'PROVIDER_CONNECTION',
      resourceId: connectionId,
      detail: `Manual sync triggered for ${provider}`,
      metadata: { provider },
    });
  }

  /**
   * Log a sync completion event.
   */
  async logSyncCompleted(
    context: AuditContext,
    provider: string,
    connectionId: string,
    stats: Record<string, unknown>,
  ): Promise<void> {
    await this.log(context, {
      action: 'SYNC_COMPLETED',
      resourceType: 'PROVIDER_CONNECTION',
      resourceId: connectionId,
      detail: `Sync completed for ${provider}`,
      metadata: { provider, ...stats },
    });
  }

  /**
   * Log a sync failure event.
   */
  async logSyncFailed(
    context: AuditContext,
    provider: string,
    connectionId: string,
    error: string,
  ): Promise<void> {
    await this.log(context, {
      action: 'SYNC_FAILED',
      resourceType: 'PROVIDER_CONNECTION',
      resourceId: connectionId,
      detail: `Sync failed for ${provider}: ${error}`,
      metadata: { provider, error },
    });
  }

  /**
   * Log a token rotation event.
   */
  async logTokenRotation(
    context: AuditContext,
    provider: string,
    connectionId: string,
  ): Promise<void> {
    await this.log(context, {
      action: 'ROTATE_TOKEN',
      resourceType: 'PROVIDER_CONNECTION',
      resourceId: connectionId,
      detail: `Credentials rotated for ${provider}`,
      metadata: { provider },
    });
  }

  /**
   * Query integration audit logs for a company.
   */
  async getIntegrationLogs(
    companyId: string,
    options: {
      connectionId?: string;
      provider?: string;
      action?: IntegrationAuditAction;
      limit?: number;
      offset?: number;
    } = {},
  ) {
    const { connectionId, action, limit = 50, offset = 0 } = options;

    const where: Record<string, unknown> = {
      companyId,
      resource: 'INTEGRATION',
    };

    if (connectionId) {
      where.resourceId = connectionId;
    }

    if (action) {
      where.action = action;
    }

    const [logs, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { logs, total };
  }
}
