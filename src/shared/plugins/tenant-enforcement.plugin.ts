// ─────────────────────────────────────────────────────────────────────────────
// Tenant Enforcement Prisma Extension
// Automatically injects `companyId` into WHERE clauses for find/update/delete
// and into CREATE data when a tenant context is active.
//
// SUPER_ADMIN users bypass enforcement (isSuperAdmin = true in context).
// Models without a `companyId` column are skipped automatically.
// ─────────────────────────────────────────────────────────────────────────────

import { Prisma, PrismaClient } from "@prisma/client";
import { getTenantContext } from "../middleware/tenant-context";

/**
 * List of models that have a `companyId` field and should be tenant-scoped.
 * Keep this in sync with the Prisma schema.
 */
const TENANT_SCOPED_MODELS = new Set<string>([
  "Revenue",
  "RevenueLeakage",
  "Invoice",
  "SubscriptionItem",
  "Integration",
  "ApiKey",
  "AuditLog",
  "ProviderConnection",
  "ConnectorEventRecord",
  "RevenueEventLog",
  "CustomProvider",
  "AIInsight",
  "AiUsage",
  "AIRecommendation",
  "ActionExecution",
  "FeatureFlag",
  "ConnectorSyncLog",
  "AgentActionProposal",
  "AgentExecutionLog",
  "AIModelUsage",
  "ApiIdempotencyKey",
  "DeadLetterEvent",
  "ActionApproval",
  "AiSafetyLog",
  "ProductEventLog",
  "JobLog", // JobLog has optional companyId — still scoped when context present
]);

/**
 * Read-operation actions that need WHERE injection.
 */
const READ_ACTIONS = new Set<string>([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
]);

/**
 * Write-operation actions that need WHERE injection.
 */
const WRITE_ACTIONS = new Set<string>([
  "update",
  "updateMany",
  "delete",
  "deleteMany",
  "upsert",
]);

/**
 * Create-operation actions that need DATA injection.
 */
const CREATE_ACTIONS = new Set<string>(["create", "createMany"]);

/**
 * Registers Prisma $use middleware that auto-injects tenant companyId
 * into all queries for tenant-scoped models.
 */
export function registerTenantMiddleware(prisma: PrismaClient): void {
  prisma.$use(async (params: Prisma.MiddlewareParams, next) => {
    const ctx = getTenantContext();

    // No tenant context (system/seed/cron) or SUPER_ADMIN → pass through
    if (!ctx || ctx.isSuperAdmin) {
      return next(params);
    }

    const model = params.model as string | undefined;
    if (!model || !TENANT_SCOPED_MODELS.has(model)) {
      return next(params);
    }

    const { companyId } = ctx;
    const action = params.action as string;

    // ── Read queries: inject companyId into WHERE ───────────────────────────
    if (READ_ACTIONS.has(action)) {
      params.args = params.args || {};
      params.args.where = params.args.where || {};
      params.args.where.companyId = companyId;
    }

    // ── Write queries: inject companyId into WHERE ──────────────────────────
    if (WRITE_ACTIONS.has(action)) {
      params.args = params.args || {};
      if (action === "upsert") {
        params.args.where = params.args.where || {};
        params.args.where.companyId = companyId;
        // upsert.create also needs companyId
        if (params.args.create) {
          params.args.create.companyId = companyId;
        }
      } else {
        params.args.where = params.args.where || {};
        params.args.where.companyId = companyId;
      }
    }

    // ── Create queries: inject companyId into DATA ──────────────────────────
    if (CREATE_ACTIONS.has(action)) {
      params.args = params.args || {};
      if (action === "createMany") {
        // createMany: data is an array
        if (Array.isArray(params.args.data)) {
          params.args.data = params.args.data.map(
            (d: Record<string, unknown>) => ({
              ...d,
              companyId,
            }),
          );
        }
      } else {
        params.args.data = params.args.data || {};
        params.args.data.companyId = companyId;
      }
    }

    return next(params);
  });
}
