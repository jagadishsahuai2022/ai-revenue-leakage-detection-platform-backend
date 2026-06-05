// ─────────────────────────────────────────────────────────────────────────────
// Tenant-Isolated Rate Limiting Configuration
// Provides plan-based rate limits and a key generator that uses companyId
// (falling back to IP for unauthenticated requests like /auth/login).
// ─────────────────────────────────────────────────────────────────────────────

import type { FastifyRequest } from 'fastify';

/**
 * Rate limit tiers per subscription plan.
 * key: plan name uppercase, value: { max, windowMs }
 */
export const PLAN_RATE_LIMITS: Record<string, { max: number; windowMs: number }> = {
  STARTER:    { max: 100,  windowMs: 60_000 },
  GROWTH:     { max: 300,  windowMs: 60_000 },
  ENTERPRISE: { max: 1000, windowMs: 60_000 },
  // Fallback for unauthenticated or unknown plans
  DEFAULT:    { max: 60,   windowMs: 60_000 },
};

/**
 * Key generator for @fastify/rate-limit.
 * Authenticated requests are keyed by companyId (tenant-isolated).
 * Unauthenticated requests fall back to IP.
 */
export function tenantRateLimitKeyGenerator(request: FastifyRequest): string {
  return request.companyId || request.ip;
}

/**
 * Returns the rate limit max for a given request based on the
 * company's subscription plan (set by auth middleware).
 * Used with the `max` function option in @fastify/rate-limit.
 */
export function tenantRateLimitMax(request: FastifyRequest, _key: string): number {
  // The plan may not be available for unauthenticated routes
  // In that case, use the DEFAULT tier
  const plan = (request as unknown as Record<string, unknown>).companyPlan as string | undefined;
  const tier = plan ? PLAN_RATE_LIMITS[plan.toUpperCase()] : undefined;
  return tier?.max ?? PLAN_RATE_LIMITS.DEFAULT.max;
}
