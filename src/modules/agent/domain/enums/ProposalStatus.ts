// ── ProposalStatus ────────────────────────────────────────────────────────────
// State machine for AgentActionProposal lifecycle.
//
//  PROPOSED ──► APPROVED ──► EXECUTED
//           │               └──► FAILED
//           └──► REJECTED
//           └──► CANCELLED   (by system / timeout)

export enum ProposalStatus {
  PROPOSED  = 'PROPOSED',
  APPROVED  = 'APPROVED',
  REJECTED  = 'REJECTED',
  EXECUTED  = 'EXECUTED',
  FAILED    = 'FAILED',
  CANCELLED = 'CANCELLED',
}

/** Valid next states for each status */
const ALLOWED_TRANSITIONS: Record<ProposalStatus, ProposalStatus[]> = {
  [ProposalStatus.PROPOSED]:  [ProposalStatus.APPROVED, ProposalStatus.REJECTED, ProposalStatus.CANCELLED],
  [ProposalStatus.APPROVED]:  [ProposalStatus.EXECUTED, ProposalStatus.FAILED, ProposalStatus.CANCELLED],
  [ProposalStatus.REJECTED]:  [],
  [ProposalStatus.EXECUTED]:  [],
  [ProposalStatus.FAILED]:    [],
  [ProposalStatus.CANCELLED]: [],
};

export function isTerminalStatus(status: ProposalStatus): boolean {
  return ALLOWED_TRANSITIONS[status].length === 0;
}

export function canTransitionTo(from: ProposalStatus, to: ProposalStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}
