import { z } from 'zod';

// ── POST /ai/run ─────────────────────────────────────────────────────────────
const MODEL_ID_REGEX = /^[a-zA-Z0-9_:.-]+\/[a-zA-Z0-9_:./+-]+$/;

export const RunAnalysisBodySchema = z.object({
  /** Days to look back for revenue data (1–365, default 30) */
  lookbackDays: z.coerce.number().int().min(1).max(365).default(30),
  /** Override z-score threshold (1.5–4.0, default 2.5) */
  zScoreThreshold: z.coerce.number().min(1.5).max(4).optional(),
  /** Whether to call the LLM to enrich the insight (default false) */
  enrichWithLLM: z.boolean().default(false),
  /**
   * AI model to use for enrichment, e.g. "groq/llama-3.1-8b-instant".
   * Falls back to AI_DEFAULT_MODEL env var when omitted.
   */
  model: z.string().regex(MODEL_ID_REGEX, 'model must be in "provider/model" format').optional(),
});

export type RunAnalysisBody = z.infer<typeof RunAnalysisBodySchema>;

// ── GET /ai/insights ─────────────────────────────────────────────────────────
export const ListInsightsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  unreadOnly: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
});

export type ListInsightsQuery = z.infer<typeof ListInsightsQuerySchema>;

// ── GET /ai/usage ─────────────────────────────────────────────────────────────
export const UsageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  from: z.string().optional(),
  to: z.string().optional(),
});

export type UsageQuery = z.infer<typeof UsageQuerySchema>;
