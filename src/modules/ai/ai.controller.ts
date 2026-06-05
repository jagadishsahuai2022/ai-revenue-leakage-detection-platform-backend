import { FastifyReply, FastifyRequest } from "fastify";
import { PrismaClient } from "@prisma/client";
import { RunIntelligenceAnalysisUseCase } from "../../application/intelligence/RunIntelligenceAnalysisUseCase";
import { ModelRouter } from "../../infrastructure/ai/ModelRouter";
import { successResponse, createdResponse } from "../../shared/utils/response";
import { AppError } from "../../shared/errors/AppError";
import { env } from "../../config/env";
import { logAISafety } from "./ai-safety-logger";
import { RunAnalysisBodySchema, ListInsightsQuerySchema } from "./ai.schema";
import { AIUsageGuardrail } from "../../infrastructure/ai/AIUsageGuardrail";

export class AIController {
  constructor(private readonly prisma: PrismaClient) {}

  // ── POST /ai/run ──────────────────────────────────────────────────────────
  async runAnalysis(req: FastifyRequest, reply: FastifyReply) {
    const body = RunAnalysisBodySchema.parse(req.body ?? {});

    // 1. Resolve model — request body > env default > hard-coded fallback
    const modelId: string =
      body.model ?? env.AI_DEFAULT_MODEL ?? "groq/llama-3.1-8b-instant";

    // 2. Validate model is enabled in the DB catalogue (non-blocking for unknown models)
    let catalogueModel = await this.prisma.aiModel.findUnique({
      where: { id: modelId },
      select: { id: true, isEnabled: true },
    });
    if (catalogueModel && !catalogueModel.isEnabled) {
      return reply.status(400).send({
        success: false,
        error: `Model "${modelId}" is disabled.`,
        code: "MODEL_DISABLED",
      });
    }

    // If the model does not yet exist we insert a barebones record so that the
    // subsequent AIInsight.create() does not violate the foreign key.  The
    // startup seeder also ensures defaults on every launch.
    if (!catalogueModel) {
      const provider = modelId.split("/")[0] || "unknown";
      catalogueModel = await this.prisma.aiModel.upsert({
        where: { id: modelId },
        create: {
          id: modelId,
          displayName: modelId,
          provider,
          isFree: true,
          isEnabled: true,
        },
        update: { isEnabled: true },
      });
    }

    // 3. Quota check — block if exhausted
    const usageRow = await this.prisma.aiUsage.findUnique({
      where: { companyId: req.companyId },
      select: { quotaRemaining: true },
    });
    const quotaRemaining = usageRow?.quotaRemaining ?? env.AI_QUOTA_PER_COMPANY;
    if (quotaRemaining <= 0) {
      return reply.status(402).send({
        success: false,
        error: "AI analysis quota exhausted for this billing period",
        code: "QUOTA_EXHAUSTED",
      });
    }

    // 3b. Monthly usage guardrail — blocks when monthlyUsed >= monthlyLimit
    const guardrail = new AIUsageGuardrail(this.prisma);
    await guardrail.checkAndIncrement(req.companyId);

    // 4. Run statistical analysis (always — no LLM required)
    const useCase = new RunIntelligenceAnalysisUseCase(this.prisma);
    const { insightId, insight, sufficient } = await useCase.execute({
      companyId: req.companyId,
      lookbackDays: body.lookbackDays,
      zScoreThreshold: body.zScoreThreshold,
      modelId,
    });

    // 5. Optional LLM enrichment (opt-in via enrichWithLLM: true)
    let enrichment = null;
    if (body.enrichWithLLM) {
      const router = new ModelRouter(this.prisma, {
        maxTokens: env.AI_MAX_TOKENS,
        temperature: env.AI_TEMPERATURE,
      });
      enrichment = await router.enrichInsight(
        insightId,
        req.companyId,
        insight,
        modelId,
      );

      // Surface a clear error if key is missing
      if (!enrichment) {
        const provider = modelId.split("/")[0];
        const envVar =
          provider === "groq"
            ? "GROQ_API_KEY"
            : provider === "gemini"
              ? "GEMINI_API_KEY"
              : provider === "mistral"
                ? "MISTRAL_API_KEY"
                : provider === "openrouter"
                  ? "OPENROUTER_API_KEY"
                  : "OPENAI_API_KEY";
        if (!process.env[envVar]) {
          throw AppError.badRequest(
            `LLM enrichment failed: ${envVar} is not configured. ` +
              `Add it to your .env or omit "enrichWithLLM" to use statistical analysis only.`,
          );
        }
      }
    }

    // 6. Update quota counters + lastModelUsed (upsert — safe for first run)
    const tokensConsumed = enrichment?.totalTokens ?? 0;
    await this.prisma.aiUsage.upsert({
      where: { companyId: req.companyId },
      create: {
        companyId: req.companyId,
        totalRuns: 1,
        totalInsights: 1,
        tokensUsed: tokensConsumed,
        quotaRemaining: env.AI_QUOTA_PER_COMPANY - 1,
        lastRunAt: new Date(),
        lastModelUsed: modelId,
      },
      update: {
        totalRuns: { increment: 1 },
        totalInsights: { increment: 1 },
        tokensUsed: { increment: tokensConsumed },
        quotaRemaining: { decrement: 1 },
        lastRunAt: new Date(),
        lastModelUsed: modelId,
      },
    });

    // 7. Safety logging — fire-and-forget; never blocks response
    let safetyVerdict: string = "SAFE";
    let safetyFlags: {
      hallucination: boolean;
      policyViolation: boolean;
      promptInjection: boolean;
    } = {
      hallucination: false,
      policyViolation: false,
      promptInjection: false,
    };
    if (enrichment) {
      const safetyInput = insight.summary ?? "";
      const safetyCompletion = enrichment.explanation ?? "";
      const safetyResult = await logAISafety(this.prisma, {
        companyId: req.companyId,
        model: modelId,
        prompt: safetyInput,
        completion: safetyCompletion,
        promptTokens: enrichment.promptTokens ?? 0,
        completionTokens: enrichment.completionTokens ?? 0,
        insightId,
      }).catch((err) => {
        console.error("[AIController] safety log failed:", err);
        return null;
      });
      if (safetyResult) {
        safetyVerdict = safetyResult.verdict;
        safetyFlags = {
          hallucination: safetyResult.flaggedHallucination,
          policyViolation: safetyResult.flaggedPolicyViolation,
          promptInjection: safetyResult.flaggedPromptInjection,
        };
      }
    }

    return reply.status(201).send(
      createdResponse({
        insightId,
        modelId,
        riskScore: insight.riskScore.score,
        riskLevel: insight.riskScore.level,
        anomalyCount: insight.anomalyReport.anomalyCount,
        trend: insight.forecastReport.trend,
        sufficient,
        summary: enrichment?.explanation ?? insight.summary,
        llmEnriched: enrichment !== null,
        safetyVerdict,
        safetyFlags,
        topAnomalies: insight.topAnomalies,
      }),
    );
  }

  // ── GET /ai/insights ──────────────────────────────────────────────────────
  async listInsights(req: FastifyRequest, reply: FastifyReply) {
    const query = ListInsightsQuerySchema.parse(req.query);

    const where: Record<string, unknown> = {
      companyId: req.companyId,
      ...(query.severity && { severity: query.severity }),
      ...(query.unreadOnly && { isRead: false }),
    };

    const [total, rows] = await Promise.all([
      this.prisma.aIInsight.count({ where }),
      this.prisma.aIInsight.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: {
          id: true,
          insightType: true,
          severity: true,
          title: true,
          summary: true,
          riskScore: true,
          windowStart: true,
          windowEnd: true,
          llmEnriched: true,
          isRead: true,
          modelId: true,
          createdAt: true,
        },
      }),
    ]);

    // Batch-fetch safety verdicts for all returned insight IDs.
    // Wrapped in try-catch: if the insightId migration column is not yet applied
    // on this DB instance the query fails silently (degrades to null verdicts).
    const insightIds = rows.map((r) => r.id);
    let safetyLogs: Array<{
      insightId: string | null;
      verdict: string;
      flaggedHallucination: boolean;
      flaggedPolicyViolation: boolean;
      flaggedPromptInjection: boolean;
    }> = [];
    if (insightIds.length > 0) {
      try {
        safetyLogs = await this.prisma.aiSafetyLog.findMany({
          where: { insightId: { in: insightIds }, companyId: req.companyId },
          select: {
            insightId: true,
            verdict: true,
            flaggedHallucination: true,
            flaggedPolicyViolation: true,
            flaggedPromptInjection: true,
          },
          orderBy: { createdAt: "desc" },
        });
      } catch (err) {
        // Column may not exist yet if migration is pending — degrade gracefully
        req.log.warn(
          { err },
          "[AIController] safety log batch-fetch failed — returning null verdicts",
        );
      }
    }

    // Build a map: insightId → most-recent safety log entry
    const safetyMap = new Map<string, (typeof safetyLogs)[0]>();
    for (const log of safetyLogs) {
      if (log.insightId && !safetyMap.has(log.insightId)) {
        safetyMap.set(log.insightId, log);
      }
    }

    const items = rows.map((row) => {
      const safety = safetyMap.get(row.id);
      return {
        ...row,
        safetyVerdict: safety?.verdict ?? null,
        safetyFlags: safety
          ? {
              hallucination: safety.flaggedHallucination,
              policyViolation: safety.flaggedPolicyViolation,
              promptInjection: safety.flaggedPromptInjection,
            }
          : null,
      };
    });

    reply.header("X-Total-Count", String(total));
    reply.header("X-Page", String(query.page));
    reply.header("X-Per-Page", String(query.limit));

    return reply.send(
      successResponse({
        items,
        total,
        page: query.page,
        limit: query.limit,
        totalPages: Math.ceil(total / query.limit),
      }),
    );
  }

  // ── GET /ai/insights/:insightId ───────────────────────────────────────────
  async getInsight(
    req: FastifyRequest<{ Params: { insightId: string } }>,
    reply: FastifyReply,
  ) {
    const row = await this.prisma.aIInsight.findFirst({
      where: { id: req.params.insightId, companyId: req.companyId },
    });

    if (!row) {
      throw AppError.notFound("Insight");
    }

    // Mark as read automatically on fetch
    if (!row.isRead) {
      await this.prisma.aIInsight.update({
        where: { id: row.id },
        data: { isRead: true },
      });
    }

    // Fetch the latest safety log for this insight.
    // Wrapped in try-catch: degrades to null if column migration is pending.
    let safetyLog: {
      verdict: string;
      flaggedHallucination: boolean;
      flaggedPolicyViolation: boolean;
      flaggedPromptInjection: boolean;
    } | null = null;
    try {
      safetyLog = await this.prisma.aiSafetyLog.findFirst({
        where: { insightId: row.id, companyId: req.companyId },
        select: {
          verdict: true,
          flaggedHallucination: true,
          flaggedPolicyViolation: true,
          flaggedPromptInjection: true,
        },
        orderBy: { createdAt: "desc" },
      });
    } catch (err) {
      req.log.warn(
        { err },
        "[AIController] safety log fetch failed — returning null verdict",
      );
    }

    return reply.send(
      successResponse({
        ...row,
        isRead: true,
        safetyVerdict: safetyLog?.verdict ?? null,
        safetyFlags: safetyLog
          ? {
              hallucination: safetyLog.flaggedHallucination,
              policyViolation: safetyLog.flaggedPolicyViolation,
              promptInjection: safetyLog.flaggedPromptInjection,
            }
          : null,
      }),
    );
  }

  // ── PATCH /ai/insights/:insightId/read ────────────────────────────────────
  async markRead(
    req: FastifyRequest<{ Params: { insightId: string } }>,
    reply: FastifyReply,
  ) {
    const row = await this.prisma.aIInsight.findFirst({
      where: { id: req.params.insightId, companyId: req.companyId },
      select: { id: true },
    });

    if (!row) throw AppError.notFound("Insight");

    await this.prisma.aIInsight.update({
      where: { id: row.id },
      data: { isRead: true },
    });

    return reply.send(successResponse({ id: row.id, isRead: true }));
  }

  // ── GET /ai/usage ─────────────────────────────────────────────────────────
  async listUsage(req: FastifyRequest, reply: FastifyReply) {
    // Upsert ensures a row always exists even before first run
    const [usageRow, tokenAgg] = await Promise.all([
      this.prisma.aiUsage.upsert({
        where: { companyId: req.companyId },
        create: {
          companyId: req.companyId,
          quotaRemaining: env.AI_QUOTA_PER_COMPANY,
        },
        update: {},
      }),
      this.prisma.aIModelUsage.aggregate({
        where: { companyId: req.companyId },
        _sum: { totalTokens: true, costUsd: true },
      }),
    ]);

    return reply.send(
      successResponse({
        totalRuns: usageRow.totalRuns,
        totalInsights: usageRow.totalInsights,
        lastRunAt: usageRow.lastRunAt?.toISOString() ?? null,
        tokensUsed: tokenAgg._sum.totalTokens ?? 0,
        costUsd: Number(tokenAgg._sum.costUsd ?? 0),
        quotaRemaining: usageRow.quotaRemaining,
        quotaTotal: env.AI_QUOTA_PER_COMPANY,
        lastModelUsed: usageRow.lastModelUsed ?? null,
        monthlyLimit: usageRow.monthlyLimit,
        monthlyUsed: usageRow.monthlyUsed,
        monthlyResetAt: usageRow.monthlyResetAt?.toISOString() ?? null,
      }),
    );
  }

  // ── GET /ai/models ────────────────────────────────────────────────
  async listModels(req: FastifyRequest, reply: FastifyReply) {
    const models = await this.prisma.aiModel.findMany({
      where: { isEnabled: true },
      orderBy: [{ provider: "asc" }, { id: "asc" }],
      select: {
        id: true,
        displayName: true,
        provider: true,
        isFree: true,
      },
    });

    const rows = models.map((m) => {
      const provider = m.id.split("/")[0];
      const envVar =
        provider === "groq"
          ? "GROQ_API_KEY"
          : provider === "gemini"
            ? "GEMINI_API_KEY"
            : provider === "mistral"
              ? "MISTRAL_API_KEY"
              : provider === "openrouter"
                ? "OPENROUTER_API_KEY"
                : "OPENAI_API_KEY";
      return {
        id: m.id,
        name: m.displayName,
        provider: m.provider,
        free: m.isFree,
        keyConfigured: !!process.env[envVar],
      };
    });

    return reply.send(successResponse(rows));
  }
}
