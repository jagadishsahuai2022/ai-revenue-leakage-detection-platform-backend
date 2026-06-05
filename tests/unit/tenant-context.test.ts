// ─────────────────────────────────────────────────────────────────────────────
// Unit Tests: Tenant Context (AsyncLocalStorage)
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { tenantStorage, getTenantContext, TenantStore } from '../../src/shared/middleware/tenant-context';

describe('Tenant Context (AsyncLocalStorage)', () => {
  it('returns undefined outside a storage context', () => {
    expect(getTenantContext()).toBeUndefined();
  });

  it('provides the store inside a run() context', async () => {
    const store: TenantStore = {
      companyId: 'comp-1',
      userId: 'user-1',
      isSuperAdmin: false,
    };

    await tenantStorage.run(store, async () => {
      const ctx = getTenantContext();
      expect(ctx).toBeDefined();
      expect(ctx!.companyId).toBe('comp-1');
      expect(ctx!.userId).toBe('user-1');
      expect(ctx!.isSuperAdmin).toBe(false);
    });
  });

  it('isolates contexts between concurrent runs', async () => {
    const run1 = tenantStorage.run({ companyId: 'A', userId: 'u1', isSuperAdmin: false }, async () => {
      await new Promise((r) => setTimeout(r, 10));
      return getTenantContext()!.companyId;
    });

    const run2 = tenantStorage.run({ companyId: 'B', userId: 'u2', isSuperAdmin: true }, async () => {
      await new Promise((r) => setTimeout(r, 5));
      return getTenantContext()!.companyId;
    });

    const [result1, result2] = await Promise.all([run1, run2]);
    expect(result1).toBe('A');
    expect(result2).toBe('B');
  });

  it('super admin flag is correctly captured', async () => {
    await tenantStorage.run({ companyId: 'comp', userId: 'admin', isSuperAdmin: true }, async () => {
      expect(getTenantContext()!.isSuperAdmin).toBe(true);
    });
  });
});
