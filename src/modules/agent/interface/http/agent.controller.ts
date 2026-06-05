// ── AgentController ───────────────────────────────────────────────────────────
// HTTP handler layer — validates input, delegates to application services,
// formats responses.  No business logic lives here.

import { FastifyRequest, FastifyReply } from "fastify";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { AppError } from "../../../../shared/errors/AppError";
import {
  successResponse,
  createdResponse,
} from "../../../../shared/utils/response";
import { AgentPlannerService } from "../../application/services/AgentPlannerService";
import { AgentApprovalService } from "../../application/services/AgentApprovalService";
import { AgentExecutorService } from "../../application/services/AgentExecutorService";
import { DoubleApprovalService } from "../../application/services/DoubleApprovalService";
import { AgentAnalyticsService } from "../../application/services/AgentAnalyticsService";
import { AgentPolicyService } from "../../application/services/AgentPolicyService";
import { AgentProposalRepository } from "../../infrastructure/repositories/AgentProposalRepository";
import {
  PlanBodySchema,
  ListQuerySchema,
  ProposalIdParamSchema,
  ApproveBodySchema,
  RejectBodySchema,
} from "../validators/agent.schema";
import type { UserRole } from "../../domain/policies/ExecutionPolicy";

type IdParam = { Params: { id: string } };
type ApprovalParam = { Params: { approvalId: string } };

const ApprovalIdParamSchema = z.object({ approvalId: z.string().min(1) });
const DoubleApproveBodySchema = z.object({ notes: z.string().optional() });
const DoubleRejectBodySchema = z.object({ reason: z.string().min(1) });

export class AgentController {
  private readonly planner: AgentPlannerService;
  private readonly approval: AgentApprovalService;
  private readonly executor: AgentExecutorService;
  private readonly repo: AgentProposalRepository;
  private readonly doubleApproval: DoubleApprovalService;
  private readonly analytics: AgentAnalyticsService;
  private readonly policyService: AgentPolicyService;

  constructor(private readonly prisma: PrismaClient) {
    this.planner = new AgentPlannerService(prisma);
    this.approval = new AgentApprovalService(prisma);
    this.executor = new AgentExecutorService(prisma);
    this.repo = new AgentProposalRepository(prisma);
    this.doubleApproval = new DoubleApprovalService(prisma);
    this.analytics = new AgentAnalyticsService(prisma);
    this.policyService = new AgentPolicyService(prisma);
  }

  // ── POST /agent/plan ─────────────────────────────────────────────────────
  async planForInsight(request: FastifyRequest, reply: FastifyReply) {
    const parsed = PlanBodySchema.safeParse(request.body);
    if (!parsed.success) {
      throw AppError.badRequest("Invalid request body", parsed.error.format());
    }

    const result = await this.planner.planForInsight(
      request.companyId,
      parsed.data,
    );

    return reply.code(201).send(createdResponse(result));
  }

  // ── GET /agent/proposals ─────────────────────────────────────────────────
  async listProposals(request: FastifyRequest, reply: FastifyReply) {
    const parsed = ListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw AppError.badRequest(
        "Invalid query parameters",
        parsed.error.format(),
      );
    }

    const result = await this.repo.findMany(request.companyId, parsed.data);
    return reply.send(successResponse(result));
  }

  // ── POST /agent/proposals/:id/approve ────────────────────────────────────
  async approveProposal(request: FastifyRequest<IdParam>, reply: FastifyReply) {
    const paramParsed = ProposalIdParamSchema.safeParse(request.params);
    if (!paramParsed.success) {
      throw AppError.badRequest("Invalid proposal ID");
    }

    const bodyParsed = ApproveBodySchema.safeParse(request.body);
    if (!bodyParsed.success) {
      throw AppError.badRequest(
        "Invalid request body",
        bodyParsed.error.format(),
      );
    }

    const proposal = await this.approval.approve(
      request.companyId,
      paramParsed.data.id,
      request.userId,
      request.userEmail ?? "",
      (request.userRole as UserRole) ?? "COMPANY_ADMIN",
      bodyParsed.data.notes,
    );

    return reply.send(successResponse(proposal));
  }

  // ── POST /agent/proposals/:id/reject ─────────────────────────────────────
  async rejectProposal(request: FastifyRequest<IdParam>, reply: FastifyReply) {
    const paramParsed = ProposalIdParamSchema.safeParse(request.params);
    if (!paramParsed.success) {
      throw AppError.badRequest("Invalid proposal ID");
    }

    const bodyParsed = RejectBodySchema.safeParse(request.body);
    if (!bodyParsed.success) {
      throw AppError.badRequest(
        "Invalid request body",
        bodyParsed.error.format(),
      );
    }

    const proposal = await this.approval.reject(
      request.companyId,
      paramParsed.data.id,
      request.userId,
      request.userEmail ?? "",
      bodyParsed.data.reason,
    );

    return reply.send(successResponse(proposal));
  }

  // ── POST /agent/proposals/:id/execute ────────────────────────────────────
  async executeProposal(request: FastifyRequest<IdParam>, reply: FastifyReply) {
    const paramParsed = ProposalIdParamSchema.safeParse(request.params);
    if (!paramParsed.success) {
      throw AppError.badRequest("Invalid proposal ID");
    }

    const result = await this.executor.execute(
      request.companyId,
      paramParsed.data.id,
      request.userId,
      request.userEmail ?? "",
    );

    // High-risk action intercepted → 202 Accepted
    if (result.kind === "approval_required") {
      return reply.code(202).send(
        successResponse({
          status: "APPROVAL_REQUIRED",
          approvalId: result.approvalId,
          proposalId: result.proposalId,
          approvalStatus: result.status,
          message: result.message,
        }),
      );
    }

    return reply.send(successResponse(result));
  }

  // ── GET /agent/execution-logs ────────────────────────────────────────────
  async getExecutionLogs(
    request: FastifyRequest<IdParam>,
    reply: FastifyReply,
  ) {
    const paramParsed = ProposalIdParamSchema.safeParse(request.params);
    if (!paramParsed.success) {
      throw AppError.badRequest("Invalid proposal ID");
    }

    const logs = await this.repo.getExecutionLogs(
      paramParsed.data.id,
      request.companyId,
    );

    return reply.send(successResponse(logs));
  }

  // ── POST /agent/proposals/cleanup ─────────────────────────────────────────
  // Removes duplicate PROPOSED proposals — keeps the most recent per
  // (insightId, actionType) pair.  Safe to call multiple times.
  async cleanupDuplicates(request: FastifyRequest, reply: FastifyReply) {
    const deleted = await this.repo.deduplicateProposals(request.companyId);
    return reply.send(
      successResponse({
        deleted,
        message:
          deleted > 0
            ? `Removed ${deleted} duplicate PROPOSED proposal(s).`
            : "No duplicates found — proposals are already clean.",
      }),
    );
  }

  // ── Double-Approval Workflow ─────────────────────────────────────────────

  // GET /agent/approvals/:approvalId
  async getDoubleApprovalStatus(
    request: FastifyRequest<ApprovalParam>,
    reply: FastifyReply,
  ) {
    const parsed = ApprovalIdParamSchema.safeParse(request.params);
    if (!parsed.success) {
      throw AppError.badRequest("Invalid approval ID");
    }

    const record = await this.doubleApproval.findByApprovalId(
      request.companyId,
      parsed.data.approvalId,
    );

    if (!record) throw AppError.notFound("Approval");

    return reply.send(successResponse(record));
  }

  // POST /agent/approvals/:approvalId/approve
  async submitDoubleApproval(
    request: FastifyRequest<ApprovalParam>,
    reply: FastifyReply,
  ) {
    const paramParsed = ApprovalIdParamSchema.safeParse(request.params);
    if (!paramParsed.success) {
      throw AppError.badRequest("Invalid approval ID");
    }

    // notes body is optional — parse but don't require
    DoubleApproveBodySchema.safeParse(request.body);

    const record = await this.doubleApproval.submitApprovalByApprovalId(
      request.companyId,
      paramParsed.data.approvalId,
      request.userId,
      request.userEmail ?? "",
    );

    return reply.send(successResponse(record));
  }

  // POST /agent/approvals/:approvalId/reject
  async rejectDoubleApproval(
    request: FastifyRequest<ApprovalParam>,
    reply: FastifyReply,
  ) {
    const paramParsed = ApprovalIdParamSchema.safeParse(request.params);
    if (!paramParsed.success) {
      throw AppError.badRequest("Invalid approval ID");
    }

    const bodyParsed = DoubleRejectBodySchema.safeParse(request.body);
    if (!bodyParsed.success) {
      throw AppError.badRequest(
        "Invalid request body",
        bodyParsed.error.format(),
      );
    }

    const record = await this.doubleApproval.rejectByApprovalId(
      request.companyId,
      paramParsed.data.approvalId,
      request.userId,
      request.userEmail ?? "",
      bodyParsed.data.reason,
    );

    return reply.send(successResponse(record));
  }

  // ── Dashboard Analytics ───────────────────────────────────────────────────

  /**
   * GET /agent/metrics
   * Returns aggregate execution metrics from cron runs.
   */
  async getMetrics(request: FastifyRequest, reply: FastifyReply) {
    const query = (request.query ?? {}) as { days?: string };
    const days = Math.min(
      90,
      Math.max(1, parseInt(query.days ?? "30", 10) || 30),
    );
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Aggregate execution metrics
    let metricsRows: Array<{
      runAt: Date;
      totalProcessed: number;
      successes: number;
      failures: number;
      skipped: number;
      cancelled: number;
      totalDurationMs: number;
      avgDurationMs: number;
    }> = [];

    try {
      metricsRows = await this.prisma.agentExecutionMetrics.findMany({
        where: { runAt: { gte: since } },
        orderBy: { runAt: "desc" },
        take: 100,
      });
    } catch {
      // Table may not exist yet — return empty
    }

    // Compute aggregate stats
    const totals = metricsRows.reduce(
      (acc, r) => {
        acc.totalProcessed += r.totalProcessed;
        acc.successes += r.successes;
        acc.failures += r.failures;
        acc.skipped += r.skipped;
        acc.cancelled += r.cancelled;
        acc.totalDurationMs += r.totalDurationMs;
        return acc;
      },
      {
        totalProcessed: 0,
        successes: 0,
        failures: 0,
        skipped: 0,
        cancelled: 0,
        totalDurationMs: 0,
      },
    );

    const successRate =
      totals.totalProcessed > 0
        ? ((totals.successes / totals.totalProcessed) * 100).toFixed(1)
        : "0";

    return reply.send(
      successResponse({
        period: { days, since: since.toISOString() },
        aggregate: {
          ...totals,
          successRate: parseFloat(successRate),
          avgDurationMs:
            totals.totalProcessed > 0
              ? Math.round(totals.totalDurationMs / totals.totalProcessed)
              : 0,
          totalRuns: metricsRows.length,
        },
        recentRuns: metricsRows.slice(0, 20).map((r) => ({
          runAt: r.runAt.toISOString(),
          totalProcessed: r.totalProcessed,
          successes: r.successes,
          failures: r.failures,
          skipped: r.skipped,
          cancelled: r.cancelled,
          durationMs: r.totalDurationMs,
        })),
      }),
    );
  }

  /**
   * GET /agent/executions
   * Returns recent execution logs across all proposals for the company.
   */
  async getExecutions(request: FastifyRequest, reply: FastifyReply) {
    const query = (request.query ?? {}) as {
      page?: string;
      limit?: string;
      status?: string;
    };
    const page = Math.max(1, parseInt(query.page ?? "1", 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, parseInt(query.limit ?? "20", 10) || 20),
    );
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { companyId: request.companyId };
    if (query.status) where["status"] = query.status;

    const [total, logs] = await Promise.all([
      this.prisma.agentExecutionLog.count({ where }),
      this.prisma.agentExecutionLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        include: {
          proposal: {
            select: {
              actionType: true,
              priorityScore: true,
              confidenceScore: true,
              estimatedImpact: true,
              rationale: true,
            },
          },
        },
      }),
    ]);

    return reply.send(
      successResponse({
        items: logs.map((l) => ({
          id: l.id,
          proposalId: l.proposalId,
          executionType: l.executionType,
          status: l.status,
          errorMessage: l.errorMessage,
          durationMs: l.durationMs,
          createdAt: l.createdAt.toISOString(),
          proposal: l.proposal
            ? {
                actionType: l.proposal.actionType,
                priorityScore: l.proposal.priorityScore,
                confidenceScore: l.proposal.confidenceScore,
                estimatedImpact: l.proposal.estimatedImpact,
                rationale: l.proposal.rationale,
              }
            : null,
        })),
        total,
        page,
        limit,
      }),
    );
  }

  /**
   * GET /agent/summary
   * Returns a high-level summary of the agent system for dashboard cards.
   */
  async getSummary(request: FastifyRequest, reply: FastifyReply) {
    const companyId = request.companyId;

    const [
      totalProposals,
      proposedCount,
      approvedCount,
      executedCount,
      failedCount,
      rejectedCount,
      totalExecutions,
      recentExecutions,
    ] = await Promise.all([
      this.prisma.agentActionProposal.count({ where: { companyId } }),
      this.prisma.agentActionProposal.count({
        where: { companyId, status: "PROPOSED" },
      }),
      this.prisma.agentActionProposal.count({
        where: { companyId, status: "APPROVED" },
      }),
      this.prisma.agentActionProposal.count({
        where: { companyId, status: "EXECUTED" },
      }),
      this.prisma.agentActionProposal.count({
        where: { companyId, status: "FAILED" },
      }),
      this.prisma.agentActionProposal.count({
        where: { companyId, status: "REJECTED" },
      }),
      this.prisma.agentExecutionLog.count({ where: { companyId } }),
      this.prisma.agentExecutionLog.findMany({
        where: { companyId },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true,
          executionType: true,
          status: true,
          durationMs: true,
          createdAt: true,
        },
      }),
    ]);

    // Compute estimated total impact of executed proposals
    const impactResult = await this.prisma.agentActionProposal.aggregate({
      where: { companyId, status: "EXECUTED" },
      _sum: { estimatedImpact: true },
    });

    return reply.send(
      successResponse({
        proposals: {
          total: totalProposals,
          proposed: proposedCount,
          approved: approvedCount,
          executed: executedCount,
          failed: failedCount,
          rejected: rejectedCount,
        },
        executions: {
          total: totalExecutions,
          estimatedImpactRecovered: impactResult._sum.estimatedImpact ?? 0,
          recent: recentExecutions.map((e) => ({
            id: e.id,
            type: e.executionType,
            status: e.status,
            durationMs: e.durationMs,
            createdAt: e.createdAt.toISOString(),
          })),
        },
      }),
    );
  }

  // ── GET /agent/analytics ──────────────────────────────────────────────────
  async getAnalytics(request: FastifyRequest, reply: FastifyReply) {
    const query = (request.query ?? {}) as { days?: string };
    const days = Math.min(
      90,
      Math.max(1, parseInt(query.days ?? "30", 10) || 30),
    );

    const result = await this.analytics.getAnalytics(request.companyId, days);
    return reply.send(successResponse(result));
  }

  // ── GET /agent/policies ───────────────────────────────────────────────────
  async getPolicies(request: FastifyRequest, reply: FastifyReply) {
    const policy = await this.policyService.loadPolicy(request.companyId);
    return reply.send(successResponse(policy));
  }

  // ── PUT /agent/policies ───────────────────────────────────────────────────
  async updatePolicies(request: FastifyRequest, reply: FastifyReply) {
    const body = request.body as
      | {
          refundThreshold?: number;
          autoExecuteImpactLimit?: number;
          confidenceThreshold?: number;
        }
      | undefined;

    if (!body) {
      throw AppError.badRequest("Request body is required");
    }

    // Validate ranges
    if (body.refundThreshold != null && body.refundThreshold < 0) {
      throw AppError.badRequest("refundThreshold must be >= 0");
    }
    if (
      body.autoExecuteImpactLimit != null &&
      body.autoExecuteImpactLimit < 0
    ) {
      throw AppError.badRequest("autoExecuteImpactLimit must be >= 0");
    }
    if (
      body.confidenceThreshold != null &&
      (body.confidenceThreshold < 0 || body.confidenceThreshold > 1)
    ) {
      throw AppError.badRequest("confidenceThreshold must be between 0 and 1");
    }

    const updated = await this.policyService.upsertPolicy(
      request.companyId,
      body,
    );
    return reply.send(successResponse(updated));
  }
}
