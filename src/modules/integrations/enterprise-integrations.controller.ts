// ─────────────────────────────────────────────────────────────────────────────
// Enterprise Integrations Controller
//
// Handles all enterprise-grade integration endpoints:
//   GET    /integrations               — list all connected integrations
//   GET    /integrations/:id           — get integration detail
//   POST   /integrations/connect       — connect a provider
//   POST   /integrations/:id/disconnect — disconnect a provider
//   POST   /integrations/:id/sync      — trigger manual sync
//   GET    /integrations/:id/logs      — get integration audit logs
//   POST   /integrations/:id/rotate    — rotate credentials
//   GET    /integrations/health        — get health dashboard
// ─────────────────────────────────────────────────────────────────────────────

import { FastifyRequest, FastifyReply } from "fastify";
import { PrismaClient, IntegrationProvider, Prisma } from "@prisma/client";
import { successResponse, createdResponse } from "../../shared/utils/response";
import { AppError } from "../../shared/errors/AppError";
import {
  encryptCredential,
  decryptCredential,
} from "../../shared/utils/credential-encryption";
import { ConnectorEngine } from "../../application/connectors/ConnectorEngine";
import { ConnectorHealthService } from "../../application/connectors/ConnectorHealthService";
import {
  IntegrationAuditService,
  AuditContext,
} from "../../application/connectors/IntegrationAuditService";
import {
  IntegrationPermissionService,
  IntegrationScope,
} from "../../application/connectors/IntegrationPermissionService";
import { TokenRefreshService } from "../../application/connectors/TokenRefreshService";

interface ConnectBody {
  provider: string;
  accessToken?: string;
  refreshToken?: string;
  apiKey?: string;
  clientSecret?: string;
  scopes?: string;
  permissions?: string[];
  config?: Record<string, unknown>;
}

interface IdParams {
  id: string;
}

interface LogsQuery {
  limit?: number;
  offset?: number;
  action?: string;
}

export class EnterpriseIntegrationsController {
  private readonly connectorEngine: ConnectorEngine;
  private readonly healthService: ConnectorHealthService;
  private readonly auditService: IntegrationAuditService;
  private readonly permissionService: IntegrationPermissionService;
  private readonly tokenRefreshService: TokenRefreshService;

  constructor(private readonly prisma: PrismaClient) {
    this.connectorEngine = new ConnectorEngine(prisma);
    this.healthService = new ConnectorHealthService(prisma);
    this.auditService = new IntegrationAuditService(prisma);
    this.permissionService = new IntegrationPermissionService(prisma);
    this.tokenRefreshService = new TokenRefreshService(prisma);
  }

  // ── GET /integrations ─────────────────────────────────────────────────────

  async listIntegrations(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const companyId = request.companyId;
    const startTime = Date.now();

    request.log.info(
      { companyId, requestId: request.id },
      "Listing integrations",
    );

    // Fetch connections first (critical), then health data (non-critical)
    const connections = await this.prisma.providerConnection.findMany({
      where: { companyId },
      orderBy: { createdAt: "asc" },
    });

    // Health data is non-critical — if the connector_health table is missing
    // (migration not yet applied on production), we still return connections.
    let healthRecords: Awaited<
      ReturnType<ConnectorHealthService["getCompanyHealth"]>
    > = [];
    try {
      healthRecords = await this.healthService.getCompanyHealth(companyId);
    } catch (healthErr) {
      request.log.warn(
        { err: healthErr, companyId },
        "Failed to fetch connector health — returning connections without health data",
      );
    }

    const healthMap = new Map(healthRecords.map((h) => [h.provider, h]));

    const integrations = connections.map((conn) => {
      const health = healthMap.get(conn.provider);
      return {
        id: conn.id,
        provider: conn.provider,
        status: conn.status,
        lastSyncAt: conn.lastSyncAt,
        scopes: conn.scopes,
        permissions: conn.permissions,
        health: health
          ? {
              status: health.status,
              errorRate: health.errorRate,
              avgLatencyMs: health.avgLatencyMs,
              lastError: health.lastError,
              consecutiveFailures: health.consecutiveFailures,
            }
          : null,
        createdAt: conn.createdAt,
        updatedAt: conn.updatedAt,
      };
    });

    request.log.info(
      {
        companyId,
        count: integrations.length,
        durationMs: Date.now() - startTime,
      },
      "Listed integrations",
    );

    return reply.send(successResponse(integrations, undefined, request.id));
  }

  // ── GET /integrations/:id ─────────────────────────────────────────────────

  async getIntegration(
    request: FastifyRequest<{ Params: IdParams }>,
    reply: FastifyReply,
  ): Promise<void> {
    const companyId = request.companyId;
    const { id } = request.params;

    const connection = await this.prisma.providerConnection.findFirst({
      where: { id, companyId },
    });

    if (!connection) {
      throw AppError.notFound("Integration");
    }

    // Non-critical: health data
    let health: Awaited<
      ReturnType<ConnectorHealthService["getProviderHealth"]>
    > | null = null;
    try {
      health = await this.healthService.getProviderHealth(
        companyId,
        connection.provider,
      );
    } catch (healthErr) {
      request.log.warn(
        { err: healthErr, companyId, provider: connection.provider },
        "Failed to fetch provider health",
      );
    }

    // Non-critical: recent sync logs
    let recentLogs: any[] = [];
    try {
      recentLogs = await this.prisma.connectorSyncLog.findMany({
        where: { companyId, connector: connection.provider },
        orderBy: { createdAt: "desc" },
        take: 10,
      });
    } catch (logErr) {
      request.log.warn(
        { err: logErr, companyId, provider: connection.provider },
        "Failed to fetch sync logs",
      );
    }

    const result = {
      id: connection.id,
      provider: connection.provider,
      status: connection.status,
      scopes: connection.scopes,
      permissions: connection.permissions,
      lastSyncAt: connection.lastSyncAt,
      syncCursor: connection.syncCursor,
      health: health
        ? {
            status: health.status,
            errorRate: health.errorRate,
            avgLatencyMs: health.avgLatencyMs,
            lastError: health.lastError,
            consecutiveFailures: health.consecutiveFailures,
          }
        : null,
      recentSyncLogs: recentLogs.map((log: any) => ({
        id: log.id,
        status: log.status,
        recordsSynced: log.recordsSynced,
        error: log.error,
        durationMs: log.durationMs,
        createdAt: log.createdAt,
      })),
      createdAt: connection.createdAt,
      updatedAt: connection.updatedAt,
    };

    return reply.send(successResponse(result, undefined, request.id));
  }

  // ── POST /integrations/connect ─────────────────────────────────────────────

  async connectProvider(
    request: FastifyRequest<{ Body: ConnectBody }>,
    reply: FastifyReply,
  ): Promise<void> {
    const companyId = request.companyId;
    const body = request.body;
    const startTime = Date.now();
    const auditCtx = this.buildAuditContext(request);

    request.log.info(
      { companyId, provider: body.provider, requestId: request.id },
      "Connecting provider",
    );

    // Validate provider
    const provider = body.provider as IntegrationProvider;
    if (!Object.values(IntegrationProvider).includes(provider)) {
      throw AppError.badRequest(`Invalid provider: ${body.provider}`);
    }

    // Check for existing connection
    const existing = await this.prisma.providerConnection.findFirst({
      where: { companyId, provider },
    });

    if (existing && existing.status === "ACTIVE") {
      throw AppError.conflict(`Provider ${provider} is already connected`);
    }

    // Encrypt credentials
    const encryptedData: Prisma.ProviderConnectionCreateInput = {
      company: { connect: { id: companyId } },
      provider,
      status: "ACTIVE",
      accessToken: body.accessToken
        ? encryptCredential(body.accessToken)
        : null,
      refreshToken: body.refreshToken
        ? encryptCredential(body.refreshToken)
        : null,
      apiKey: body.apiKey ? encryptCredential(body.apiKey) : null,
      clientSecret: body.clientSecret
        ? encryptCredential(body.clientSecret)
        : null,
      scopes: body.scopes ?? null,
      permissions: (body.permissions ?? [
        IntegrationScope.READ_WRITE,
      ]) as unknown as Prisma.InputJsonValue,
      encryptedConfig: (body.config ?? {}) as Prisma.InputJsonValue,
    };

    const connection = existing
      ? await this.prisma.providerConnection.update({
          where: { id: existing.id },
          data: {
            status: "ACTIVE",
            accessToken: encryptedData.accessToken,
            refreshToken: encryptedData.refreshToken,
            apiKey: encryptedData.apiKey,
            clientSecret: encryptedData.clientSecret,
            scopes: encryptedData.scopes,
            permissions: encryptedData.permissions,
            encryptedConfig: encryptedData.encryptedConfig,
          },
        })
      : await this.prisma.providerConnection.create({ data: encryptedData });

    // Ensure a health record exists — non-critical, don't fail connect on missing table
    try {
      await this.healthService.ensureHealthRecord(companyId, provider);
    } catch (healthErr) {
      request.log.warn(
        { err: healthErr, companyId, provider },
        "Failed to create health record — connector_health table may not exist",
      );
    }

    // Audit log — also non-fatal for resilience
    try {
      await this.auditService.logConnect(auditCtx, provider, connection.id);
    } catch (auditErr) {
      request.log.warn(
        { err: auditErr, companyId, provider },
        "Failed to write audit log",
      );
    }

    request.log.info(
      {
        companyId,
        provider,
        connectionId: connection.id,
        durationMs: Date.now() - startTime,
      },
      "Provider connected",
    );

    return reply.status(201).send(
      createdResponse(
        {
          id: connection.id,
          provider: connection.provider,
          status: connection.status,
          createdAt: connection.createdAt,
        },
        "Provider connected successfully",
        request.id,
      ),
    );
  }

  // ── POST /integrations/:id/disconnect ──────────────────────────────────────

  async disconnectProvider(
    request: FastifyRequest<{ Params: IdParams }>,
    reply: FastifyReply,
  ): Promise<void> {
    const companyId = request.companyId;
    const { id } = request.params;
    const auditCtx = this.buildAuditContext(request);

    const connection = await this.prisma.providerConnection.findFirst({
      where: { id, companyId },
    });

    if (!connection) {
      throw AppError.notFound("Integration");
    }

    request.log.info(
      { companyId, provider: connection.provider, connectionId: id },
      "Disconnecting provider",
    );

    await this.prisma.providerConnection.update({
      where: { id },
      data: {
        status: "INACTIVE",
        accessToken: null,
        refreshToken: null,
        apiKey: null,
        clientSecret: null,
      },
    });

    await this.auditService.logDisconnect(auditCtx, connection.provider, id);

    return reply.send(
      successResponse(
        { id, status: "INACTIVE" },
        "Provider disconnected",
        request.id,
      ),
    );
  }

  // ── POST /integrations/:id/sync ────────────────────────────────────────────

  async triggerSync(
    request: FastifyRequest<{ Params: IdParams }>,
    reply: FastifyReply,
  ): Promise<void> {
    const companyId = request.companyId;
    const { id } = request.params;
    const auditCtx = this.buildAuditContext(request);

    const connection = await this.prisma.providerConnection.findFirst({
      where: { id, companyId },
    });

    if (!connection) {
      throw AppError.notFound("Integration");
    }

    if (connection.status !== "ACTIVE") {
      throw AppError.badRequest("Cannot sync an inactive integration");
    }

    request.log.info(
      {
        companyId,
        provider: connection.provider,
        connectionId: id,
        requestId: request.id,
      },
      "Manual sync triggered",
    );

    try {
      const result = await this.connectorEngine.sync(
        companyId,
        connection.provider,
        {
          connectionId: id,
          auditContext: auditCtx,
        },
      );

      return reply.send(successResponse(result, "Sync completed", request.id));
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      request.log.error(
        { companyId, provider: connection.provider, error: errorMsg },
        "Sync failed",
      );

      // Return 422 when the provider adapter is not registered yet
      if (errorMsg.includes("not supported")) {
        throw AppError.unprocessable(
          `Provider "${connection.provider}" does not support manual sync yet.`,
        );
      }

      throw AppError.internal(`Sync failed: ${errorMsg}`);
    }
  }

  // ── GET /integrations/:id/logs ─────────────────────────────────────────────

  async getIntegrationLogs(
    request: FastifyRequest<{ Params: IdParams; Querystring: LogsQuery }>,
    reply: FastifyReply,
  ): Promise<void> {
    const companyId = request.companyId;
    const { id } = request.params;
    const { limit = 50, offset = 0, action } = request.query as LogsQuery;

    // Verify connection belongs to company
    const connection = await this.prisma.providerConnection.findFirst({
      where: { id, companyId },
    });

    if (!connection) {
      throw AppError.notFound("Integration");
    }

    const { logs, total } = await this.auditService.getIntegrationLogs(
      companyId,
      {
        connectionId: id,
        action: action as any,
        limit,
        offset,
      },
    );

    return reply.send(
      successResponse(
        {
          logs: logs.map((log) => ({
            id: log.id,
            action: log.action,
            detail: log.detail,
            actorEmail: log.actorEmail,
            actorName: log.actorName,
            metadata: log.metadata,
            createdAt: log.createdAt,
          })),
          total,
          limit,
          offset,
        },
        undefined,
        request.id,
      ),
    );
  }

  // ── POST /integrations/:id/rotate ──────────────────────────────────────────

  async rotateCredentials(
    request: FastifyRequest<{ Params: IdParams; Body: Partial<ConnectBody> }>,
    reply: FastifyReply,
  ): Promise<void> {
    const companyId = request.companyId;
    const { id } = request.params;
    const body = request.body;
    const auditCtx = this.buildAuditContext(request);

    const connection = await this.prisma.providerConnection.findFirst({
      where: { id, companyId },
    });

    if (!connection) {
      throw AppError.notFound("Integration");
    }

    request.log.info(
      { companyId, provider: connection.provider, connectionId: id },
      "Rotating credentials",
    );

    const updateData: Record<string, string | null> = {};

    if (body.accessToken) {
      updateData.accessToken = encryptCredential(body.accessToken);
    }
    if (body.refreshToken) {
      updateData.refreshToken = encryptCredential(body.refreshToken);
    }
    if (body.apiKey) {
      updateData.apiKey = encryptCredential(body.apiKey);
    }
    if (body.clientSecret) {
      updateData.clientSecret = encryptCredential(body.clientSecret);
    }

    if (Object.keys(updateData).length === 0) {
      throw AppError.badRequest("No credentials provided to rotate");
    }

    await this.prisma.providerConnection.update({
      where: { id },
      data: updateData,
    });

    await this.auditService.logTokenRotation(auditCtx, connection.provider, id);

    return reply.send(
      successResponse(
        { id, rotatedFields: Object.keys(updateData) },
        "Credentials rotated successfully",
        request.id,
      ),
    );
  }

  // ── GET /integrations/health ───────────────────────────────────────────────

  async getHealthDashboard(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const companyId = request.companyId;

    let health: Awaited<
      ReturnType<ConnectorHealthService["getCompanyHealth"]>
    > = [];
    try {
      health = await this.healthService.getCompanyHealth(companyId);
    } catch (healthErr) {
      request.log.warn(
        { err: healthErr, companyId },
        "Failed to fetch health dashboard",
      );
    }

    return reply.send(successResponse(health, undefined, request.id));
  }

  // ── Private Helpers ───────────────────────────────────────────────────────

  private buildAuditContext(request: FastifyRequest): AuditContext {
    return {
      companyId: request.companyId,
      actorId: request.userId,
      actorEmail: request.userEmail,
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"] ?? undefined,
      requestId: request.id,
    };
  }
}
