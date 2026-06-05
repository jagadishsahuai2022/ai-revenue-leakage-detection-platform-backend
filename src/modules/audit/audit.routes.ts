import { FastifyInstance, FastifyRequest } from 'fastify';
import { authenticate } from '../../shared/middleware/auth.middleware';
import { requireMinRole } from '../../shared/middleware/rbac.middleware';
import { successResponse } from '../../shared/utils/response';
import { listAuditLogs } from './audit.service';

interface AuditQuerystring {
  page?: string;
  limit?: string;
  search?: string;
  action?: string;
}

export async function auditRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/audit
   * Returns a paginated audit trail for the caller's company.
   * Requires COMPANY_ADMIN or SUPER_ADMIN role.
   */
  fastify.get<{ Querystring: AuditQuerystring }>(
    '/',
    {
      preHandler: [authenticate, requireMinRole('COMPANY_ADMIN')],
    },
    async (request: FastifyRequest<{ Querystring: AuditQuerystring }>, reply) => {
      const { page, limit, search, action } = request.query;

      const result = await listAuditLogs(request.server.prisma, request.companyId, {
        page: page ? parseInt(page, 10) : undefined,
        limit: limit ? parseInt(limit, 10) : undefined,
        search: search || undefined,
        action: action || undefined,
      });

      return reply.send(successResponse(result));
    },
  );
}
