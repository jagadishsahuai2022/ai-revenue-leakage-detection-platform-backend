// ─────────────────────────────────────────────────────────────────────────────
// Double-Approval Workflow Service
//
// Implements financial-grade double-approval for high-risk actions.
// Two DISTINCT approvers (approver1 != approver2) must sign off before
// the proposal transitions to APPROVED.
//
// State machine:
//   PENDING_FIRST → user A approves → PENDING_SECOND → user B approves → FULLY_APPROVED
//   At any point → a user rejects → REJECTED
//
// Integrates with the AIPolicyEngine to determine whether single or double
// approval is required.
// ─────────────────────────────────────────────────────────────────────────────

import { PrismaClient } from '@prisma/client';
import { AppError } from '../../../../shared/errors/AppError';
import { createAuditLog } from '../../../audit/audit.service';

export type DoubleApprovalStatus = 'PENDING_FIRST' | 'PENDING_SECOND' | 'FULLY_APPROVED' | 'REJECTED';

export interface DoubleApprovalResult {
  approvalId: string;
  proposalId: string;
  status: DoubleApprovalStatus;
  approver1Id: string | null;
  approver2Id: string | null;
}

export class DoubleApprovalService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Create a double-approval record for a proposal that requires it.
   * Called when AIPolicyEngine returns requireDoubleApproval = true.
   */
  async initiate(companyId: string, proposalId: string): Promise<DoubleApprovalResult> {
    const existing = await this.prisma.actionApproval.findUnique({
      where: { proposalId },
    });

    if (existing) {
      return this.toResult(existing);
    }

    const approval = await this.prisma.actionApproval.create({
      data: {
        companyId,
        proposalId,
        status: 'PENDING_FIRST',
      },
    });

    return this.toResult(approval);
  }

  /**
   * Submit an approval from a user. Enforces the constraint that
   * approver2 must differ from approver1.
   */
  async submitApproval(
    companyId: string,
    proposalId: string,
    approverId: string,
    approverEmail: string,
  ): Promise<DoubleApprovalResult> {
    const approval = await this.prisma.actionApproval.findUnique({
      where: { proposalId },
    });

    if (!approval) {
      throw AppError.notFound(`No double-approval record for proposal: ${proposalId}`);
    }

    if (approval.companyId !== companyId) {
      throw AppError.forbidden('Tenant mismatch on approval record');
    }

    if (approval.status === 'FULLY_APPROVED') {
      throw AppError.badRequest('Proposal is already fully approved');
    }

    if (approval.status === 'REJECTED') {
      throw AppError.badRequest('Proposal has been rejected');
    }

    // ── First approval ────────────────────────────────────────────────────
    if (approval.status === 'PENDING_FIRST') {
      const updated = await this.prisma.actionApproval.update({
        where: { proposalId },
        data: {
          approver1Id: approverId,
          approver1At: new Date(),
          status: 'PENDING_SECOND',
        },
      });

      this.audit(companyId, approverId, approverEmail, proposalId, 'FIRST_APPROVAL');

      return this.toResult(updated);
    }

    // ── Second approval ───────────────────────────────────────────────────
    if (approval.status === 'PENDING_SECOND') {
      if (approval.approver1Id === approverId) {
        throw AppError.badRequest(
          'Second approver must be a different user than the first approver',
        );
      }

      const updated = await this.prisma.actionApproval.update({
        where: { proposalId },
        data: {
          approver2Id: approverId,
          approver2At: new Date(),
          status: 'FULLY_APPROVED',
        },
      });

      this.audit(companyId, approverId, approverEmail, proposalId, 'SECOND_APPROVAL');

      return this.toResult(updated);
    }

    throw AppError.badRequest(`Unexpected approval status: ${approval.status}`);
  }

  /**
   * Reject a double-approval at any stage.
   */
  async reject(
    companyId: string,
    proposalId: string,
    rejectorId: string,
    rejectorEmail: string,
    reason: string,
  ): Promise<DoubleApprovalResult> {
    const approval = await this.prisma.actionApproval.findUnique({
      where: { proposalId },
    });

    if (!approval) {
      throw AppError.notFound(`No double-approval record for proposal: ${proposalId}`);
    }

    if (approval.companyId !== companyId) {
      throw AppError.forbidden('Tenant mismatch on approval record');
    }

    if (approval.status === 'FULLY_APPROVED' || approval.status === 'REJECTED') {
      throw AppError.badRequest(`Cannot reject an approval in status "${approval.status}"`);
    }

    const updated = await this.prisma.actionApproval.update({
      where: { proposalId },
      data: {
        status: 'REJECTED',
        rejectedBy: rejectorId,
        rejectedAt: new Date(),
        rejectReason: reason,
      },
    });

    this.audit(companyId, rejectorId, rejectorEmail, proposalId, 'DOUBLE_APPROVAL_REJECTED');

    return this.toResult(updated);
  }

  /**
   * Check if a proposal is fully approved (both approvers signed off).
   */
  async isFullyApproved(proposalId: string): Promise<boolean> {
    const approval = await this.prisma.actionApproval.findUnique({
      where: { proposalId },
    });
    return approval?.status === 'FULLY_APPROVED';
  }

  /**
   * Get the current approval status for a proposal.
   */
  async getApprovalStatus(proposalId: string): Promise<DoubleApprovalResult | null> {
    const approval = await this.prisma.actionApproval.findUnique({
      where: { proposalId },
    });
    return approval ? this.toResult(approval) : null;
  }

  /**
   * Get an approval record by its own ID (used by the /approvals/:approvalId route).
   */
  async findByApprovalId(
    companyId: string,
    approvalId: string,
  ): Promise<DoubleApprovalResult | null> {
    const approval = await this.prisma.actionApproval.findFirst({
      where: { id: approvalId, companyId },
    });
    return approval ? this.toResult(approval) : null;
  }

  /**
   * Submit an approval by approval record ID (used by /approvals/:approvalId/approve).
   */
  async submitApprovalByApprovalId(
    companyId: string,
    approvalId: string,
    approverId: string,
    approverEmail: string,
  ): Promise<DoubleApprovalResult> {
    const approval = await this.prisma.actionApproval.findFirst({
      where: { id: approvalId, companyId },
    });
    if (!approval) {
      throw AppError.notFound(`Approval record not found: ${approvalId}`);
    }
    if (approval.status === 'FULLY_APPROVED') {
      throw AppError.badRequest('Proposal is already fully approved');
    }
    if (approval.status === 'REJECTED') {
      throw AppError.badRequest('Proposal has been rejected');
    }

    if (approval.status === 'PENDING_FIRST') {
      const updated = await this.prisma.actionApproval.update({
        where: { id: approvalId },
        data: { approver1Id: approverId, approver1At: new Date(), status: 'PENDING_SECOND' },
      });
      this.audit(companyId, approverId, approverEmail, approval.proposalId, 'FIRST_APPROVAL');
      return this.toResult(updated);
    }

    // PENDING_SECOND
    if (approval.approver1Id === approverId) {
      throw AppError.selfApprovalForbidden();
    }
    const updated = await this.prisma.actionApproval.update({
      where: { id: approvalId },
      data: { approver2Id: approverId, approver2At: new Date(), status: 'FULLY_APPROVED' },
    });
    this.audit(companyId, approverId, approverEmail, approval.proposalId, 'SECOND_APPROVAL');
    return this.toResult(updated);
  }

  /**
   * Reject a double-approval by approval record ID.
   */
  async rejectByApprovalId(
    companyId: string,
    approvalId: string,
    rejectorId: string,
    rejectorEmail: string,
    reason: string,
  ): Promise<DoubleApprovalResult> {
    const approval = await this.prisma.actionApproval.findFirst({
      where: { id: approvalId, companyId },
    });
    if (!approval) {
      throw AppError.notFound(`Approval record not found: ${approvalId}`);
    }
    if (approval.status === 'FULLY_APPROVED' || approval.status === 'REJECTED') {
      throw AppError.badRequest(`Cannot reject an approval in status "${approval.status}"`);
    }
    const updated = await this.prisma.actionApproval.update({
      where: { id: approvalId },
      data: { status: 'REJECTED', rejectedBy: rejectorId, rejectedAt: new Date(), rejectReason: reason },
    });
    this.audit(companyId, rejectorId, rejectorEmail, approval.proposalId, 'DOUBLE_APPROVAL_REJECTED');
    return this.toResult(updated);
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toResult(row: any): DoubleApprovalResult {
    return {
      approvalId: row.id,
      proposalId: row.proposalId,
      status: row.status as DoubleApprovalStatus,
      approver1Id: row.approver1Id,
      approver2Id: row.approver2Id,
    };
  }

  private audit(
    companyId: string,
    actorId: string,
    actorEmail: string,
    proposalId: string,
    action: string,
  ): void {
    createAuditLog(this.prisma, {
      companyId,
      actorId,
      actorEmail,
      action,
      resourceType: 'ActionApproval',
      resourceId: proposalId,
      detail: `Double-approval action: ${action}`,
    }).catch((err) => console.error('[DoubleApprovalService] audit log failed:', err));
  }
}
