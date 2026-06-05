import { z } from "zod";

export const CreateRevenueSchema = z.object({
  externalId: z.string().optional(),
  customerId: z.string().optional(),
  customerEmail: z.string().email().optional(),
  amount: z.number().positive(),
  currency: z.string().length(3).toUpperCase().default("USD"),
  mrr: z.number().nonnegative().optional(),
  arr: z.number().nonnegative().optional(),
  product: z.string().optional(),
  plan: z.string().optional(),
  period: z.string().datetime(),
  source: z.string().default("manual"),
  metadata: z.record(z.unknown()).default({}),
});

export const UpdateRevenueSchema = CreateRevenueSchema.partial().omit({
  externalId: true,
});

export const RevenueQuerySchema = z.object({
  page: z.coerce.number().positive().default(1),
  limit: z.coerce.number().positive().max(100).default(20),
  sortBy: z.enum(["period", "amount", "createdAt"]).default("period"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  search: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  source: z.string().optional(),
  currency: z.string().optional(),
});

export const CreateLeakageSchema = z.object({
  revenueId: z.string().optional(),
  category: z.enum([
    "CHURN",
    "DUNNING_FAILURE",
    "PRICING_GAP",
    "FAILED_UPSELL",
    "REFUND",
    "DISCOUNT_ABUSE",
    "INVOICE_ERROR",
  ]),
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  amount: z.number().positive(),
  currency: z.string().length(3).toUpperCase().default("USD"),
  riskScore: z.number().int().min(0).max(100).default(50),
  metadata: z.record(z.unknown()).default({}),
});

export const LeakageQuerySchema = z.object({
  page: z.coerce.number().positive().default(1),
  // max 5 000 so CSV export can request all records in a single call
  limit: z.coerce.number().positive().max(5000).default(20),
  // category: single value OR comma-separated list (e.g. "CHURN,REFUND")
  category: z.string().optional(),
  isResolved: z
    .string()
    .transform((v) => v === "true")
    .optional(),
  // Risk-score range
  minRiskScore: z.coerce.number().optional(),
  maxRiskScore: z.coerce.number().optional(),
  // Amount range
  minAmount: z.coerce.number().optional(),
  maxAmount: z.coerce.number().optional(),
  // Full-text search on title + description
  search: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  sortBy: z
    .enum(["detectedAt", "amount", "riskScore", "title"])
    .default("detectedAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export type CreateRevenueInput = z.infer<typeof CreateRevenueSchema>;
export type UpdateRevenueInput = z.infer<typeof UpdateRevenueSchema>;
export type CreateLeakageInput = z.infer<typeof CreateLeakageSchema>;
