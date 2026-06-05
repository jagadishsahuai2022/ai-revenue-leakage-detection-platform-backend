import { PrismaClient, LeakageCategory } from "@prisma/client";
import { AppError } from "../../shared/errors/AppError";
import {
  parsePagination,
  buildPaginatedResult,
  parseSortOrder,
} from "../../shared/utils/pagination";
import type {
  CreateRevenueInput,
  UpdateRevenueInput,
  CreateLeakageInput,
} from "./revenue.schema";
import type { PaginatedResult } from "../../types";
import { Decimal } from "@prisma/client/runtime/library";

interface RevenueQuery {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: string;
  search?: string;
  from?: string;
  to?: string;
  source?: string;
  currency?: string;
}

interface LeakageQuery {
  page?: number;
  limit?: number;
  /** Single category or comma-separated list, e.g. "CHURN,REFUND" */
  category?: string;
  isResolved?: boolean;
  minRiskScore?: number;
  maxRiskScore?: number;
  minAmount?: number;
  maxAmount?: number;
  /** Full-text search on title + description */
  search?: string;
  from?: string;
  to?: string;
  sortBy?: string;
  sortOrder?: string;
}

export class RevenueService {
  constructor(private readonly prisma: PrismaClient) {}

  // ── Revenue CRUD ─────────────────────────────────────────────────────────────
  async listRevenue(
    companyId: string,
    query: RevenueQuery,
  ): Promise<PaginatedResult<unknown>> {
    const { skip, take, page, limit } = parsePagination(query);
    const sortOrder = parseSortOrder(query.sortOrder);
    const validSortFields = ["period", "amount", "createdAt"] as const;
    const sortBy = validSortFields.includes(query.sortBy as any)
      ? query.sortBy!
      : "period";

    const where: Record<string, unknown> = {
      companyId,
      ...(query.source && { source: query.source }),
      ...(query.currency && { currency: query.currency.toUpperCase() }),
      ...(query.from || query.to
        ? {
            period: {
              ...(query.from && { gte: new Date(query.from) }),
              ...(query.to && { lte: new Date(query.to) }),
            },
          }
        : {}),
      ...(query.search && {
        OR: [
          { customerEmail: { contains: query.search, mode: "insensitive" } },
          { customerId: { contains: query.search, mode: "insensitive" } },
          { product: { contains: query.search, mode: "insensitive" } },
        ],
      }),
    };

    const [revenues, total] = await Promise.all([
      this.prisma.revenue.findMany({
        where,
        skip,
        take,
        orderBy: { [sortBy]: sortOrder },
        select: {
          id: true,
          externalId: true,
          customerId: true,
          customerEmail: true,
          amount: true,
          currency: true,
          mrr: true,
          arr: true,
          product: true,
          plan: true,
          period: true,
          source: true,
          createdAt: true,
          _count: { select: { leakages: true } },
        },
      }),
      this.prisma.revenue.count({ where }),
    ]);

    return buildPaginatedResult(revenues, total, page, limit);
  }

  async getRevenue(companyId: string, revenueId: string) {
    const revenue = await this.prisma.revenue.findFirst({
      where: { id: revenueId, companyId },
      include: { leakages: { orderBy: { detectedAt: "desc" } } },
    });
    if (!revenue) throw AppError.notFound("Revenue record");
    return revenue;
  }

  async createRevenue(companyId: string, input: CreateRevenueInput) {
    if (input.externalId) {
      const existing = await this.prisma.revenue.findUnique({
        where: {
          companyId_externalId: { companyId, externalId: input.externalId },
        },
      });
      if (existing)
        throw AppError.conflict(
          `Revenue with externalId ${input.externalId} already exists`,
        );
    }

    return this.prisma.revenue.create({
      data: {
        companyId,
        ...input,
        amount: new Decimal(input.amount),
        mrr: input.mrr ? new Decimal(input.mrr) : undefined,
        arr: input.arr ? new Decimal(input.arr) : undefined,
        period: new Date(input.period),
      } as any,
    });
  }

  async updateRevenue(
    companyId: string,
    revenueId: string,
    input: UpdateRevenueInput,
  ) {
    const existing = await this.prisma.revenue.findFirst({
      where: { id: revenueId, companyId },
    });
    if (!existing) throw AppError.notFound("Revenue record");

    return this.prisma.revenue.update({
      where: { id: revenueId },
      data: {
        ...input,
        ...(input.amount !== undefined && {
          amount: new Decimal(input.amount),
        }),
        ...(input.mrr !== undefined && {
          mrr: input.mrr ? new Decimal(input.mrr) : null,
        }),
        ...(input.arr !== undefined && {
          arr: input.arr ? new Decimal(input.arr) : null,
        }),
        ...(input.period !== undefined && { period: new Date(input.period) }),
      } as any,
    });
  }

  async deleteRevenue(companyId: string, revenueId: string) {
    const existing = await this.prisma.revenue.findFirst({
      where: { id: revenueId, companyId },
    });
    if (!existing) throw AppError.notFound("Revenue record");
    await this.prisma.revenue.delete({ where: { id: revenueId } });
  }

  // ── Analytics ────────────────────────────────────────────────────────────────
  async getAnalytics(companyId: string, from?: string, to?: string) {
    const dateFilter = {
      ...(from && { gte: new Date(from) }),
      ...(to && { lte: new Date(to) }),
    };

    const [
      totalRevenue,
      mrrStats,
      leakageStats,
      topLeakageCategories,
      recentTrend,
    ] = await Promise.all([
      this.prisma.revenue.aggregate({
        where: {
          companyId,
          ...(Object.keys(dateFilter).length && { period: dateFilter }),
        },
        _sum: { amount: true, mrr: true, arr: true },
        _count: { id: true },
        _avg: { amount: true },
      }),
      this.prisma.revenue.groupBy({
        by: ["currency"],
        where: { companyId },
        _sum: { mrr: true },
      }),
      this.prisma.revenueLeakage.aggregate({
        where: { companyId, isResolved: false },
        _sum: { amount: true },
        _count: { id: true },
        _avg: { riskScore: true },
      }),
      this.prisma.revenueLeakage.groupBy({
        by: ["category"],
        where: { companyId, isResolved: false },
        _sum: { amount: true },
        _count: { id: true },
        orderBy: { _sum: { amount: "desc" } },
        take: 5,
      }),
      // Monthly trend (last 6 months)
      this.prisma.$queryRaw<
        Array<{ month: Date; total: number; count: bigint }>
      >`
          SELECT
            DATE_TRUNC('month', period) AS month,
            SUM(amount)::float AS total,
            COUNT(*)::bigint AS count
          FROM "Revenue"
          WHERE "companyId" = ${companyId}
            AND period >= NOW() - INTERVAL '6 months'
          GROUP BY DATE_TRUNC('month', period)
          ORDER BY month ASC
        `,
    ]);

    return {
      overview: {
        totalRevenue: totalRevenue._sum.amount ?? 0,
        totalMrr: totalRevenue._sum.mrr ?? 0,
        totalArr: totalRevenue._sum.arr ?? 0,
        recordCount: totalRevenue._count.id,
        avgRevenue: totalRevenue._avg.amount ?? 0,
      },
      leakage: {
        totalAtRisk: leakageStats._sum.amount ?? 0,
        openCount: leakageStats._count.id,
        avgRiskScore: leakageStats._avg.riskScore ?? 0,
        byCategory: topLeakageCategories.map((c) => ({
          category: c.category,
          amount: c._sum.amount ?? 0,
          count: c._count.id,
        })),
      },
      trend: recentTrend.map((r) => ({
        month: r.month,
        total: r.total,
        count: Number(r.count),
      })),
    };
  }

  // ── Leakages ─────────────────────────────────────────────────────────────────
  async listLeakages(
    companyId: string,
    query: LeakageQuery,
  ): Promise<PaginatedResult<unknown>> {
    const { skip, take, page, limit } = parsePagination(query);
    const sortOrder = parseSortOrder(query.sortOrder);
    const validSort = ["detectedAt", "amount", "riskScore", "title"] as const;
    const sortBy = validSort.includes(query.sortBy as any)
      ? query.sortBy!
      : "detectedAt";

    // Build category filter: support comma-separated multi-value (e.g. "CHURN,REFUND")
    const categoryFilter = query.category
      ? query.category.includes(",")
        ? {
            category: {
              in: query.category
                .split(",")
                .map((c) => c.trim() as LeakageCategory),
            },
          }
        : { category: query.category as LeakageCategory }
      : {};

    // Build riskScore range filter
    const riskScoreFilter =
      query.minRiskScore !== undefined || query.maxRiskScore !== undefined
        ? {
            riskScore: {
              ...(query.minRiskScore !== undefined && {
                gte: query.minRiskScore,
              }),
              ...(query.maxRiskScore !== undefined && {
                lte: query.maxRiskScore,
              }),
            },
          }
        : {};

    // Build amount range filter
    const amountFilter =
      query.minAmount !== undefined || query.maxAmount !== undefined
        ? {
            amount: {
              ...(query.minAmount !== undefined && {
                gte: new Decimal(query.minAmount),
              }),
              ...(query.maxAmount !== undefined && {
                lte: new Decimal(query.maxAmount),
              }),
            },
          }
        : {};

    const where: Record<string, unknown> = {
      companyId,
      ...categoryFilter,
      ...(query.isResolved !== undefined && { isResolved: query.isResolved }),
      ...riskScoreFilter,
      ...amountFilter,
      ...(query.search && {
        OR: [
          { title: { contains: query.search, mode: "insensitive" } },
          { description: { contains: query.search, mode: "insensitive" } },
        ],
      }),
      ...(query.from || query.to
        ? {
            detectedAt: {
              ...(query.from && { gte: new Date(query.from) }),
              ...(query.to && { lte: new Date(query.to) }),
            },
          }
        : {}),
    };

    const [leakages, total] = await Promise.all([
      this.prisma.revenueLeakage.findMany({
        where,
        skip,
        take,
        orderBy: { [sortBy]: sortOrder },
        include: {
          revenue: { select: { id: true, customerEmail: true, product: true } },
        },
      }),
      this.prisma.revenueLeakage.count({ where }),
    ]);

    return buildPaginatedResult(leakages, total, page, limit);
  }

  async createLeakage(companyId: string, input: CreateLeakageInput) {
    if (input.revenueId) {
      const revenue = await this.prisma.revenue.findFirst({
        where: { id: input.revenueId, companyId },
      });
      if (!revenue) throw AppError.notFound("Revenue record");
    }

    return this.prisma.revenueLeakage.create({
      data: {
        companyId,
        ...input,
        category: input.category as LeakageCategory,
        amount: new Decimal(input.amount),
      } as any,
    });
  }

  async resolveLeakage(companyId: string, leakageId: string) {
    const leakage = await this.prisma.revenueLeakage.findFirst({
      where: { id: leakageId, companyId },
    });
    if (!leakage) throw AppError.notFound("Revenue leakage");
    if (leakage.isResolved) throw AppError.badRequest("Already resolved");

    return this.prisma.revenueLeakage.update({
      where: { id: leakageId },
      data: { isResolved: true, resolvedAt: new Date() },
    });
  }

  async deleteLeakage(companyId: string, leakageId: string) {
    const leakage = await this.prisma.revenueLeakage.findFirst({
      where: { id: leakageId, companyId },
    });
    if (!leakage) throw AppError.notFound("Revenue leakage");
    await this.prisma.revenueLeakage.delete({ where: { id: leakageId } });
  }
}
