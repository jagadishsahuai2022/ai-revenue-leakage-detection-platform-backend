// ── AIExplanationService ───────────────────────────────────────────────────────
// Generates structured, human-readable explanations for AI recommendations.
// Each explanation includes:
//   • Reasoning chain — why this recommendation was generated
//   • Supporting data points — metrics and evidence
//   • Confidence rationale — why the model is (un)certain
//   • Impact methodology — how the dollar impact was calculated
//
// Explanations are stored as TEXT on AIRecommendation.explanation and can
// optionally be enriched by an LLM via the ModelRouter.

import { PrismaClient } from "@prisma/client";

export interface ExplanationContext {
  companyId: string;
  insightId: string;
  recommendationType: string;
  confidence: number;
  impactScore: number;
  insightSeverity: string;
  insightTitle: string;
  insightSummary: string | null;
  insightData: Record<string, unknown>;
}

export interface StructuredExplanation {
  reasoning: string;
  dataPoints: string[];
  confidenceRationale: string;
  impactMethodology: string;
  fullText: string;
}

// ── Recommendation type → action mapping ────────────────────────────────────

const RECOMMENDATION_ACTIONS: Record<string, string> = {
  RETRY_PAYMENT:
    "Retry the failed payment with an updated payment method or through an alternate gateway.",
  PRICING_ADJUSTMENT:
    "Review and adjust the pricing tier to match the contracted or intended rate.",
  CHURN_INTERVENTION:
    "Initiate a proactive retention outreach — discount offer, success call, or feature demo.",
  INVOICE_CORRECTION:
    "Reissue the invoice with the correct amount and send to the billing contact.",
  DUNNING_ESCALATION:
    "Escalate through the dunning sequence — send final notice and flag for manual review.",
  CARD_UPDATE_REQUEST:
    "Send an automated card update request to the customer via email and in-app notification.",
  REFUND_REVIEW:
    "Review the refund request against the refund policy and approve or reject.",
  WIN_BACK_CAMPAIGN:
    "Enrol the churned customer in the win-back campaign with a targeted re-engagement offer.",
  USAGE_AUDIT:
    "Audit product usage metrics to validate that the customer is on the optimal plan.",
  DISCOUNT_REVIEW:
    "Review active discounts for policy compliance and sunset any expired promotions.",
};

// ── Service class ───────────────────────────────────────────────────────────

export class AIExplanationService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Generate a structured explanation for a recommendation and persist it.
   * Returns the explanation text.
   */
  async generateAndPersist(
    recommendationId: string,
    ctx: ExplanationContext,
  ): Promise<StructuredExplanation> {
    const explanation = this.generate(ctx);

    await this.prisma.aIRecommendation.update({
      where: { id: recommendationId },
      data: { explanation: explanation.fullText },
    });

    return explanation;
  }

  /**
   * Pure function: build the structured explanation from context.
   * No side effects — useful for previews and tests.
   */
  generate(ctx: ExplanationContext): StructuredExplanation {
    const reasoning = this.buildReasoning(ctx);
    const dataPoints = this.extractDataPoints(ctx);
    const confidenceRationale = this.buildConfidenceRationale(ctx);
    const impactMethodology = this.buildImpactMethodology(ctx);

    const fullText = [
      "## Recommendation Explanation",
      "",
      "### Reasoning",
      reasoning,
      "",
      "### Supporting Data Points",
      ...dataPoints.map((dp) => `- ${dp}`),
      "",
      "### Confidence Assessment",
      confidenceRationale,
      "",
      "### Impact Calculation",
      impactMethodology,
    ].join("\n");

    return {
      reasoning,
      dataPoints,
      confidenceRationale,
      impactMethodology,
      fullText,
    };
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private buildReasoning(ctx: ExplanationContext): string {
    const action =
      RECOMMENDATION_ACTIONS[ctx.recommendationType] ??
      `Take corrective action for the identified ${ctx.recommendationType.replace(/_/g, " ").toLowerCase()} issue.`;

    const severityLabel = ctx.insightSeverity.toLowerCase();
    const typeLabel = ctx.recommendationType.replace(/_/g, " ").toLowerCase();

    return (
      `A ${severityLabel}-severity insight ("${ctx.insightTitle}") was detected ` +
      `during revenue intelligence analysis. The analysis identified a ${typeLabel} ` +
      `pattern that requires attention. ` +
      `Recommended action: ${action}`
    );
  }

  private extractDataPoints(ctx: ExplanationContext): string[] {
    const points: string[] = [];
    const d = ctx.insightData;

    if (d.totalRevenue != null)
      points.push(
        `Total revenue in analysis window: $${Number(d.totalRevenue).toLocaleString("en-US")}`,
      );
    if (d.leakageAmount != null)
      points.push(
        `Estimated leakage amount: $${Number(d.leakageAmount).toLocaleString("en-US")}`,
      );
    if (d.affectedAccounts != null)
      points.push(`Affected accounts: ${d.affectedAccounts}`);
    if (d.dropPercent != null) points.push(`Revenue drop: ${d.dropPercent}%`);
    if (d.dipPercent != null) points.push(`Revenue dip: ${d.dipPercent}%`);
    if (d.failedPayments != null)
      points.push(`Failed payments: ${d.failedPayments}`);
    if (d.failedRetries != null)
      points.push(`Failed payment retries: ${d.failedRetries}`);
    if (d.churnRate != null)
      points.push(`Churn rate: ${(Number(d.churnRate) * 100).toFixed(1)}%`);
    if (d.overdueInvoices != null)
      points.push(`Overdue invoices: ${d.overdueInvoices}`);
    if (d.avgDaysOverdue != null)
      points.push(`Average days overdue: ${d.avgDaysOverdue}`);
    if (d.customerIds != null)
      points.push(
        `Customer IDs involved: ${(d.customerIds as string[]).join(", ")}`,
      );

    if (points.length === 0) {
      points.push(`Insight severity: ${ctx.insightSeverity}`);
      points.push(`Risk score: ${Math.round(ctx.impactScore)}`);
    }

    return points;
  }

  private buildConfidenceRationale(ctx: ExplanationContext): string {
    const pct = Math.round(ctx.confidence * 100);

    if (ctx.confidence >= 0.85) {
      return (
        `Confidence: ${pct}% (HIGH). The model has strong statistical evidence ` +
        `supporting this recommendation. Multiple corroborating signals were detected ` +
        `within the analysis window.`
      );
    }
    if (ctx.confidence >= 0.6) {
      return (
        `Confidence: ${pct}% (MODERATE). The model detected a clear signal but ` +
        `some contributing factors are uncertain. Manual review is recommended before ` +
        `taking automated action.`
      );
    }
    return (
      `Confidence: ${pct}% (LOW). The model detected a potential issue but the ` +
      `signal is weak or the data is sparse. This recommendation should be treated as ` +
      `a suggestion for investigation rather than a definitive action.`
    );
  }

  private buildImpactMethodology(ctx: ExplanationContext): string {
    const impact = ctx.impactScore;
    const d = ctx.insightData;

    const estimatedLeakage =
      d.leakageAmount != null ? Number(d.leakageAmount) : impact;

    const recoveryRate =
      ctx.confidence >= 0.85
        ? "70-90%"
        : ctx.confidence >= 0.6
          ? "40-60%"
          : "20-40%";

    return (
      `Estimated impact: $${estimatedLeakage.toLocaleString("en-US")}. ` +
      `This figure represents the potential revenue at risk if no action is taken. ` +
      `Based on the ${Math.round(ctx.confidence * 100)}% confidence level, ` +
      `the expected recovery rate if the recommendation is implemented is ${recoveryRate}. ` +
      `Impact was calculated by aggregating the affected revenue streams within the ` +
      `analysis window and applying the severity-weighted risk model.`
    );
  }
}
