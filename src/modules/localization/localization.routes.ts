import { FastifyInstance } from "fastify";
import { authenticate } from "../../shared/middleware/auth.middleware";
import { requireRole } from "../../shared/middleware/rbac.middleware";
import { successResponse } from "../../shared/utils/response";
import { AppError } from "../../shared/errors/AppError";
import {
  translate,
  translateBatch,
  listTranslationOverrides,
  upsertTranslationOverride,
  deleteTranslationOverride,
} from "./localization.service";
import {
  getDictionary,
  warmupTranslations,
  recordBatchUsage,
  getMostUsedTranslations,
  getLeastUsedTranslations,
  getTranslationHealth,
  createAISuggestion,
  listAISuggestions,
  reviewAISuggestion,
  submitContribution,
  listContributions,
  reviewContribution,
} from "./localization-extended.service";

export async function localizationRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  const authHook = { preHandler: [authenticate] };
  const adminHook = {
    preHandler: [authenticate, requireRole("COMPANY_ADMIN")],
  };

  // ── POST /localization/translate ─────────────────────────────────────────
  /**
   * Translate a single piece of dynamic content.
   * Priority: override → static lookup → cache → LibreTranslate → fallback.
   */
  fastify.post<{ Body: { text: string; locale: string } }>(
    "/localization/translate",
    authHook,
    async (req, reply) => {
      const { text, locale } = req.body ?? {};
      if (!text || !locale) {
        throw AppError.badRequest("text and locale are required");
      }
      const result = await translate(req.server.prisma, text, {
        locale,
        companyId: req.companyId,
      });
      return reply.send(successResponse(result));
    },
  );

  // ── POST /localization/translate-batch ───────────────────────────────────
  /**
   * Translate multiple strings in a single request.
   * Concurrency-limited to avoid overwhelming the free translation tier.
   */
  fastify.post<{ Body: { texts: string[]; locale: string } }>(
    "/localization/translate-batch",
    authHook,
    async (req, reply) => {
      const { texts, locale } = req.body ?? {};
      if (!Array.isArray(texts) || !locale) {
        throw AppError.badRequest("texts (array) and locale are required");
      }
      if (texts.length > 100) {
        throw AppError.badRequest("Maximum 100 texts per batch");
      }
      const results = await translateBatch(req.server.prisma, {
        texts,
        locale,
        companyId: req.companyId,
      });
      return reply.send(successResponse(results));
    },
  );

  // ── GET /localization/overrides ──────────────────────────────────────────
  /** List all translation overrides visible to the current company. */
  fastify.get<{ Querystring: { locale?: string } }>(
    "/localization/overrides",
    adminHook,
    async (req, reply) => {
      const { locale } = req.query ?? {};
      const overrides = await listTranslationOverrides(
        req.server.prisma,
        req.companyId,
        locale,
      );
      return reply.send(successResponse(overrides));
    },
  );

  // ── POST /localization/overrides ─────────────────────────────────────────
  /** Create or update a translation override. */
  fastify.post<{
    Body: {
      locale: string;
      sourceText: string;
      translatedText: string;
      global?: boolean;
    };
  }>("/localization/overrides", adminHook, async (req, reply) => {
    const {
      locale,
      sourceText,
      translatedText,
      global: isGlobal,
    } = req.body ?? {};
    if (!locale || !sourceText || !translatedText) {
      throw AppError.badRequest(
        "locale, sourceText and translatedText are required",
      );
    }
    // Only SUPER_ADMINs may create global (companyId=null) overrides
    const companyId =
      isGlobal && req.userRole === "SUPER_ADMIN" ? undefined : req.companyId;

    const override = await upsertTranslationOverride(req.server.prisma, {
      companyId,
      locale,
      sourceText,
      translatedText,
    });
    return reply.code(201).send(successResponse(override));
  });

  // ── DELETE /localization/overrides/:id ───────────────────────────────────
  /** Delete a translation override by id. */
  fastify.delete<{ Params: { id: string } }>(
    "/localization/overrides/:id",
    adminHook,
    async (req, reply) => {
      const { id } = req.params;
      await deleteTranslationOverride(req.server.prisma, id);
      return reply.send(successResponse({ deleted: true }));
    },
  );

  // ── GET /localization/dictionary ────────────────────────────────────────
  /** Bulk-load cached translations for a locale. */
  fastify.get<{ Querystring: { locale: string; limit?: string } }>(
    "/localization/dictionary",
    authHook,
    async (req, reply) => {
      const { locale, limit } = req.query ?? {};
      if (!locale) throw AppError.badRequest("locale query param is required");
      const entries = await getDictionary(
        req.server.prisma,
        locale,
        limit ? parseInt(limit, 10) : 500,
      );
      return reply.send(successResponse(entries));
    },
  );

  // ── POST /localization/warmup ───────────────────────────────────────────
  /** Preload translations for common texts. */
  fastify.post<{ Body: { texts: string[]; locale: string } }>(
    "/localization/warmup",
    authHook,
    async (req, reply) => {
      const { texts, locale } = req.body ?? {};
      if (!Array.isArray(texts) || !locale) {
        throw AppError.badRequest("texts (array) and locale are required");
      }
      if (texts.length > 200) {
        throw AppError.badRequest("Maximum 200 texts per warmup");
      }
      const result = await warmupTranslations(
        req.server.prisma,
        translateBatch as any,
        { texts, locale, companyId: req.companyId },
      );
      return reply.send(successResponse(result));
    },
  );

  // ── GET /localization/telemetry/most-used ───────────────────────────────
  fastify.get<{ Querystring: { locale?: string; limit?: string } }>(
    "/localization/telemetry/most-used",
    adminHook,
    async (req, reply) => {
      const { locale, limit } = req.query ?? {};
      const entries = await getMostUsedTranslations(
        req.server.prisma,
        locale,
        limit ? parseInt(limit, 10) : 50,
      );
      return reply.send(successResponse(entries));
    },
  );

  // ── GET /localization/telemetry/least-used ──────────────────────────────
  fastify.get<{ Querystring: { locale?: string; limit?: string } }>(
    "/localization/telemetry/least-used",
    adminHook,
    async (req, reply) => {
      const { locale, limit } = req.query ?? {};
      const entries = await getLeastUsedTranslations(
        req.server.prisma,
        locale,
        limit ? parseInt(limit, 10) : 50,
      );
      return reply.send(successResponse(entries));
    },
  );

  // ── GET /localization/health ────────────────────────────────────────────
  /** Translation coverage per locale. */
  fastify.get<{ Querystring: { totalKeys?: string } }>(
    "/localization/health",
    adminHook,
    async (req, reply) => {
      const totalKeys = req.query?.totalKeys
        ? parseInt(req.query.totalKeys, 10)
        : 50; // approximate en.json key count
      const locales = [
        "en",
        "es",
        "fr",
        "de",
        "hi",
        "ta",
        "bn",
        "te",
        "ja",
        "zh",
        "ko",
        "ru",
        "ar",
        "pt",
        "it",
      ];
      const health = await getTranslationHealth(
        req.server.prisma,
        totalKeys,
        locales,
      );
      return reply.send(successResponse(health));
    },
  );

  // ── POST /localization/ai-suggest ───────────────────────────────────────
  /** Create an AI translation suggestion. */
  fastify.post<{
    Body: {
      locale: string;
      sourceText: string;
      currentTranslation?: string;
      suggestedTranslation: string;
      confidence?: number;
    };
  }>("/localization/ai-suggest", adminHook, async (req, reply) => {
    const {
      locale,
      sourceText,
      currentTranslation,
      suggestedTranslation,
      confidence,
    } = req.body ?? {};
    if (!locale || !sourceText || !suggestedTranslation) {
      throw AppError.badRequest(
        "locale, sourceText, and suggestedTranslation are required",
      );
    }
    const suggestion = await createAISuggestion(req.server.prisma, {
      locale,
      sourceText,
      currentTranslation,
      suggestedTranslation,
      confidence: confidence ?? 0.8,
    });
    return reply.code(201).send(successResponse(suggestion));
  });

  // ── GET /localization/ai-suggestions ────────────────────────────────────
  fastify.get<{ Querystring: { locale?: string; status?: string } }>(
    "/localization/ai-suggestions",
    adminHook,
    async (req, reply) => {
      const suggestions = await listAISuggestions(req.server.prisma, req.query);
      return reply.send(successResponse(suggestions));
    },
  );

  // ── PUT /localization/ai-suggestions/:id/review ─────────────────────────
  fastify.put<{
    Params: { id: string };
    Body: { decision: "accepted" | "rejected" };
  }>(
    "/localization/ai-suggestions/:id/review",
    adminHook,
    async (req, reply) => {
      const { decision } = req.body ?? {};
      if (!decision || !["accepted", "rejected"].includes(decision)) {
        throw AppError.badRequest("decision must be 'accepted' or 'rejected'");
      }
      const result = await reviewAISuggestion(
        req.server.prisma,
        req.params.id,
        decision,
        req.userId,
      );
      return reply.send(successResponse(result));
    },
  );

  // ── POST /localization/contributions ────────────────────────────────────
  /** Submit a community translation. */
  fastify.post<{
    Body: {
      locale: string;
      sourceText: string;
      suggestedTranslation: string;
    };
  }>("/localization/contributions", authHook, async (req, reply) => {
    const { locale, sourceText, suggestedTranslation } = req.body ?? {};
    if (!locale || !sourceText || !suggestedTranslation) {
      throw AppError.badRequest(
        "locale, sourceText, and suggestedTranslation are required",
      );
    }
    const contribution = await submitContribution(req.server.prisma, {
      locale,
      sourceText,
      suggestedTranslation,
      contributorId: req.userId,
      contributorEmail: req.userEmail,
    });
    return reply.code(201).send(successResponse(contribution));
  });

  // ── GET /localization/contributions ─────────────────────────────────────
  fastify.get<{ Querystring: { locale?: string; status?: string } }>(
    "/localization/contributions",
    adminHook,
    async (req, reply) => {
      const contributions = await listContributions(
        req.server.prisma,
        req.query,
      );
      return reply.send(successResponse(contributions));
    },
  );

  // ── PUT /localization/contributions/:id/review ──────────────────────────
  fastify.put<{
    Params: { id: string };
    Body: { decision: "approved" | "rejected" };
  }>(
    "/localization/contributions/:id/review",
    adminHook,
    async (req, reply) => {
      const { decision } = req.body ?? {};
      if (!decision || !["approved", "rejected"].includes(decision)) {
        throw AppError.badRequest("decision must be 'approved' or 'rejected'");
      }
      const result = await reviewContribution(
        req.server.prisma,
        req.params.id,
        decision,
        req.userId,
      );
      return reply.send(successResponse(result));
    },
  );
}
