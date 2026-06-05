// ─────────────────────────────────────────────────────────────────────────────
// Slow Query Monitoring — Prisma Middleware
// Logs any query that exceeds the SLOW_QUERY_THRESHOLD_MS.
// In production, these logs can be shipped to an observability backend
// for dashboarding and alerting.
// ─────────────────────────────────────────────────────────────────────────────

import { Prisma, PrismaClient } from '@prisma/client';

const SLOW_QUERY_THRESHOLD_MS = 200;

/**
 * Registers Prisma $use middleware that measures query duration and logs
 * any query that exceeds the threshold.
 *
 * Call this AFTER registerTenantMiddleware so timing includes the
 * tenant enforcement overhead (negligible but honest).
 */
export function registerSlowQueryMiddleware(prisma: PrismaClient, logger?: { warn: (...args: unknown[]) => void }): void {
  const log = logger ?? console;

  prisma.$use(async (params: Prisma.MiddlewareParams, next) => {
    const start = performance.now();
    const result = await next(params);
    const durationMs = Math.round(performance.now() - start);

    if (durationMs > SLOW_QUERY_THRESHOLD_MS) {
      log.warn(
        {
          event: 'SLOW_QUERY',
          model: params.model,
          action: params.action,
          durationMs,
          thresholdMs: SLOW_QUERY_THRESHOLD_MS,
          // Don't log WHERE args in production — might contain PII
          ...(process.env.NODE_ENV !== 'production' ? { args: JSON.stringify(params.args).slice(0, 500) } : {}),
        },
        `Slow query: ${params.model}.${params.action} took ${durationMs}ms (threshold: ${SLOW_QUERY_THRESHOLD_MS}ms)`,
      );
    }

    return result;
  });
}
