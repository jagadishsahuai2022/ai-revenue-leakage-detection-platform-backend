import { PrismaClient } from '@prisma/client';
import { AppError } from '../../shared/errors/AppError';
import type { UpdateCompanyInput } from './companies.schema';

export class CompaniesService {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: {
        id: true,
        name: true,
        slug: true,
        domain: true,
        logoUrl: true,
        plan: true,
        subscriptionStatus: true,
        trialEndsAt: true,
        billingEmail: true,
        settings: true,
        createdAt: true,
        _count: { select: { users: true } },
      },
    });
    if (!company) throw AppError.notFound('Company');
    return company;
  }

  async update(companyId: string, input: UpdateCompanyInput) {
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw AppError.notFound('Company');

    return this.prisma.company.update({
      where: { id: companyId },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.domain !== undefined && { domain: input.domain }),
        ...(input.logoUrl !== undefined && { logoUrl: input.logoUrl }),
        ...(input.billingEmail !== undefined && { billingEmail: input.billingEmail }),
        ...(input.settings !== undefined && { settings: input.settings }),
      } as any,
      select: {
        id: true,
        name: true,
        slug: true,
        domain: true,
        logoUrl: true,
        billingEmail: true,
        settings: true,
        updatedAt: true,
      },
    });
  }

  async getStats(companyId: string) {
    const [userCount, revenueSum, leakageSum, unresolvedLeakages] = await Promise.all([
      this.prisma.user.count({ where: { companyId, isActive: true } }),
      this.prisma.revenue.aggregate({
        where: { companyId },
        _sum: { amount: true },
      }),
      this.prisma.revenueLeakage.aggregate({
        where: { companyId },
        _sum: { amount: true },
      }),
      this.prisma.revenueLeakage.count({ where: { companyId, isResolved: false } }),
    ]);

    return {
      activeUsers: userCount,
      totalRevenue: revenueSum._sum.amount ?? 0,
      totalLeakage: leakageSum._sum.amount ?? 0,
      unresolvedLeakages,
      leakageRate:
        revenueSum._sum.amount && leakageSum._sum.amount
          ? Number(leakageSum._sum.amount) / Number(revenueSum._sum.amount)
          : 0,
    };
  }

  async createApiKey(companyId: string, name: string) {
    const { generateApiKey } = await import('../../shared/utils/crypto');
    const { raw, hash, prefix } = generateApiKey();

    const key = await this.prisma.apiKey.create({
      data: { companyId, name, keyHash: hash, keyPrefix: prefix },
      select: { id: true, name: true, keyPrefix: true, createdAt: true },
    });

    return { ...key, key: raw }; // raw shown once
  }

  async listApiKeys(companyId: string) {
    return this.prisma.apiKey.findMany({
      where: { companyId, isActive: true },
      select: { id: true, name: true, keyPrefix: true, lastUsedAt: true, expiresAt: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revokeApiKey(companyId: string, keyId: string) {
    const key = await this.prisma.apiKey.findFirst({ where: { id: keyId, companyId } });
    if (!key) throw AppError.notFound('API Key');
    await this.prisma.apiKey.update({ where: { id: keyId }, data: { isActive: false } });
  }
}
