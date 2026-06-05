// ─────────────────────────────────────────────────────────────────────────────
// Agent Feature Guard (Kill Switch)
//
// Checks the AI_AGENT_ENABLED feature flag for a company.
// When disabled:
//   • Planner returns empty proposals (no planning).
//   • Execution endpoint returns HTTP 403 (no execution).
//
// Uses the existing FeatureFlag table — zero new infrastructure.
// ─────────────────────────────────────────────────────────────────────────────

import { PrismaClient } from "@prisma/client";

/** Default state when no per-company flag exists. */
const DEFAULT_ENABLED = true;

export class AgentFeatureGuard {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Returns true if the AI Agent system is enabled for the given company.
   * Checks FeatureFlag table for `AI_AGENT_ENABLED`.
   * Falls back to `DEFAULT_ENABLED` when no row exists.
   */
  async isAgentEnabled(companyId: string): Promise<boolean> {
    const flag = await this.prisma.featureFlag.findUnique({
      where: { companyId_feature: { companyId, feature: "AI_AGENT_ENABLED" } },
      select: { enabled: true },
    });

    return flag?.enabled ?? DEFAULT_ENABLED;
  }

  /**
   * Throws AppError.forbidden when the agent is disabled.
   * Designed for use in execution endpoints.
   */
  async assertAgentEnabled(companyId: string): Promise<void> {
    const enabled = await this.isAgentEnabled(companyId);
    if (!enabled) {
      // Import lazily to avoid circular deps in domain layer
      const { AppError } = await import("../../../../shared/errors/AppError");
      throw AppError.forbidden(
        "AI Agent is disabled for this company. Enable the AI_AGENT_ENABLED feature flag to proceed.",
      );
    }
  }
}
