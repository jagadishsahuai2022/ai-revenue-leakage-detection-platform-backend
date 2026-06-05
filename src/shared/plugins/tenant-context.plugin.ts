// ─────────────────────────────────────────────────────────────────────────────
// Tenant Context Plugin
// Wraps authenticated requests inside AsyncLocalStorage so that downstream
// Prisma middleware can enforce tenant isolation automatically.
// ─────────────────────────────────────────────────────────────────────────────

import { FastifyInstance, FastifyPluginCallback } from 'fastify';
import fp from 'fastify-plugin';
import { tenantStorage, TenantStore } from '../middleware/tenant-context';

const tenantContextPlugin: FastifyPluginCallback = (fastify: FastifyInstance, _opts, done) => {
  fastify.addHook('preHandler', async (request, _reply) => {
    // Only set context for authenticated requests
    if (!request.companyId) return;

    const store: TenantStore = {
      companyId: request.companyId,
      userId: request.userId || '',
      isSuperAdmin: request.userRole === 'SUPER_ADMIN',
    };

    // Run the rest of the handler chain inside the storage context.
    // NOTE: Since Fastify hooks are async, the storage context is set here
    // and persists for the lifetime of the request within this async context.
    tenantStorage.enterWith(store);
  });

  done();
};

export default fp(tenantContextPlugin, {
  name: 'tenant-context',
  fastify: '4.x',
});
