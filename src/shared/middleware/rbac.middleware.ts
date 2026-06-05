import { FastifyReply, FastifyRequest } from 'fastify';
import { UserRole } from '@prisma/client';
import { AppError } from '../errors/AppError';

// Role hierarchy:  SUPER_ADMIN > COMPANY_ADMIN > ANALYST > VIEWER
const ROLE_WEIGHT: Record<UserRole, number> = {
  SUPER_ADMIN: 100,
  COMPANY_ADMIN: 75,
  ANALYST: 50,
  VIEWER: 25,
};

export function requireRole(...roles: UserRole[]) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    if (!request.userRole) throw AppError.unauthorized();

    const allowed = roles.some((r) => ROLE_WEIGHT[request.userRole] >= ROLE_WEIGHT[r]);
    if (!allowed) {
      throw AppError.forbidden(
        `This action requires one of: [${roles.join(', ')}]`,
      );
    }
  };
}

export function requireMinRole(minRole: UserRole) {
  return requireRole(minRole);
}

export function isSuperAdmin(role: UserRole): boolean {
  return role === 'SUPER_ADMIN';
}

export function canManageCompany(role: UserRole): boolean {
  return ROLE_WEIGHT[role] >= ROLE_WEIGHT['COMPANY_ADMIN'];
}

export function canAnalyze(role: UserRole): boolean {
  return ROLE_WEIGHT[role] >= ROLE_WEIGHT['ANALYST'];
}
