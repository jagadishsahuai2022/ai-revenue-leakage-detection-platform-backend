// ─────────────────────────────────────────────────────────────────────────────
// Tenant Context (AsyncLocalStorage)
// Stores the current tenant's companyId in CLS so it can be read by Prisma
// middleware without manual drilling.
// ─────────────────────────────────────────────────────────────────────────────

import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantStore {
  companyId: string;
  userId: string;
  isSuperAdmin: boolean;
}

export const tenantStorage = new AsyncLocalStorage<TenantStore>();

/**
 * Read the current tenant context. Returns undefined when running outside
 * an HTTP request (e.g. seed scripts, migrations, cron jobs).
 */
export function getTenantContext(): TenantStore | undefined {
  return tenantStorage.getStore();
}
