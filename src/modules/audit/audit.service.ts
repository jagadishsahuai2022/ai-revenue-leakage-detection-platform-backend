import { PrismaClient, Prisma } from '@prisma/client';
import type { PaginatedResult } from '../../types';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CreateAuditLogParams {
  companyId: string;
  actorId?: string;
  actorEmail?: string;
  actorName?: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  detail?: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

export interface AuditLogEntry {
  id: string;
  companyId: string;
  actorId: string | null;
  actorEmail: string | null;
  actorName: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  detail: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: unknown;
  createdAt: Date;
}

export interface ListAuditLogsOptions {
  page?: number;
  limit?: number;
  search?: string;
  action?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const MAX_LIMIT = 100;

// ── Service functions ─────────────────────────────────────────────────────────

/**
 * Write a single audit log entry. Call this fire-and-forget inside a
 * try/catch so audit failures never break the main request flow.
 */
export async function createAuditLog(
  prisma: PrismaClient,
  params: CreateAuditLogParams,
): Promise<void> {
  await prisma.auditLog.create({
    data: {
      companyId: params.companyId,
      actorId: params.actorId ?? null,
      actorEmail: params.actorEmail ?? null,
      actorName: params.actorName ?? null,
      action: params.action,
      resourceType: params.resourceType ?? null,
      resourceId: params.resourceId ?? null,
      detail: params.detail ?? null,
      ipAddress: params.ipAddress ?? null,
      userAgent: params.userAgent ?? null,
      // legacy field — keep non-empty for backward compat
      resource: params.resourceType ?? params.action,
      metadata: (params.metadata ?? {}) as object,
    },
  });
}

/**
 * Paginated list of audit logs for a company.
 * - `search` matches actorEmail, actorName, action, detail (case-insensitive)
 * - `action` is an exact-match filter
 */
export async function listAuditLogs(
  prisma: PrismaClient,
  companyId: string,
  options: ListAuditLogsOptions = {},
): Promise<PaginatedResult<AuditLogEntry>> {
  const page = Math.max(1, options.page ?? 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, options.limit ?? 20));
  const skip = (page - 1) * limit;

  const where: Prisma.AuditLogWhereInput = {
    companyId,
    ...(options.action ? { action: options.action } : {}),
    ...(options.search
      ? {
          OR: [
            { actorEmail: { contains: options.search, mode: 'insensitive' } },
            { actorName: { contains: options.search, mode: 'insensitive' } },
            { action: { contains: options.search, mode: 'insensitive' } },
            { detail: { contains: options.search, mode: 'insensitive' } },
            { resourceType: { contains: options.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [total, rows] = await prisma.$transaction([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      select: {
        id: true,
        companyId: true,
        actorId: true,
        actorEmail: true,
        actorName: true,
        action: true,
        resourceType: true,
        resourceId: true,
        detail: true,
        ipAddress: true,
        userAgent: true,
        metadata: true,
        createdAt: true,
      },
    }),
  ]);

  const totalPages = Math.ceil(total / limit);

  return {
    data: rows as AuditLogEntry[],
    meta: {
      total,
      page,
      limit,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    },
  };
}
