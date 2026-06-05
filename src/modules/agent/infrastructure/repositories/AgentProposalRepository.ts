// ── AgentProposalRepository ───────────────────────────────────────────────────
// Thin Prisma wrapper — all queries tenant-scoped by companyId.

import { PrismaClient } from "@prisma/client";
import {
  ActionProposal,
  ActionProposalProps,
} from "../../domain/entities/ActionProposal";
import { ConfidenceScore } from "../../domain/value-objects/ConfidenceScore";
import { ActionType } from "../../domain/enums/ActionType";
import { ProposalStatus } from "../../domain/enums/ProposalStatus";
import type {
  ProposalResponse,
  ExecutionLogResponse,
} from "../../application/dto/agent.dto";

export interface CreateProposalInput {
  companyId: string;
  insightId: string;
  actionType: ActionType;
  priorityScore: number;
  confidenceScore: number;
  estimatedImpact: number;
  impactScore?: number;
  riskScore?: number;
  payload: Record<string, unknown>;
  rationale: string | null;
  status: ProposalStatus;
  requiresApproval: boolean;
}

export interface UpdateStatusInput {
  status: ProposalStatus;
  approvedBy?: string;
  approvedAt?: Date;
  executedAt?: Date;
}

export interface ListProposalsOptions {
  status?: string;
  insightId?: string;
  page: number;
  limit: number;
}

export interface PaginatedProposals {
  items: ProposalResponse[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export class AgentProposalRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateProposalInput): Promise<ProposalResponse> {
    const row = await this.prisma.agentActionProposal.create({
      data: {
        companyId: input.companyId,
        insightId: input.insightId,
        actionType: input.actionType,
        priorityScore: input.priorityScore,
        confidenceScore: input.confidenceScore,
        estimatedImpact: input.estimatedImpact,
        impactScore: input.impactScore ?? 0,
        riskScore: input.riskScore ?? 0,
        payload: input.payload as object,
        rationale: input.rationale ?? null,
        status: input.status,
        requiresApproval: input.requiresApproval,
      },
    });
    return this._toResponse(row);
  }

  async findById(
    id: string,
    companyId: string,
  ): Promise<ActionProposal | null> {
    const row = await this.prisma.agentActionProposal.findFirst({
      where: { id, companyId },
    });
    if (!row) return null;
    return this._toDomain(row);
  }

  async findMany(
    companyId: string,
    options: ListProposalsOptions,
  ): Promise<PaginatedProposals> {
    const { status, insightId, page, limit } = options;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { companyId };
    if (status) where["status"] = status;
    if (insightId) where["insightId"] = insightId;

    const [total, rows] = await Promise.all([
      this.prisma.agentActionProposal.count({ where }),
      this.prisma.agentActionProposal.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / limit));
    return {
      items: rows.map((r) => this._toResponse(r)),
      total,
      page,
      limit,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    };
  }

  async updateStatus(
    id: string,
    companyId: string,
    update: UpdateStatusInput,
  ): Promise<ProposalResponse> {
    const row = await this.prisma.agentActionProposal.update({
      where: { id },
      data: {
        status: update.status,
        approvedBy: update.approvedBy ?? undefined,
        approvedAt: update.approvedAt ?? undefined,
        executedAt: update.executedAt ?? undefined,
      },
    });
    // Extra safety — confirm tenant match
    if (row.companyId !== companyId) {
      throw new Error("Tenant mismatch in updateStatus");
    }
    return this._toResponse(row);
  }

  async getExecutionLogs(
    proposalId: string,
    companyId: string,
  ): Promise<ExecutionLogResponse[]> {
    // Verify proposal belongs to company
    const proposal = await this.prisma.agentActionProposal.findFirst({
      where: { id: proposalId, companyId },
      select: { id: true },
    });
    if (!proposal) return [];

    const logs = await this.prisma.agentExecutionLog.findMany({
      where: { proposalId },
      orderBy: { createdAt: "desc" },
    });

    return logs.map((l) => ({
      id: l.id,
      companyId: l.companyId,
      proposalId: l.proposalId,
      executionType: l.executionType,
      payload: l.payload,
      result: l.result,
      status: l.status,
      errorMessage: l.errorMessage,
      durationMs: l.durationMs,
      createdAt: l.createdAt.toISOString(),
    }));
  }

  /**
   * Deduplicates PROPOSED proposals for a company.
   * For each (insightId, actionType) group where status = PROPOSED, keeps only
   * the most recent row and deletes the rest.
   * Returns the number of duplicate rows deleted.
   */
  async deduplicateProposals(companyId: string): Promise<number> {
    // 1. Find all (insightId, actionType) groups with > 1 PROPOSED proposal
    const groups = await this.prisma.agentActionProposal.groupBy({
      by: ["insightId", "actionType"],
      where: { companyId, status: "PROPOSED" },
      _count: { id: true },
      having: { id: { _count: { gt: 1 } } },
    });

    let totalDeleted = 0;

    for (const group of groups) {
      // 2. For each group, find all proposals ordered by createdAt DESC
      const proposals = await this.prisma.agentActionProposal.findMany({
        where: {
          companyId,
          insightId: group.insightId,
          actionType: group.actionType,
          status: "PROPOSED",
        },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });

      // 3. Keep the first (newest), delete the rest
      const idsToDelete = proposals.slice(1).map((p) => p.id);
      if (idsToDelete.length > 0) {
        const { count } = await this.prisma.agentActionProposal.deleteMany({
          where: { id: { in: idsToDelete } },
        });
        totalDeleted += count;
      }
    }

    return totalDeleted;
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private _toResponse(row: {
    id: string;
    companyId: string;
    insightId: string;
    actionType: string;
    priorityScore: number;
    confidenceScore: number;
    estimatedImpact: number;
    impactScore: number;
    riskScore: number;
    payload: unknown;
    rationale: string | null;
    status: string;
    requiresApproval: boolean;
    approvedBy: string | null;
    approvedAt: Date | null;
    executedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): ProposalResponse {
    return {
      id: row.id,
      companyId: row.companyId,
      insightId: row.insightId,
      actionType: row.actionType,
      priorityScore: row.priorityScore,
      confidenceScore: row.confidenceScore,
      estimatedImpact: row.estimatedImpact,
      impactScore: row.impactScore,
      riskScore: row.riskScore,
      payload: row.payload as Record<string, unknown>,
      rationale: row.rationale,
      status: row.status,
      requiresApproval: row.requiresApproval,
      approvedBy: row.approvedBy,
      approvedAt: row.approvedAt?.toISOString() ?? null,
      executedAt: row.executedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private _toDomain(row: {
    id: string;
    companyId: string;
    insightId: string;
    actionType: string;
    priorityScore: number;
    confidenceScore: number;
    estimatedImpact: number;
    impactScore: number;
    riskScore: number;
    payload: unknown;
    rationale: string | null;
    status: string;
    requiresApproval: boolean;
    approvedBy: string | null;
    approvedAt: Date | null;
    executedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): ActionProposal {
    const props: ActionProposalProps = {
      id: row.id,
      companyId: row.companyId,
      insightId: row.insightId,
      actionType: row.actionType as ActionType,
      priorityScore: row.priorityScore,
      confidenceScore: ConfidenceScore.of(row.confidenceScore),
      estimatedImpact: row.estimatedImpact,
      payload: row.payload as Record<string, unknown>,
      rationale: row.rationale,
      status: row.status as ProposalStatus,
      requiresApproval: row.requiresApproval,
      approvedBy: row.approvedBy,
      approvedAt: row.approvedAt,
      executedAt: row.executedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
    return new ActionProposal(props);
  }
}
