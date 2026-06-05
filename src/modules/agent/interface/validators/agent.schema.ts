// ── Agent route validators ────────────────────────────────────────────────────
// Lightweight Zod schemas for validating incoming Fastify request bodies,
// query strings, and route params.  Mirrors the application DTOs but is
// intentionally kept separate so routing concerns don't leak into the domain.

import { z } from "zod";

export const PlanBodySchema = z
  .object({
    /**
     * UUID of an existing AIInsight row.
     * Provide this when planning from a specific insight detail view.
     */
    // CUIDs are used for insights, so accept any nonempty string rather than strict UUID
    insightId: z.string().min(1, "insightId must be provided").optional(),
    /**
     * Free-text scan description (used from the standalone agent dashboard).
     * When provided without insightId the backend automatically selects the
     * most recent AIInsight for the company.
     */
    context: z
      .string()
      .min(5, "context must be at least 5 characters")
      .max(500)
      .optional(),
    modelId: z.string().min(3).max(120).optional(),
  })
  .refine((d) => d.insightId !== undefined || d.context !== undefined, {
    message:
      "Provide either insightId (UUID of an existing insight) or context (free-text scan description)",
  });

export const ListQuerySchema = z.object({
  status: z.string().optional(),
  insightId: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const ProposalIdParamSchema = z.object({
  id: z.string().uuid("id must be a valid UUID"),
});

export const ApproveBodySchema = z.object({
  notes: z.string().max(1000).optional(),
});

export const RejectBodySchema = z.object({
  reason: z.string().min(1, "reason is required").max(1000),
});
