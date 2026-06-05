// ─────────────────────────────────────────────────────────────────────────────
// AI Policy Engine
//
// Evaluates every AI-agent action proposal against configurable rules and
// returns one of three verdicts:
//
//   ALLOW           — action can execute immediately (auto-approve)
//   REQUIRE_APPROVAL — action needs human sign-off (single or double)
//   DENY            — action is blocked outright
//
// Rules are evaluated top-down; the MOST restrictive verdict wins.
// Supports per-company policy overrides via the FeatureFlag model.
// ─────────────────────────────────────────────────────────────────────────────

import { PrismaClient } from "@prisma/client";

// ── Verdict type ────────────────────────────────────────────────────────────

export type PolicyVerdict = "ALLOW" | "REQUIRE_APPROVAL" | "DENY";

export interface PolicyEvaluationResult {
  verdict: PolicyVerdict;
  reasons: string[];
  requireDoubleApproval: boolean;
}

// ── Rule definitions ────────────────────────────────────────────────────────

export interface PolicyRule {
  /** Unique name for logging/audit */
  name: string;
  /** Predicate — return true if this rule applies */
  matches: (ctx: PolicyContext) => boolean;
  /** Verdict to apply when the rule matches */
  verdict: PolicyVerdict;
  /** Require double-approval for this rule? */
  requireDoubleApproval?: boolean;
}

export interface PolicyContext {
  actionType: string;
  estimatedImpact: number;
  confidenceScore: number;
  companyId: string;
  companyPlan: string;
  /** Feature flags map: key → enabled */
  featureFlags: Record<string, boolean>;
}

// ── Built-in rules ──────────────────────────────────────────────────────────

const HIGH_RISK_ACTIONS = new Set([
  "DISABLE_SUBSCRIPTION",
  "NOTIFY_FINANCE_TEAM",
  "REFUND_PAYMENT",
  "UPDATE_SUBSCRIPTION",
]);

const FINANCIAL_ACTIONS = new Set([
  "RETRY_PAYMENT",
  "GENERATE_INVOICE",
  "SEND_COLLECTION_EMAIL",
  "REFUND_PAYMENT",
  "FIX_INVOICE",
  "UPDATE_SUBSCRIPTION",
]);

const BUILT_IN_RULES: PolicyRule[] = [
  // R1: Block all agent actions if the company has disabled AI agent feature
  {
    name: "FEATURE_GATE_AI_AGENT",
    matches: (ctx) => ctx.featureFlags["AI_AGENT"] === false,
    verdict: "DENY",
  },

  // R2: Deny proposals with extremely low confidence
  {
    name: "LOW_CONFIDENCE_BLOCK",
    matches: (ctx) => ctx.confidenceScore < 0.3,
    verdict: "DENY",
  },

  // R3: Deny actions with zero estimated impact
  {
    name: "ZERO_IMPACT_BLOCK",
    matches: (ctx) => ctx.estimatedImpact <= 0,
    verdict: "DENY",
  },

  // R4: High-risk actions always need double approval
  {
    name: "HIGH_RISK_DOUBLE_APPROVAL",
    matches: (ctx) => HIGH_RISK_ACTIONS.has(ctx.actionType),
    verdict: "REQUIRE_APPROVAL",
    requireDoubleApproval: true,
  },

  // R5: Financial actions above $5000 need double approval
  {
    name: "HIGH_VALUE_FINANCIAL_DOUBLE_APPROVAL",
    matches: (ctx) =>
      FINANCIAL_ACTIONS.has(ctx.actionType) && ctx.estimatedImpact > 5000,
    verdict: "REQUIRE_APPROVAL",
    requireDoubleApproval: true,
  },

  // R6: Financial actions need at least single approval
  {
    name: "FINANCIAL_ACTION_APPROVAL",
    matches: (ctx) => FINANCIAL_ACTIONS.has(ctx.actionType),
    verdict: "REQUIRE_APPROVAL",
    requireDoubleApproval: false,
  },

  // R7: Low confidence (< 0.6) needs approval
  {
    name: "LOW_CONFIDENCE_APPROVAL",
    matches: (ctx) => ctx.confidenceScore < 0.6,
    verdict: "REQUIRE_APPROVAL",
    requireDoubleApproval: false,
  },

  // R8: Starter plans can't auto-execute — everything needs approval
  {
    name: "STARTER_PLAN_APPROVAL",
    matches: (ctx) => ctx.companyPlan === "STARTER",
    verdict: "REQUIRE_APPROVAL",
    requireDoubleApproval: false,
  },
];

// ── Verdict priority ────────────────────────────────────────────────────────

const VERDICT_PRIORITY: Record<PolicyVerdict, number> = {
  DENY: 3,
  REQUIRE_APPROVAL: 2,
  ALLOW: 1,
};

// ── Engine ──────────────────────────────────────────────────────────────────

export class AIPolicyEngine {
  private rules: PolicyRule[];

  constructor(additionalRules: PolicyRule[] = []) {
    // Built-in rules first, then tenant/custom rules
    this.rules = [...BUILT_IN_RULES, ...additionalRules];
  }

  /**
   * Evaluate all rules against the given context.
   * The most restrictive verdict wins (DENY > REQUIRE_APPROVAL > ALLOW).
   */
  evaluate(ctx: PolicyContext): PolicyEvaluationResult {
    let finalVerdict: PolicyVerdict = "ALLOW";
    let requireDoubleApproval = false;
    const reasons: string[] = [];

    for (const rule of this.rules) {
      if (rule.matches(ctx)) {
        const priority = VERDICT_PRIORITY[rule.verdict];
        const currentPriority = VERDICT_PRIORITY[finalVerdict];

        if (priority > currentPriority) {
          finalVerdict = rule.verdict;
        }

        if (rule.requireDoubleApproval) {
          requireDoubleApproval = true;
        }

        reasons.push(`${rule.name}: ${rule.verdict}`);
      }
    }

    return { verdict: finalVerdict, reasons, requireDoubleApproval };
  }

  /**
   * Build a PolicyContext by fetching company plan + feature flags from DB.
   */
  static async buildContext(
    prisma: PrismaClient,
    params: {
      companyId: string;
      actionType: string;
      estimatedImpact: number;
      confidenceScore: number;
    },
  ): Promise<PolicyContext> {
    // Fetch company plan
    const company = await prisma.company.findUnique({
      where: { id: params.companyId },
      select: { plan: true },
    });

    // Fetch feature flags
    const flags = await prisma.featureFlag.findMany({
      where: { companyId: params.companyId },
      select: { feature: true, enabled: true },
    });

    const featureFlags: Record<string, boolean> = {};
    for (const f of flags) {
      featureFlags[f.feature] = f.enabled;
    }

    return {
      actionType: params.actionType,
      estimatedImpact: params.estimatedImpact,
      confidenceScore: params.confidenceScore,
      companyId: params.companyId,
      companyPlan: company?.plan ?? "STARTER",
      featureFlags,
    };
  }
}
