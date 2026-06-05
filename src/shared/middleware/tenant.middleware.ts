import { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../errors/AppError';

/**
 * Ensures the resource being accessed belongs to the authenticated user's company.
 * Attach this as a preHandler on routes that accept :companyId param.
 */
export async function enforceTenant(
  request: FastifyRequest<{ Params: { companyId?: string } }>,
  _reply: FastifyReply,
): Promise<void> {
  const paramCompanyId = request.params?.companyId;

  if (!paramCompanyId) return; // no param, skip

  if (
    request.userRole !== 'SUPER_ADMIN' &&
    paramCompanyId !== request.companyId
  ) {
    throw AppError.forbidden('Access denied: cross-tenant operation');
  }
}

/**
 * Injects companyId from JWT into body/query for tenant-scoped operations.
 */
export async function injectTenant(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  if (!request.companyId) {
    throw AppError.unauthorized('Tenant context missing');
  }
}
