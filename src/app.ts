import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";

import { env } from "./config/env";
import { errorHandler } from "./shared/errors/error-handler";

// Plugins
import prismaPlugin from "./shared/plugins/prisma.plugin";
import redisPlugin from "./shared/plugins/redis.plugin";
import bullmqPlugin from "./shared/plugins/bullmq.plugin";
import requestTracingPlugin from "./shared/plugins/request-tracing.plugin";
import tenantContextPlugin from "./shared/plugins/tenant-context.plugin";
import idempotencyPlugin from "./shared/plugins/idempotency.plugin";
import { tenantRateLimitKeyGenerator } from "./shared/plugins/tenant-rate-limit";

// Routes
import { authRoutes } from "./modules/auth/auth.routes";
import { usersRoutes } from "./modules/users/users.routes";
import { companiesRoutes } from "./modules/companies/companies.routes";
import { revenueRoutes } from "./modules/revenue/revenue.routes";
import { billingRoutes } from "./modules/billing/billing.routes";
import { integrationsRoutes } from "./modules/integrations/integrations.routes";
import { auditRoutes } from "./modules/audit/audit.routes";
import { aiRoutes } from "./modules/ai/ai.routes";
import { agentRoutes } from "./modules/agent/interface/http/agent.routes";
import { featureFlagsRoutes } from "./modules/feature-flags/feature-flags.routes";
import { clientLogsRoutes } from "./modules/client-logs/client-logs.routes";
import { webhooksRoutes } from "./modules/webhooks/webhooks.routes";
import { telemetryRoutes } from "./modules/telemetry/telemetry.routes";
import { adminSettingsRoutes } from "./modules/admin-settings/admin-settings.routes";
import { localizationRoutes } from "./modules/localization/localization.routes";
import { notificationsRoutes } from "./modules/notifications/notifications.routes";
import { activityRoutes } from "./modules/activity/activity.routes";
import { workspacesRoutes } from "./modules/workspaces/workspaces.routes";
import { addContentTypeParser } from "./modules/billing/raw-body.helper";

export async function buildApp() {
  const fastify = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      ...(env.NODE_ENV === "development"
        ? {
            transport: {
              target: "pino-pretty",
              options: {
                colorize: true,
                translateTime: "HH:MM:ss.l",
                ignore: "pid,hostname",
              },
            },
          }
        : {}),
    },
    trustProxy: true,
    disableRequestLogging: false,
  });

  // ── Security ────────────────────────────────────────────────────────────────
  await fastify.register(helmet, {
    contentSecurityPolicy: env.NODE_ENV === "production",
  });

  const productionOrigins = [
    "https://revsecurecloud.com",
    "https://www.revsecurecloud.com",
  ];

  const allowedOrigins: string[] = [
    ...productionOrigins,
    ...(env.CORS_ORIGINS
      ? env.CORS_ORIGINS.split(",")
          .map((o) => o.trim())
          .filter(Boolean)
      : [env.FRONTEND_URL, env.APP_URL]),
  ].filter((v, i, arr) => arr.indexOf(v) === i); // deduplicate

  fastify.log.info({ allowedOrigins }, "CORS allowed origins");

  await fastify.register(cors, {
    // Use a callback so @fastify/cors ALWAYS reflects the origin header back
    // when it matches, instead of silently dropping all CORS headers when the
    // array-based matcher doesn't find a match.
    origin: (origin, cb) => {
      // Allow requests with no origin (server-to-server, curl, mobile apps)
      if (!origin) return cb(null, true);
      // Allow any origin that's in the allowlist
      if (allowedOrigins.includes(origin)) return cb(null, true);
      // In development, also allow any localhost origin
      if (
        env.NODE_ENV === "development" &&
        /^https?:\/\/localhost(:\d+)?$/.test(origin)
      ) {
        return cb(null, true);
      }
      fastify.log.warn({ origin, allowedOrigins }, "CORS origin rejected");
      cb(null, false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    // ⚠️  Do NOT set allowedHeaders explicitly.
    // When omitted, @fastify/cors reflects the browser's
    // Access-Control-Request-Headers value back as Access-Control-Allow-Headers.
    // This guarantees every header the client sends (Content-Type, Authorization,
    // X-Request-Id, etc.) is always echoed back as allowed — with zero risk of a
    // case-sensitivity mismatch or a future header being missed.
    // An explicit list was the root cause of the "x-request-id not allowed" CORS
    // regression introduced in the previous deployment.
    exposedHeaders: [
      "X-Total-Count",
      "X-Page",
      "X-Per-Page",
      "RateLimit-Limit",
      "RateLimit-Remaining",
      "RateLimit-Reset",
      "X-Request-Id",
      "X-Idempotency-Replayed",
    ],
    // Cache preflight for 24 h to avoid repeated OPTIONS round-trips in production
    maxAge: 86_400,
    preflight: true,
    strictPreflight: false,
  });

  // Belt-and-suspenders: for every OPTIONS preflight, explicitly echo back
  // whatever headers the browser said it needs. This fires AFTER @fastify/cors
  // but ensures nothing is dropped even if the plugin version has edge cases.
  fastify.addHook("onSend", async (request, reply, payload) => {
    if (request.method === "OPTIONS") {
      const requested = request.headers["access-control-request-headers"];
      if (requested) {
        reply.header("Access-Control-Allow-Headers", requested);
      }
    }
    // Always return the (possibly modified) payload per Fastify docs
    return payload;
  });

  // ── Rate Limiting (tenant-isolated) ──────────────────────────────────────
  await fastify.register(rateLimit, {
    global: true,
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW_MS,
    keyGenerator: tenantRateLimitKeyGenerator,
    errorResponseBuilder: (_req, context) => ({
      success: false,
      error: "Too many requests",
      code: "RATE_LIMITED",
      retryAfter: Math.ceil(context.ttl / 1000),
    }),
  });

  // ── JWT ─────────────────────────────────────────────────────────────────────
  await fastify.register(jwt, {
    secret: env.JWT_SECRET,
    sign: { expiresIn: env.JWT_EXPIRES_IN },
  });

  // ── Database / Cache / Queue Plugins ────────────────────────────────────────
  await fastify.register(prismaPlugin);

  // Ensure catalog data is present (e.g. available AI models).
  // This runs every time the server starts but the upsert logic keeps it cheap.
  const { seedAIModels } = await import("./modules/ai/aiModelSeeder");
  await seedAIModels(fastify.prisma);

  await fastify.register(redisPlugin);
  await fastify.register(bullmqPlugin);

  // ── Enterprise Safety & Governance Plugins ─────────────────────────────────
  // 1. Request tracing — assigns UUID per request, enriches logger
  await fastify.register(requestTracingPlugin);
  // 2. Tenant context — wraps requests in AsyncLocalStorage for Prisma middleware
  await fastify.register(tenantContextPlugin);
  // 3. Idempotency — deduplicates POST/PUT/PATCH via X-Idempotency-Key header
  await fastify.register(idempotencyPlugin);

  // ── Raw body for Stripe webhooks ────────────────────────────────────────────
  addContentTypeParser(fastify);

  // ── OpenAPI Docs (dev only) ──────────────────────────────────────────────────
  if (env.NODE_ENV !== "production") {
    await fastify.register(swagger, {
      openapi: {
        info: {
          title: "RevenueGuard API",
          version: "1.0.0",
          description: "SaaS Revenue Leakage Detector",
        },
        servers: [{ url: `${env.APP_URL}${env.API_PREFIX}` }],
        components: {
          securitySchemes: {
            bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
          },
        },
        security: [{ bearerAuth: [] }],
      },
    });

    await fastify.register(swaggerUi, {
      routePrefix: "/docs",
      uiConfig: { docExpansion: "list", deepLinking: true },
    });
  }

  // ── Routes ──────────────────────────────────────────────────────────────────
  const prefix = env.API_PREFIX;

  fastify.register(authRoutes, { prefix: `${prefix}/auth` });
  fastify.register(usersRoutes, { prefix: `${prefix}/users` });
  fastify.register(companiesRoutes, { prefix: `${prefix}/company` });
  fastify.register(revenueRoutes, { prefix: `${prefix}/revenue` });
  fastify.register(billingRoutes, { prefix: `${prefix}/billing` });
  fastify.register(integrationsRoutes, { prefix: `${prefix}/integrations` });
  fastify.register(auditRoutes, { prefix: `${prefix}/audit` });
  fastify.register(aiRoutes, { prefix: `${prefix}/ai` });
  fastify.register(agentRoutes, { prefix: `${prefix}/agent` });
  fastify.register(featureFlagsRoutes, { prefix: `${prefix}/feature-flags` });
  fastify.register(clientLogsRoutes, { prefix: `${prefix}/client-logs` });
  fastify.register(telemetryRoutes, { prefix: `${prefix}/telemetry` });
  fastify.register(adminSettingsRoutes, { prefix: `${prefix}/admin` });
  fastify.register(localizationRoutes, { prefix: `${prefix}` });
  fastify.register(notificationsRoutes, { prefix: `${prefix}/notifications` });
  fastify.register(activityRoutes, { prefix: `${prefix}/activity` });
  fastify.register(workspacesRoutes, { prefix: `${prefix}/workspaces` });

  // ── Webhook Routes (no auth — validated via HMAC signatures) ──────────────
  fastify.register(webhooksRoutes, { prefix: "/webhooks" });

  // ── Health Check ─────────────────────────────────────────────────────────────
  fastify.get("/health", { logLevel: "warn" }, async (_req, reply) => {
    try {
      await fastify.prisma.$queryRaw`SELECT 1`;
      if (env.REDIS_ENABLED && fastify.redis) {
        await fastify.redis.ping();
      }
      return reply.send({ status: "ok", timestamp: new Date().toISOString() });
    } catch (err) {
      return reply.status(503).send({ status: "degraded", error: String(err) });
    }
  });

  fastify.get("/", (_req, reply) => {
    reply.send({ name: "RevenueGuard API", version: "1.0.0", docs: "/docs" });
  });

  // ── Error Handler ────────────────────────────────────────────────────────────
  fastify.setErrorHandler(errorHandler);

  // ── Not Found ────────────────────────────────────────────────────────────────
  fastify.setNotFoundHandler((_req, reply) => {
    reply
      .status(404)
      .send({ success: false, error: "Route not found", code: "NOT_FOUND" });
  });

  return fastify;
}
