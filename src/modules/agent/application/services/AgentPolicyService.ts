// ─────────────────────────────────────────────────────────────────────────────
// Agent Policy Service
//
// Loads per-company policy configuration from the AgentPolicyConfig table and
// evaluates action proposals against configured thresholds.
//
// Policy verdicts:
//   ALLOW                — action can auto-execute
//   REQUIRE_APPROVAL     — action needs single human approval
//   REQUIRE_DOUBLE_APPROVAL — financial action needs two approvers
//   DENY                 — action is blocked
// ─────────────────────────────────────────────────────────────────────────────

import { PrismaClient } from "@prisma/client";
import { FINANCIAL_ACTION_TYPES } from "../../domain/enums/ActionType";

export type PolicyVerdict =
  | "ALLOW"
  | "REQUIRE_APPROVAL"
  | "REQUIRE_DOUBLE_APPROVAL"
  | "DENY";

export interface PolicyEvaluation {
  verdict: PolicyVerdict;
  reasons: string[];
}

export interface AgentPolicy {
  refundThreshold: number;
  autoExecuteImpactLimit: number;
  confidenceThreshold: number;
}

const DEFAULT_POLICY: AgentPolicy = {
  refundThreshold: 500,
  autoExecuteImpactLimit: 200,
  confidenceThreshold: 0.7,
};

export class AgentPolicyService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Load the policy configuration for a company.
   * Returns defaults if no custom config exists.
   */
  async loadPolicy(companyId: string): Promise<AgentPolicy> {
    const config = await this.prisma.agentPolicyConfig.findUnique({
      where: { companyId },
    });

    if (!config) return { ...DEFAULT_POLICY };

    return {
      refundThreshold: config.refundThreshold,
      autoExecuteImpactLimit: config.autoExecuteImpactLimit,
      confidenceThreshold: config.confidenceThreshold,
    };
  }

  /**
   * Evaluate an action proposal against the company's policy.
   */
  async evaluate(
    companyId: string,
    params: {
      actionType: string;
      estimatedImpact: number;
      confidenceScore: number;
    },
  ): Promise<PolicyEvaluation> {
    const policy = await this.loadPolicy(companyId);
    const reasons: string[] = [];
    let verdict: PolicyVerdict = "ALLOW";

    const isFinancial = FINANCIAL_ACTION_TYPES.has(params.actionType as any);

    // Rule 1: Confidence below threshold → DENY
    if (params.confidenceScore < 0.3) {
      reasons.push(
        `Confidence ${params.confidenceScore.toFixed(2)} is critically low (< 0.3)`,
      );
      return { verdict: "DENY", reasons };
    }

    // Rule 2: Confidence below configured threshold → REQUIRE_APPROVAL
    if (params.confidenceScore < policy.confidenceThreshold) {
      reasons.push(
        `Confidence ${params.confidenceScore.toFixed(2)} below threshold ${policy.confidenceThreshold}`,
      );
      verdict = "REQUIRE_APPROVAL";
    }

    // Rule 3: Financial action above refund threshold → REQUIRE_DOUBLE_APPROVAL
    if (isFinancial && params.estimatedImpact > policy.refundThreshold) {
      reasons.push(
        `Financial action impact $${params.estimatedImpact} exceeds refund threshold $${policy.refundThreshold}`,
      );
      return { verdict: "REQUIRE_DOUBLE_APPROVAL", reasons };
    }

    // Rule 4: Financial action → always at least REQUIRE_APPROVAL
    if (isFinancial) {
      reasons.push(
        `Financial action type ${params.actionType} requires approval`,
      );
      if (verdict === "ALLOW") verdict = "REQUIRE_APPROVAL";
    }

    // Rule 5: Impact above auto-execute limit → REQUIRE_APPROVAL
    if (params.estimatedImpact > policy.autoExecuteImpactLimit) {
      reasons.push(
        `Impact $${params.estimatedImpact} exceeds auto-execute limit $${policy.autoExecuteImpactLimit}`,
      );
      if (verdict === "ALLOW") verdict = "REQUIRE_APPROVAL";
    }

    if (reasons.length === 0) {
      reasons.push("All policy checks passed");
    }

    return { verdict, reasons };
  }

  /**
   * Upsert the policy configuration for a company.
   */
  async upsertPolicy(
    companyId: string,
    input: Partial<AgentPolicy>,
  ): Promise<AgentPolicy> {
    const existing = await this.loadPolicy(companyId);
    const merged = {
      refundThreshold: input.refundThreshold ?? existing.refundThreshold,
      autoExecuteImpactLimit:
        input.autoExecuteImpactLimit ?? existing.autoExecuteImpactLimit,
      confidenceThreshold:
        input.confidenceThreshold ?? existing.confidenceThreshold,
    };

    await this.prisma.agentPolicyConfig.upsert({
      where: { companyId },
      create: {
        companyId,
        ...merged,
      },
      update: merged,
    });

    return merged;
  }
}
