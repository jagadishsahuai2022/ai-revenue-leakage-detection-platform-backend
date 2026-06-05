// ── ExecutionPolicy domain policy ──────────────────────────────────────────────
// Centralises all business rules around when a proposal may be approved or
// executed.  No infrastructure dependencies.

import { ActionType } from "../enums/ActionType";
import { ProposalStatus } from "../enums/ProposalStatus";
import { ConfidenceScore } from "../value-objects/ConfidenceScore";

export interface ProposalSnapshot {
  status: ProposalStatus;
  confidenceScore: number; // raw float
  estimatedImpact: number;
  actionType: ActionType;
  requiresApproval: boolean;
}

export type UserRole = "SUPER_ADMIN" | "COMPANY_ADMIN" | "ANALYST" | "VIEWER";

export interface PolicyViolation {
  reason: string;
}

export class ExecutionPolicy {
  // ── Thresholds ────────────────────────────────────────────────────────────
  static readonly MIN_CONFIDENCE = ConfidenceScore.MIN_SUFFICIENT; // 0.6
  static readonly MIN_IMPACT = 100; // $100 minimum impact to be actionable

  // Actions that are inherently high-risk and always require manual approval
  private static readonly HIGH_RISK_ACTIONS = new Set<ActionType>([
    ActionType.DISABLE_SUBSCRIPTION,
    ActionType.NOTIFY_FINANCE_TEAM,
    ActionType.REFUND_PAYMENT,
    ActionType.UPDATE_SUBSCRIPTION,
  ]);

  // Role required to approve per action type (defaults to COMPANY_ADMIN)
  private static readonly REQUIRED_APPROVAL_ROLE: Record<ActionType, UserRole> =
    {
      [ActionType.RETRY_PAYMENT]: "COMPANY_ADMIN",
      [ActionType.SEND_COLLECTION_EMAIL]: "COMPANY_ADMIN",
      [ActionType.FLAG_HIGH_RISK_ACCOUNT]: "COMPANY_ADMIN",
      [ActionType.GENERATE_INVOICE]: "COMPANY_ADMIN",
      [ActionType.DISABLE_SUBSCRIPTION]: "COMPANY_ADMIN",
      [ActionType.NOTIFY_FINANCE_TEAM]: "COMPANY_ADMIN",
      [ActionType.REFUND_PAYMENT]: "COMPANY_ADMIN",
      [ActionType.FIX_INVOICE]: "COMPANY_ADMIN",
      [ActionType.SEND_NOTIFICATION]: "COMPANY_ADMIN",
      [ActionType.UPDATE_SUBSCRIPTION]: "COMPANY_ADMIN",
      [ActionType.MARK_REVENUE_RECOVERED]: "COMPANY_ADMIN",
    };

  // ── Public helpers ────────────────────────────────────────────────────────
  static mustRequireApproval(actionType: ActionType): boolean {
    return ExecutionPolicy.HIGH_RISK_ACTIONS.has(actionType);
  }

  static requiredRoleForApproval(actionType: ActionType): UserRole {
    return (
      ExecutionPolicy.REQUIRED_APPROVAL_ROLE[actionType] ?? "COMPANY_ADMIN"
    );
  }

  /** Returns an array of violation reasons; empty = policy passes */
  static validateForApproval(
    proposal: ProposalSnapshot,
    approverRole: UserRole,
  ): PolicyViolation[] {
    const violations: PolicyViolation[] = [];

    if (proposal.status !== ProposalStatus.PROPOSED) {
      violations.push({
        reason: `Proposal is not in PROPOSED state (current: ${proposal.status})`,
      });
    }

    const requiredRole = ExecutionPolicy.requiredRoleForApproval(
      proposal.actionType,
    );
    if (
      approverRole !== requiredRole &&
      approverRole !== "COMPANY_ADMIN" &&
      approverRole !== "SUPER_ADMIN"
    ) {
      violations.push({
        reason: `Role "${approverRole}" is not authorised to approve ${proposal.actionType}`,
      });
    }

    return violations;
  }

  /** Returns an array of violation reasons; empty = policy passes */
  static validateForExecution(proposal: ProposalSnapshot): PolicyViolation[] {
    const violations: PolicyViolation[] = [];

    if (proposal.status !== ProposalStatus.APPROVED) {
      violations.push({
        reason: `Proposal must be APPROVED before execution (current: ${proposal.status})`,
      });
    }

    if (proposal.confidenceScore < ExecutionPolicy.MIN_CONFIDENCE) {
      violations.push({
        reason: `Confidence ${proposal.confidenceScore.toFixed(3)} is below minimum ${ExecutionPolicy.MIN_CONFIDENCE}`,
      });
    }

    if (proposal.estimatedImpact < ExecutionPolicy.MIN_IMPACT) {
      violations.push({
        reason: `Estimated impact $${proposal.estimatedImpact} is below minimum $${ExecutionPolicy.MIN_IMPACT}`,
      });
    }

    return violations;
  }
}
