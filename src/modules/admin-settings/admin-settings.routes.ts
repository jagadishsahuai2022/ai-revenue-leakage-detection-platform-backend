import { FastifyInstance } from "fastify";
import { authenticate } from "../../shared/middleware/auth.middleware";
import { requireRole } from "../../shared/middleware/rbac.middleware";
import { successResponse } from "../../shared/utils/response";
import { AppError } from "../../shared/errors/AppError";
import {
  getLocalizationSettings,
  updateLocalizationSettings,
  getUserLanguage,
  updateUserLanguage,
  getTypographyConfig,
  updateTypographyConfig,
  SUPPORTED_LANGUAGES,
  TYPOGRAPHY_DEFAULTS,
} from "./admin-settings.service";
import {
  getRegionSettings,
  updateRegionSettings,
  REGION_DEFAULTS,
  LANGUAGE_REGION_MAP,
} from "./region-settings.service";
import {
  getSystemHealth,
  getIntegrationHealth,
  getQuickStats,
  getUsageAnalytics,
  getAdminAuditLogs,
} from "./admin-command.service";

export async function adminSettingsRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  const authHook = { preHandler: [authenticate] };
  const adminHook = {
    preHandler: [authenticate, requireRole("COMPANY_ADMIN")],
  };

  // ── Localization (admin) ────────────────────────────────────────────────────

  /** GET /admin/settings/localization — current company localization config */
  fastify.get("/settings/localization", adminHook, async (req, reply) => {
    const settings = await getLocalizationSettings(
      req.server.prisma,
      req.companyId,
    );
    return reply.send(
      successResponse({
        ...settings,
        supportedLanguages: SUPPORTED_LANGUAGES,
      }),
    );
  });

  /** PUT /admin/settings/localization — update company localization config */
  fastify.put<{
    Body: { defaultLanguage?: string; availableLanguages?: string[] };
  }>("/settings/localization", adminHook, async (req, reply) => {
    const { defaultLanguage, availableLanguages } = req.body ?? {};
    try {
      const settings = await updateLocalizationSettings(
        req.server.prisma,
        req.companyId,
        {
          defaultLanguage,
          availableLanguages,
        },
      );
      return reply.send(successResponse(settings));
    } catch (e: any) {
      throw AppError.badRequest(e.message ?? "Invalid localization settings");
    }
  });

  // ── User language preference ────────────────────────────────────────────────

  /** GET /admin/user-language — current user's preferred language */
  fastify.get("/user-language", authHook, async (req, reply) => {
    const { preferredLanguage, companyDefault } = await getUserLanguage(
      req.server.prisma,
      req.userId,
    );
    return reply.send(successResponse({ preferredLanguage, companyDefault }));
  });

  /** PUT /admin/user-language — update current user's preferred language */
  fastify.put<{ Body: { language: string } }>(
    "/user-language",
    authHook,
    async (req, reply) => {
      const { language } = req.body ?? {};
      if (!language || typeof language !== "string") {
        throw AppError.badRequest("language is required");
      }
      try {
        const result = await updateUserLanguage(
          req.server.prisma,
          req.userId,
          language,
        );
        return reply.send(successResponse({ preferredLanguage: result }));
      } catch (e: any) {
        throw AppError.badRequest(e.message ?? "Invalid language");
      }
    },
  );

  // ── Typography (admin) ──────────────────────────────────────────────────────

  /** GET /admin/settings/typography — current company typography config */
  fastify.get("/settings/typography", authHook, async (req, reply) => {
    const config = await getTypographyConfig(req.server.prisma, req.companyId);
    return reply.send(
      successResponse({
        config,
        defaults: TYPOGRAPHY_DEFAULTS,
      }),
    );
  });

  /** PUT /admin/settings/typography — update company typography config */
  fastify.put<{
    Body: {
      headingFont?: string | null;
      headingFontSize?: string | null;
      gridHeaderFont?: string | null;
      gridHeaderFontSize?: string | null;
      gridRowFont?: string | null;
      gridRowFontSize?: string | null;
      menuFont?: string | null;
      menuFontSize?: string | null;
      navigationFont?: string | null;
      navigationFontSize?: string | null;
      labelFont?: string | null;
      labelFontSize?: string | null;
    };
  }>("/settings/typography", adminHook, async (req, reply) => {
    const config = await updateTypographyConfig(
      req.server.prisma,
      req.companyId,
      req.body ?? {},
    );
    return reply.send(
      successResponse({
        config,
        defaults: TYPOGRAPHY_DEFAULTS,
      }),
    );
  });

  // ── Region Settings (admin) ─────────────────────────────────────────────────

  /** GET /admin/settings/region — current company region/formatting config */
  fastify.get("/settings/region", authHook, async (req, reply) => {
    const settings = await getRegionSettings(req.server.prisma, req.companyId);
    return reply.send(
      successResponse({
        ...settings,
        defaults: REGION_DEFAULTS,
        languageRegionMap: LANGUAGE_REGION_MAP,
      }),
    );
  });

  /** PUT /admin/settings/region — update company region/formatting config */
  fastify.put<{
    Body: {
      currency?: string;
      timezone?: string;
      dateFormat?: string;
      numberFormat?: string;
    };
  }>("/settings/region", adminHook, async (req, reply) => {
    try {
      const settings = await updateRegionSettings(
        req.server.prisma,
        req.companyId,
        req.body ?? {},
      );
      return reply.send(successResponse(settings));
    } catch (e: any) {
      throw AppError.badRequest(e.message ?? "Invalid region settings");
    }
  });

  // ── Admin Command Center ────────────────────────────────────────────────────

  /** GET /admin/system-health — database, API, memory stats */
  fastify.get("/system-health", adminHook, async (req, reply) => {
    const health = await getSystemHealth(req.server.prisma);
    return reply.send(successResponse(health));
  });

  /** GET /admin/integration-health — per-provider connector status */
  fastify.get("/integration-health", adminHook, async (req, reply) => {
    const integrations = await getIntegrationHealth(
      req.server.prisma,
      req.companyId,
    );
    return reply.send(successResponse(integrations));
  });

  /** GET /admin/quick-stats — summary dashboard stats */
  fastify.get("/quick-stats", adminHook, async (req, reply) => {
    const stats = await getQuickStats(req.server.prisma, req.companyId);
    return reply.send(successResponse(stats));
  });

  /** GET /admin/usage-analytics — user activity, API calls, AI insights */
  fastify.get<{ Querystring: { period?: string } }>(
    "/usage-analytics",
    adminHook,
    async (req, reply) => {
      const period = (req.query as any).period ?? "30d";
      const analytics = await getUsageAnalytics(
        req.server.prisma,
        req.companyId,
        period,
      );
      return reply.send(successResponse(analytics));
    },
  );

  /** GET /admin/audit-logs — filterable, paginated audit log viewer */
  fastify.get<{
    Querystring: {
      page?: string;
      limit?: string;
      category?: string;
      user?: string;
      from?: string;
      to?: string;
    };
  }>("/audit-logs", adminHook, async (req, reply) => {
    const q = req.query as any;
    const result = await getAdminAuditLogs(req.server.prisma, req.companyId, {
      page: q.page ? Number(q.page) : undefined,
      limit: q.limit ? Number(q.limit) : undefined,
      category: q.category,
      user: q.user,
      from: q.from,
      to: q.to,
    });
    return reply.send(successResponse(result));
  });
}
