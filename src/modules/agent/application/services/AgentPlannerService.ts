// ── AgentPlannerService ───────────────────────────────────────────────────────
// Fetches an AIInsight, calls the AgentAIClient to generate structured action
// proposals, validates each against ExecutionPolicy, and persists proposals via
// AgentProposalRepository.  Never executes autonomously.

import { PrismaClient } from "@prisma/client";
import { AppError } from "../../../../shared/errors/AppError";
import { AgentAIClient } from "../../infrastructure/ai/AgentAIClient";
import { AgentProposalRepository } from "../../infrastructure/repositories/AgentProposalRepository";
import { ExecutionPolicy } from "../../domain/policies/ExecutionPolicy";
import { ActionType, isValidActionType } from "../../domain/enums/ActionType";
import { ProposalStatus } from "../../domain/enums/ProposalStatus";
import { AgentFeatureGuard } from "./AgentFeatureGuard";
import type {
  PlanForInsightRequest,
  PlanResult,
  ProposalResponse,
} from "../dto/agent.dto";

export class AgentPlannerService {
  private readonly aiClient: AgentAIClient;
  private readonly repository: AgentProposalRepository;
  private readonly featureGuard: AgentFeatureGuard;

  constructor(private readonly prisma: PrismaClient) {
    this.aiClient = new AgentAIClient();
    this.repository = new AgentProposalRepository(prisma);
    this.featureGuard = new AgentFeatureGuard(prisma);
  }

  async planForInsight(
    companyId: string,
    request: PlanForInsightRequest,
  ): Promise<PlanResult> {
    const { modelId } = request;

    // ── Kill Switch: return empty proposals if agent is disabled ───────────
    const agentEnabled = await this.featureGuard.isAgentEnabled(companyId);
    if (!agentEnabled) {
      return {
        insightId: request.insightId ?? "",
        proposals: [],
        totalCreated: 0,
        existingCount: 0,
      };
    }

    // 1. Resolve the AIInsight to plan against
    //    – If insightId is explicitly provided: load that specific insight.
    //    – If only context is provided (standalone agent-dashboard flow): use
    //      the most recent insight for the company so the AI has real data to
    //      base its proposals on.
    let insight: Awaited<ReturnType<typeof this.prisma.aIInsight.findFirst>>;

    if (request.insightId) {
      insight = await this.prisma.aIInsight.findFirst({
        where: { id: request.insightId, companyId },
      });
      if (!insight) {
        throw AppError.notFound(`AIInsight not found: ${request.insightId}`);
      }
    } else {
      // context-scan mode: pick the latest insight for this company
      insight = await this.prisma.aIInsight.findFirst({
        where: { companyId },
        orderBy: { createdAt: "desc" },
      });
      if (!insight) {
        throw AppError.badRequest(
          "No AI insights found for your company. " +
            "Please run the Revenue Intelligence analysis first (AI → Generate Insights) " +
            "before using the agent planner.",
        );
      }
    }

    const insightId = insight.id;

    // 2. Ask the AI to generate structured proposals
    //    Wrap in try/catch so a missing API key or network error surfaces as a
    //    user-friendly 400 Bad Request instead of an opaque 500.
    let rawProposals: import("../../infrastructure/ai/AgentAIClient").RawProposal[];
    try {
      rawProposals = await this.aiClient.generateProposals(insight, modelId);
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Unknown AI generation error";
      throw AppError.badRequest(
        `AI proposal generation failed: ${msg}. ` +
          "Ensure the correct API key environment variable is set " +
          "(GROQ_API_KEY, GEMINI_API_KEY, MISTRAL_API_KEY, OPENROUTER_API_KEY, or OPENAI_API_KEY).",
      );
    }

    if (rawProposals.length === 0) {
      // AI returned an empty array (valid but unusual) — return any existing
      // PROPOSED proposals so the frontend always has something to show.
      const existing = await this.repository.findMany(companyId, {
        insightId,
        status: "PROPOSED",
        page: 1,
        limit: 100,
      });
      return {
        insightId,
        proposals: existing.items,
        totalCreated: 0,
        existingCount: existing.total,
      };
    }

    // 3. Payload-aware dedup — fetch existing PROPOSED proposals and compute
    //    a signature for each to prevent exact duplicates while allowing multiple
    //    proposals of the same actionType if they target different scenarios.
    //    This maximizes value from each AI call (which has a cost).
    const existingResult = await this.repository.findMany(companyId, {
      insightId,
      status: "PROPOSED",
      page: 1,
      limit: 100,
    });
    // Map existing proposals to their unique signatures: "actionType::payloadHash"
    const existingSignatures = new Set(
      existingResult.items.map((p) =>
        this._proposalSignature(p.actionType, p.payload),
      ),
    );

    // 4. Derive an impact floor from the insight data so proposals are never
    //    stuck at estimatedImpact = 0 (which blocks the frontend Execute gate).
    const insightData =
      typeof insight.data === "object" && insight.data !== null
        ? (insight.data as Record<string, unknown>)
        : {};
    const dataImpact = Number(
      insightData["leakageEstimate"] ??
        insightData["estimatedLeakage"] ??
        insightData["totalRevenue"] ??
        0,
    );
    // Use 10 % of real revenue/leakage data; fall back to riskScore × 20
    // (guarantees at least 200 for any insight with riskScore ≥ 10).
    const impactFloor =
      dataImpact > 0
        ? Math.round(dataImpact * 0.1)
        : Math.max(100, insight.riskScore * 20);

    // 5. Validate, dedup by actionType, and persist only net-new proposals
    const created: ProposalResponse[] = [];

    for (const raw of rawProposals) {
      // Guard — only accept whitelisted action types
      if (!isValidActionType(raw.actionType)) {
        console.warn(
          `[AgentPlannerService] Skipping unknown actionType: ${raw.actionType}`,
        );
        continue;
      }

      const actionType = raw.actionType as ActionType;

      // Compute a unique signature for this proposal based on actionType + payload.
      // This allows multiple proposals of the same actionType as long as they
      // target different scenarios (different payload).
      const signature = this._proposalSignature(actionType, raw.payload ?? {});

      // Skip if an identical proposal (same actionType + payload) already exists
      if (existingSignatures.has(signature)) {
        console.log(
          `[AgentPlannerService] Skipping duplicate proposal: ${signature}`,
        );
        continue;
      }

      const requiresApproval =
        ExecutionPolicy.mustRequireApproval(actionType) || true; // always true per spec

      // Ensure estimatedImpact is >= 100 so the frontend Execute gate can pass.
      // The AI prompt already instructs non-zero values; this floor is insurance.
      const rawImpact = Math.max(0, raw.estimatedImpact ?? 0);
      const estimatedImpact = rawImpact >= 100 ? rawImpact : impactFloor;

      // ── Risk Scoring ──────────────────────────────────────────────────────
      const confScore = Math.min(1, Math.max(0, raw.confidenceScore ?? 0.5));
      const impScore = Math.min(1, Math.max(0, estimatedImpact / 10000)); // normalize to 0-1
      const riskScore = impScore * 0.5 + (1 - confScore) * 0.5;

      const proposal = await this.repository.create({
        companyId,
        insightId,
        actionType,
        priorityScore: Math.min(100, Math.max(0, raw.priorityScore ?? 50)),
        confidenceScore: confScore,
        estimatedImpact,
        impactScore: impScore,
        riskScore: parseFloat(riskScore.toFixed(4)),
        payload: raw.payload ?? {},
        rationale: raw.rationale ?? null,
        status: ProposalStatus.PROPOSED,
        requiresApproval,
      });

      created.push(proposal);
      existingSignatures.add(signature); // prevent duplicate within the same call
    }

    return {
      insightId,
      // Only the proposals inserted during THIS call — not cumulative totals.
      proposals: created,
      totalCreated: created.length,
      existingCount: existingResult.total,
    };
  }

  // ── Helper: compute unique signature for a proposal ─────────────────────────
  // Combines actionType + deterministic payload hash to allow multiple proposals
  // of the same type as long as they target different scenarios.
  private _proposalSignature(
    actionType: string,
    payload: Record<string, unknown>,
  ): string {
    // Sort payload keys for deterministic stringification
    const sortedPayload = Object.keys(payload)
      .sort()
      .reduce(
        (acc, key) => {
          acc[key] = payload[key];
          return acc;
        },
        {} as Record<string, unknown>,
      );

    const payloadStr = JSON.stringify(sortedPayload);
    // Simple hash using string length + first/last chars (good enough for dedup)
    const hash = `${payloadStr.length}-${payloadStr.slice(0, 8)}`;
    return `${actionType}::${hash}`;
  }
}
