// ── ActionProposal domain entity ───────────────────────────────────────────────
// Rich domain model — does NOT depend on Prisma types.

import { ActionType }       from '../enums/ActionType';
import { ProposalStatus, canTransitionTo } from '../enums/ProposalStatus';
import { ConfidenceScore }  from '../value-objects/ConfidenceScore';

export interface ActionProposalProps {
  id:               string;
  companyId:        string;
  insightId:        string;
  actionType:       ActionType;
  priorityScore:    number;
  confidenceScore:  ConfidenceScore;
  estimatedImpact:  number;
  payload:          Record<string, unknown>;
  rationale:        string | null;
  status:           ProposalStatus;
  requiresApproval: boolean;
  approvedBy:       string | null;
  approvedAt:       Date   | null;
  executedAt:       Date   | null;
  createdAt:        Date;
  updatedAt:        Date;
}

export class ActionProposal {
  constructor(private readonly props: ActionProposalProps) {}

  get id():               string          { return this.props.id; }
  get companyId():        string          { return this.props.companyId; }
  get insightId():        string          { return this.props.insightId; }
  get actionType():       ActionType      { return this.props.actionType; }
  get priorityScore():    number          { return this.props.priorityScore; }
  get confidenceScore():  ConfidenceScore { return this.props.confidenceScore; }
  get estimatedImpact():  number          { return this.props.estimatedImpact; }
  get payload():          Record<string, unknown> { return this.props.payload; }
  get rationale():        string | null   { return this.props.rationale; }
  get status():           ProposalStatus  { return this.props.status; }
  get requiresApproval(): boolean         { return this.props.requiresApproval; }
  get approvedBy():       string | null   { return this.props.approvedBy; }
  get approvedAt():       Date   | null   { return this.props.approvedAt; }
  get executedAt():       Date   | null   { return this.props.executedAt; }
  get createdAt():        Date            { return this.props.createdAt; }
  get updatedAt():        Date            { return this.props.updatedAt; }

  canBeApproved(): boolean {
    return canTransitionTo(this.props.status, ProposalStatus.APPROVED);
  }

  canBeRejected(): boolean {
    return canTransitionTo(this.props.status, ProposalStatus.REJECTED);
  }

  canBeExecuted(): boolean {
    return (
      this.props.status === ProposalStatus.APPROVED &&
      this.props.confidenceScore.isSufficient()
    );
  }

  toPlain(): ActionProposalProps {
    return { ...this.props };
  }
}
