// ── AgentExecutorService ──────────────────────────────────────────────────────
// Execute a pre-approved action proposal via the ActionConnectorAdapter.
// Writes an immutable AgentExecutionLog, updates proposal status, and audits.
// Never executes a proposal that has not been explicitly approved by a human.
//
// HIGH-RISK GATE: Before execution, AIPolicyEngine is consulted.
//   • DENY            → throw AppError.policyDeny
//   • REQUIRE_APPROVAL + requireDoubleApproval → check ActionApproval record;
//       if not FULLY_APPROVED, initiate a new DoubleApproval and return
//       { kind: 'approval_required', ... } so the controller can reply 202.
//   • ALLOW / REQUIRE_APPROVAL (single, already approved) → execute normally.

import { PrismaClient, Prisma } from "@prisma/client";
import { AppError } from "../../../../shared/errors/AppError";
import { createAuditLog } from "../../../audit/audit.service";
import { AgentProposalRepository } from "../../infrastructure/repositories/AgentProposalRepository";
import { ActionConnectorAdapter } from "../../infrastructure/connectors/ActionConnectorAdapter";
import { ExecutionPolicy } from "../../domain/policies/ExecutionPolicy";
import { ProposalStatus } from "../../domain/enums/ProposalStatus";
import { isWhitelistedAction } from "../../domain/enums/ActionType";
import { AIPolicyEngine } from "../../domain/policies/AIPolicyEngine";
import { DoubleApprovalService } from "./DoubleApprovalService";
import { AgentFeatureGuard } from "./AgentFeatureGuard";
import { AgentPolicyService } from "./AgentPolicyService";
import { AgentAnalyticsService } from "./AgentAnalyticsService";
import type { ProposalResponse, ExecutionLogResponse } from "../dto/agent.dto";

// ── Result discriminant ──────────────────────────────────────────────────────

export type ExecuteResult =
  | { kind: "executed"; proposal: ProposalResponse; log: ExecutionLogResponse }
  | {
      kind: "approval_required";
      approvalId: string;
      proposalId: string;
      status: string;
      message: string;
    };

export class AgentExecutorService {
  private readonly repository: AgentProposalRepository;
  private readonly connector: ActionConnectorAdapter;
  private readonly featureGuard: AgentFeatureGuard;
  private readonly policyService: AgentPolicyService;
  private readonly analyticsService: AgentAnalyticsService;

  constructor(private readonly prisma: PrismaClient) {
    this.repository = new AgentProposalRepository(prisma);
    this.connector = new ActionConnectorAdapter(prisma);
    this.featureGuard = new AgentFeatureGuard(prisma);
    this.policyService = new AgentPolicyService(prisma);
    this.analyticsService = new AgentAnalyticsService(prisma);
  }

  async execute(
    companyId: string,
    proposalId: string,
    executorId: string,
    executorEmail: string,
  ): Promise<ExecuteResult> {
    const proposal = await this.repository.findById(proposalId, companyId);
    if (!proposal) {
      throw AppError.notFound(`Proposal not found: ${proposalId}`);
    }

    // ── Kill Switch ──────────────────────────────────────────────────────────
    await this.featureGuard.assertAgentEnabled(companyId);

    // ── Whitelist Check ──────────────────────────────────────────────────────
    if (!isWhitelistedAction(proposal.actionType)) {
      // Log attempted violation in audit logs
      createAuditLog(this.prisma, {
        companyId,
        actorId: executorId,
        actorEmail: executorEmail,
        action: "AGENT_WHITELIST_VIOLATION",
        resourceType: "AgentActionProposal",
        resourceId: proposalId,
        detail: `Attempted execution of non-whitelisted action: ${proposal.actionType}`,
        metadata: { actionType: proposal.actionType, proposalId },
      }).catch((err) =>
        console.error("[AgentExecutorService] audit log failed:", err),
      );

      throw AppError.forbidden(
        `Action type "${proposal.actionType}" is not in the execution whitelist. This violation has been logged.`,
      );
    }

    if (!proposal.canBeExecuted()) {
      throw AppError.badRequest(
        `Proposal "${proposalId}" cannot be executed (status: ${proposal.status}, confidence: ${proposal.confidenceScore.toNumber()}).`,
      );
    }

    // Additional policy validation
    const violations = ExecutionPolicy.validateForExecution({
      status: proposal.status,
      confidenceScore: proposal.confidenceScore.toNumber(),
      estimatedImpact: proposal.estimatedImpact,
      actionType: proposal.actionType,
      requiresApproval: proposal.requiresApproval,
    });
    if (violations.length > 0) {
      throw AppError.badRequest(violations.map((v) => v.reason).join("; "));
    }

    // ── AI Policy Gate ────────────────────────────────────────────────────
    const policyCtx = await AIPolicyEngine.buildContext(this.prisma, {
      companyId,
      actionType: proposal.actionType,
      estimatedImpact: proposal.estimatedImpact,
      confidenceScore: proposal.confidenceScore.toNumber(),
    });

    const engine = new AIPolicyEngine();
    const evaluation = engine.evaluate(policyCtx);

    if (evaluation.verdict === "DENY") {
      throw AppError.policyDeny(
        `Action blocked by policy: ${evaluation.reasons.join("; ")}`,
        { reasons: evaluation.reasons },
      );
    }

    // ── Agent Policy Service Gate ─────────────────────────────────────────
    const policyEval = await this.policyService.evaluate(companyId, {
      actionType: proposal.actionType,
      estimatedImpact: proposal.estimatedImpact,
      confidenceScore: proposal.confidenceScore.toNumber(),
    });

    if (policyEval.verdict === "DENY") {
      throw AppError.policyDeny(
        `Action blocked by company policy: ${policyEval.reasons.join("; ")}`,
        { reasons: policyEval.reasons },
      );
    }

    // Check if double approval is required (from either engine)
    const needsDoubleApproval =
      evaluation.requireDoubleApproval ||
      policyEval.verdict === "REQUIRE_DOUBLE_APPROVAL";

    if (needsDoubleApproval) {
      const doubleApprovalSvc = new DoubleApprovalService(this.prisma);
      const isApproved = await doubleApprovalSvc.isFullyApproved(proposalId);

      if (!isApproved) {
        const approval = await doubleApprovalSvc.initiate(
          companyId,
          proposalId,
        );
        return {
          kind: "approval_required",
          approvalId: approval.approvalId,
          proposalId: approval.proposalId,
          status: approval.status,
          message:
            "This action requires two-factor approval. " +
            `Approval ${approval.approvalId} has been initiated (status: ${approval.status}).`,
        };
      }
    }

    // ── Execute ───────────────────────────────────────────────────────────
    const startTime = Date.now();
    let executionStatus: "SUCCESS" | "FAILED" = "FAILED";
    let result: Record<string, unknown> | null = null;
    let errorMessage: string | null = null;

    try {
      result = await this.connector.dispatch(
        proposal.actionType,
        proposal.payload,
        companyId,
      );
      executionStatus = "SUCCESS";
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
      console.error(
        `[AgentExecutorService] dispatch failed for proposal ${proposalId}:`,
        err,
      );
    }

    const durationMs = Date.now() - startTime;

    // Write immutable execution log
    const logRow = await this.prisma.agentExecutionLog.create({
      data: {
        companyId,
        proposalId,
        executionType: proposal.actionType,
        payload: proposal.payload as object,
        result:
          result !== null ? (result as Prisma.InputJsonValue) : Prisma.JsonNull,
        status: executionStatus,
        errorMessage,
        durationMs,
      },
    });

    // Update proposal status
    const finalStatus =
      executionStatus === "SUCCESS"
        ? ProposalStatus.EXECUTED
        : ProposalStatus.FAILED;

    const updatedProposal = await this.repository.updateStatus(
      proposalId,
      companyId,
      {
        status: finalStatus,
        executedAt: new Date(),
      },
    );

    // Fire-and-forget audit
    createAuditLog(this.prisma, {
      companyId,
      actorId: executorId,
      actorEmail: executorEmail,
      action: `AGENT_PROPOSAL_${finalStatus}`,
      resourceType: "AgentActionProposal",
      resourceId: proposalId,
      detail:
        errorMessage ?? `Executed ${proposal.actionType} in ${durationMs}ms`,
      metadata: {
        actionType: proposal.actionType,
        durationMs,
        executionStatus,
      },
    }).catch((err) =>
      console.error("[AgentExecutorService] audit log failed:", err),
    );

    // Fire-and-forget execution analytics
    this.analyticsService
      .recordExecution({
        companyId,
        actionType: proposal.actionType,
        executionTimeMs: durationMs,
        success: executionStatus === "SUCCESS",
        error: errorMessage ?? undefined,
        revenueRecovered:
          executionStatus === "SUCCESS" ? proposal.estimatedImpact : 0,
      })
      .catch((err) =>
        console.error(
          "[AgentExecutorService] analytics recording failed:",
          err,
        ),
      );

    const logResponse: ExecutionLogResponse = {
      id: logRow.id,
      companyId: logRow.companyId,
      proposalId: logRow.proposalId,
      executionType: logRow.executionType,
      payload: logRow.payload,
      result: logRow.result,
      status: logRow.status,
      errorMessage: logRow.errorMessage,
      durationMs: logRow.durationMs,
      createdAt: logRow.createdAt.toISOString(),
    };

    return { kind: "executed", proposal: updatedProposal, log: logResponse };
  }
}
