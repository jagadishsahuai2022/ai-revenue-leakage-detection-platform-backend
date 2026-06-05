import { PrismaClient, UserRole } from '@prisma/client';
import { AppError } from '../../shared/errors/AppError';
import { hashPassword, verifyPassword, generateSecureToken } from '../../shared/utils/crypto';
import { parsePagination, buildPaginatedResult } from '../../shared/utils/pagination';
import type { InviteUserInput, UpdateUserInput } from './users.schema';
import type { PaginatedResult, PaginationQuery } from '../../types';

const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  avatarUrl: true,
  emailVerified: true,
  lastLoginAt: true,
  isActive: true,
  createdAt: true,
};

export class UsersService {
  constructor(private readonly prisma: PrismaClient) {}

  async findAll(
    companyId: string,
    query: PaginationQuery,
  ): Promise<PaginatedResult<unknown>> {
    const { skip, take, page, limit } = parsePagination(query);

    const where = {
      companyId,
      ...(query.search
        ? {
            OR: [
              { email: { contains: query.search, mode: 'insensitive' as const } },
              { name: { contains: query.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({ where, select: USER_SELECT, skip, take, orderBy: { createdAt: 'desc' } }),
      this.prisma.user.count({ where }),
    ]);

    return buildPaginatedResult(users, total, page, limit);
  }

  async findOne(companyId: string, userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, companyId },
      select: USER_SELECT,
    });
    if (!user) throw AppError.notFound('User');
    return user;
  }

  async update(companyId: string, userId: string, input: UpdateUserInput) {
    const exists = await this.prisma.user.findFirst({ where: { id: userId, companyId } });
    if (!exists) throw AppError.notFound('User');

    return this.prisma.user.update({
      where: { id: userId },
      data: input,
      select: USER_SELECT,
    });
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.passwordHash) throw AppError.badRequest('No password set on this account');

    const valid = await verifyPassword(currentPassword, user.passwordHash);
    if (!valid) throw AppError.unauthorized('Current password is incorrect');

    const newHash = await hashPassword(newPassword);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: newHash } });
  }

  async invite(companyId: string, input: InviteUserInput): Promise<unknown> {
    const existing = await this.prisma.user.findFirst({
      where: { companyId, email: input.email },
    });
    if (existing) throw AppError.conflict('User already exists in this company');

    const tempPassword = generateSecureToken(16);
    const passwordHash = await hashPassword(tempPassword);

    const user = await this.prisma.user.create({
      data: {
        companyId,
        email: input.email,
        name: input.name,
        role: input.role as UserRole,
        passwordHash,
      },
      select: USER_SELECT,
    });

    // TODO: send invite email with tempPassword (use notification queue)
    return { user, tempPassword }; // In production, don't return tempPassword
  }

  async updateRole(companyId: string, userId: string, role: UserRole) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, companyId } });
    if (!user) throw AppError.notFound('User');
    if (user.role === 'COMPANY_ADMIN') {
      // Ensure at least one admin remains
      const adminCount = await this.prisma.user.count({ where: { companyId, role: 'COMPANY_ADMIN' } });
      if (adminCount <= 1) throw AppError.badRequest('Cannot demote the last admin');
    }
    return this.prisma.user.update({ where: { id: userId }, data: { role }, select: USER_SELECT });
  }

  async deactivate(companyId: string, userId: string, requesterId: string) {
    if (userId === requesterId) throw AppError.badRequest('Cannot deactivate your own account');
    const user = await this.prisma.user.findFirst({ where: { id: userId, companyId } });
    if (!user) throw AppError.notFound('User');
    await this.prisma.user.update({ where: { id: userId }, data: { isActive: false } });
  }
}
