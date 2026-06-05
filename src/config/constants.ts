export const PAGINATION_DEFAULTS = {
  page: 1,
  limit: 20,
  maxLimit: 100,
} as const;

export const CACHE_TTL = {
  SHORT: 60,       // 1 min
  MEDIUM: 300,     // 5 min
  LONG: 3600,      // 1 hour
  DAY: 86400,
} as const;

export const JOB_QUEUES = {
  REVENUE_ANALYSIS: 'revenue-analysis',
  NOTIFICATIONS: 'notifications',
  INTEGRATIONS: 'integrations',
  CLEANUP: 'cleanup',
} as const;

export const RATE_LIMITS = {
  AUTH: { max: 10, window: 60_000 },
  API: { max: 100, window: 60_000 },
  WEBHOOK: { max: 500, window: 60_000 },
} as const;

export const STRIPE_PLANS: Record<string, string> = {
  STARTER: process.env['STRIPE_PRICE_STARTER'] ?? '',
  GROWTH: process.env['STRIPE_PRICE_GROWTH'] ?? '',
  ENTERPRISE: process.env['STRIPE_PRICE_ENTERPRISE'] ?? '',
};
