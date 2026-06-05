// ── Agent application DTOs ────────────────────────────────────────────────────
// Zod schemas for request/response shapes flowing through the application layer.
// These are NOT Prisma types — they represent the API contract.

import { z } from "zod";

// ── Request DTOs ──────────────────────────────────────────────────────────────

export const PlanForInsightRequestSchema = z
  .object({
    /** ID of an existing AIInsight row. CUID or UUID accepted. */
    insightId: z.string().min(1).optional(),
    /**
     * Free-text scan context (standalone agent page flow).
     * When supplied without insightId the service resolves the most recent
     * AIInsight for the company automatically.
     */
    context: z.string().min(5).max(500).optional(),
    /** Optional preferred modelId, e.g. "groq/llama-3.1-8b-instant" */
    modelId: z.string().min(1).max(120).optional(),
  })
  .refine((d) => d.insightId !== undefined || d.context !== undefined, {
    message: "Provide either insightId or context",
  });
export type PlanForInsightRequest = z.infer<typeof PlanForInsightRequestSchema>;

export const ListProposalsQuerySchema = z.object({
  status: z.string().optional(),
  insightId: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListProposalsQuery = z.infer<typeof ListProposalsQuerySchema>;

export const ApproveProposalRequestSchema = z.object({
  notes: z.string().max(1000).optional(),
});
export type ApproveProposalRequest = z.infer<
  typeof ApproveProposalRequestSchema
>;

export const RejectProposalRequestSchema = z.object({
  reason: z.string().min(1).max(1000),
});
export type RejectProposalRequest = z.infer<typeof RejectProposalRequestSchema>;

// ── Response DTOs ─────────────────────────────────────────────────────────────

export interface ProposalResponse {
  id: string;
  companyId: string;
  insightId: string;
  actionType: string;
  priorityScore: number;
  confidenceScore: number;
  estimatedImpact: number;
  impactScore: number;
  riskScore: number;
  payload: Record<string, unknown>;
  rationale: string | null;
  status: string;
  requiresApproval: boolean;
  approvedBy: string | null;
  approvedAt: string | null;
  executedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExecutionLogResponse {
  id: string;
  companyId: string;
  proposalId: string;
  executionType: string;
  payload: unknown;
  result: unknown;
  status: string;
  errorMessage: string | null;
  durationMs: number | null;
  createdAt: string;
}

export interface PlanResult {
  insightId: string;
  proposals: ProposalResponse[];
  totalCreated: number;
  /** Count of previously-existing PROPOSED proposals for this insight.
   *  Lets the frontend distinguish "nothing new because duplicates exist"
   *  from "AI returned no proposals at all". */
  existingCount: number;
}
