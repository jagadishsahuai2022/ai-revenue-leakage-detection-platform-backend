// ─────────────────────────────────────────────────────────────────────────────
// Agent Analytics Service
//
// Computes execution analytics from AgentExecutionLog and AgentExecutionMetrics.
//   • totalActions
//   • successRate
//   • avgExecutionTime
//   • revenueRecovered
// ─────────────────────────────────────────────────────────────────────────────

import { PrismaClient } from "@prisma/client";

export interface AgentAnalytics {
  totalActions: number;
  successRate: number; // 0-100
  avgExecutionTime: number; // ms
  revenueRecovered: number; // USD
  byActionType: Record<
    string,
    {
      count: number;
      successCount: number;
      avgDurationMs: number;
    }
  >;
}

export class AgentAnalyticsService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Compute aggregate execution analytics for a company.
   */
  async getAnalytics(companyId: string, days = 30): Promise<AgentAnalytics> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Fetch execution logs for the period
    const logs = await this.prisma.agentExecutionLog.findMany({
      where: {
        companyId,
        createdAt: { gte: since },
      },
      select: {
        status: true,
        durationMs: true,
        executionType: true,
        result: true,
      },
    });

    const totalActions = logs.length;
    const successCount = logs.filter((l) => l.status === "SUCCESS").length;
    const successRate =
      totalActions > 0 ? (successCount / totalActions) * 100 : 0;

    const totalDuration = logs.reduce((sum, l) => sum + (l.durationMs ?? 0), 0);
    const avgExecutionTime =
      totalActions > 0 ? Math.round(totalDuration / totalActions) : 0;

    // Revenue recovered: sum estimatedImpact from executed proposals
    const executedProposals = await this.prisma.agentActionProposal.aggregate({
      where: {
        companyId,
        status: "EXECUTED",
        executedAt: { gte: since },
      },
      _sum: { estimatedImpact: true },
    });

    // Also check AgentExecutionMetrics for company-specific revenue
    const metricsRevenue = await this.prisma.agentExecutionMetrics.aggregate({
      where: {
        companyId,
        createdAt: { gte: since },
      },
      _sum: { revenueRecovered: true },
    });

    const revenueFromProposals = executedProposals._sum.estimatedImpact ?? 0;
    const revenueFromMetrics = metricsRevenue._sum.revenueRecovered ?? 0;
    const revenueRecovered = Math.max(revenueFromProposals, revenueFromMetrics);

    // Break down by action type
    const byActionType: AgentAnalytics["byActionType"] = {};
    for (const log of logs) {
      if (!byActionType[log.executionType]) {
        byActionType[log.executionType] = {
          count: 0,
          successCount: 0,
          avgDurationMs: 0,
        };
      }
      const entry = byActionType[log.executionType];
      entry.count++;
      if (log.status === "SUCCESS") entry.successCount++;
      entry.avgDurationMs += log.durationMs ?? 0;
    }
    for (const key of Object.keys(byActionType)) {
      const entry = byActionType[key];
      entry.avgDurationMs =
        entry.count > 0 ? Math.round(entry.avgDurationMs / entry.count) : 0;
    }

    return {
      totalActions,
      successRate: parseFloat(successRate.toFixed(1)),
      avgExecutionTime,
      revenueRecovered,
      byActionType,
    };
  }

  /**
   * Record per-execution metrics after an action completes.
   */
  async recordExecution(params: {
    companyId: string;
    actionType: string;
    executionTimeMs: number;
    success: boolean;
    error?: string;
    revenueRecovered?: number;
  }): Promise<void> {
    await this.prisma.agentExecutionMetrics.create({
      data: {
        companyId: params.companyId,
        actionType: params.actionType,
        executionTimeMs: params.executionTimeMs,
        success: params.success,
        error: params.error ?? null,
        revenueRecovered: params.revenueRecovered ?? 0,
        totalProcessed: 1,
        successes: params.success ? 1 : 0,
        failures: params.success ? 0 : 1,
        totalDurationMs: params.executionTimeMs,
        avgDurationMs: params.executionTimeMs,
      },
    });
  }
}
