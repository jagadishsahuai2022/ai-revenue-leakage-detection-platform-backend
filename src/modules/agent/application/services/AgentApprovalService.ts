// ── AgentApprovalService ──────────────────────────────────────────────────────
// Human-in-the-loop: approve or reject a PROPOSED action proposal.
// Enforces tenant isolation, state-machine rules, and writes an audit log.

import { PrismaClient }              from '@prisma/client';
import { AppError }                  from '../../../../shared/errors/AppError';
import { createAuditLog }            from '../../../audit/audit.service';
import { AgentProposalRepository }   from '../../infrastructure/repositories/AgentProposalRepository';
import { ExecutionPolicy, UserRole } from '../../domain/policies/ExecutionPolicy';
import { ProposalStatus }            from '../../domain/enums/ProposalStatus';
import type { ProposalResponse }     from '../dto/agent.dto';

export class AgentApprovalService {
  private readonly repository: AgentProposalRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.repository = new AgentProposalRepository(prisma);
  }

  async approve(
    companyId:   string,
    proposalId:  string,
    approverId:  string,
    approverEmail: string,
    approverRole:  UserRole,
    notes?:      string,
  ): Promise<ProposalResponse> {
    const proposal = await this.repository.findById(proposalId, companyId);
    if (!proposal) {
      throw AppError.notFound(`Proposal not found: ${proposalId}`);
    }
    if (!proposal.canBeApproved()) {
      throw AppError.badRequest(
        `Cannot approve a proposal in status "${proposal.status}".`,
      );
    }

    // Policy check
    const violations = ExecutionPolicy.validateForApproval(
      {
        status:          proposal.status,
        confidenceScore: proposal.confidenceScore.toNumber(),
        estimatedImpact: proposal.estimatedImpact,
        actionType:      proposal.actionType,
        requiresApproval: proposal.requiresApproval,
      },
      approverRole,
    );
    if (violations.length > 0) {
      throw AppError.forbidden(violations.map((v) => v.reason).join('; '));
    }

    const updated = await this.repository.updateStatus(proposalId, companyId, {
      status:    ProposalStatus.APPROVED,
      approvedBy: approverId,
      approvedAt: new Date(),
    });

    // Fire-and-forget audit log
    createAuditLog(this.prisma, {
      companyId,
      actorId:      approverId,
      actorEmail:   approverEmail,
      action:       'AGENT_PROPOSAL_APPROVED',
      resourceType: 'AgentActionProposal',
      resourceId:   proposalId,
      detail:       notes ?? `Proposal ${proposalId} approved`,
      metadata:     { actionType: proposal.actionType, notes },
    }).catch((err) => console.error('[AgentApprovalService] audit log failed:', err));

    return updated;
  }

  async reject(
    companyId:    string,
    proposalId:   string,
    rejectorId:   string,
    rejectorEmail: string,
    reason:       string,
  ): Promise<ProposalResponse> {
    const proposal = await this.repository.findById(proposalId, companyId);
    if (!proposal) {
      throw AppError.notFound(`Proposal not found: ${proposalId}`);
    }
    if (!proposal.canBeRejected()) {
      throw AppError.badRequest(
        `Cannot reject a proposal in status "${proposal.status}".`,
      );
    }

    const updated = await this.repository.updateStatus(proposalId, companyId, {
      status: ProposalStatus.REJECTED,
    });

    createAuditLog(this.prisma, {
      companyId,
      actorId:      rejectorId,
      actorEmail:   rejectorEmail,
      action:       'AGENT_PROPOSAL_REJECTED',
      resourceType: 'AgentActionProposal',
      resourceId:   proposalId,
      detail:       reason,
      metadata:     { actionType: proposal.actionType, reason },
    }).catch((err) => console.error('[AgentApprovalService] audit log failed:', err));

    return updated;
  }
}
