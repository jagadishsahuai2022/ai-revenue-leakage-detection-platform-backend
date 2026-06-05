import { z } from "zod";
import "dotenv/config";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default("0.0.0.0"),
  API_PREFIX: z.string().default("/api/v1"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  FRONTEND_URL: z.string().url().default("http://localhost:5173"),
  // Comma-separated list of allowed CORS origins.
  // Defaults to FRONTEND_URL + APP_URL when not set.
  CORS_ORIGINS: z.string().optional(),

  DATABASE_URL: z.string().url(),

  // ── Demo mode feature flag ─────────────────────────────────────────────
  // Set ENABLE_DEMO_MODE=true only in development / staging.
  // Production guard: if NODE_ENV=production, ENABLE_DEMO_MODE is forced to 'false'.
  // Legacy ENABLE_DEMO_DATA is still accepted as an alias.
  ENABLE_DEMO_MODE: z.enum(["true", "false"]).default("false"),
  ENABLE_DEMO_DATA: z.enum(["true", "false"]).default("false"),
  DEMO_COMPANY_SLUG: z.string().default("demo"),

  // z.coerce.boolean() would turn the string "false" into true (non-empty string = truthy).
  // Use preprocess to correctly map "true"/"1" → true and everything else → false.
  REDIS_ENABLED: z
    .preprocess((v) => v === "true" || v === "1" || v === true, z.boolean())
    .default(false),
  REDIS_URL: z.string().default("redis://localhost:6379"),

  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default("15m"),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_REFRESH_EXPIRES_IN: z.string().default("7d"),

  BCRYPT_ROUNDS: z.coerce.number().default(12),

  RATE_LIMIT_MAX: z.coerce.number().default(100),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60_000),

  STRIPE_SECRET_KEY: z.string().default(""),
  STRIPE_WEBHOOK_SECRET: z.string().default(""),
  STRIPE_PRICE_STARTER: z.string().default(""),
  STRIPE_PRICE_GROWTH: z.string().default(""),
  STRIPE_PRICE_ENTERPRISE: z.string().default(""),

  GITHUB_CLIENT_ID: z.string().default(""),
  GITHUB_CLIENT_SECRET: z.string().default(""),
  GITHUB_CALLBACK_URL: z
    .string()
    .default("http://localhost:3000/api/v1/auth/github/callback"),

  // ── Connector Engine v2 feature flag ─────────────────────────────────────
  // Set to "true" or "1" to activate the new Adapter-pattern connector layer.
  // Defaults to false — all existing Stripe / GitHub paths remain unchanged.
  USE_CONNECTOR_ENGINE_V2: z
    .preprocess((v) => v === "true" || v === "1" || v === true, z.boolean())
    .default(false),

  // ── Connector Encryption Key ─────────────────────────────────────────────
  // AES-256 encryption key for securing OAuth tokens and API keys at rest.
  // Must be exactly 64 hex characters (32 bytes). Generate with:
  //   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  CONNECTOR_ENCRYPTION_KEY: z.string().length(64).default("0".repeat(64)),

  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),

  // ── AI Intelligence Engine ───────────────────────────────────────────────
  // Set ENABLE_AI_ENGINE=true to activate the statistical + LLM analysis layer.
  // LLM calls are further gated by provider API keys being non-empty.
  ENABLE_AI_ENGINE: z
    .preprocess((v) => v === "true" || v === "1" || v === true, z.boolean())
    .default(false),

  // ── Legacy OpenAI (still supported as a fallback) ────────────────────────
  OPENAI_API_KEY: z.string().default(""),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
  OPENAI_MAX_TOKENS: z.coerce.number().int().min(100).max(2000).default(400),

  // ── Multi-provider AI keys ────────────────────────────────────────────────
  GROQ_API_KEY: z.string().default(""),
  GEMINI_API_KEY: z.string().default(""),
  MISTRAL_API_KEY: z.string().default(""),
  OPENROUTER_API_KEY: z.string().default(""),

  // ── AI Engine defaults ───────────────────────────────────────────────────
  /// Default model used when POST /ai/run omits the `model` field.
  AI_DEFAULT_MODEL: z.string().default("groq/llama-3.1-8b-instant"),
  AI_MAX_TOKENS: z.coerce.number().int().min(100).max(4096).default(1024),
  AI_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.3),

  /// Monthly AI run quota granted to each company (default 100).
  AI_QUOTA_PER_COMPANY: z.coerce.number().int().min(1).default(100),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment variables:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

// ── Production safety guard ─────────────────────────────────────────────────
// In production, demo mode is ALWAYS disabled regardless of env var.
if (parsed.data.NODE_ENV === "production") {
  (parsed.data as any).ENABLE_DEMO_MODE = "false";
  (parsed.data as any).ENABLE_DEMO_DATA = "false";
}

export const env = parsed.data;

// ── Derived helpers ─────────────────────────────────────────────────────────
/** True when demo mode is explicitly enabled AND we are NOT in production. */
export const isDemoMode: boolean =
  (env.ENABLE_DEMO_MODE === "true" || env.ENABLE_DEMO_DATA === "true") &&
  env.NODE_ENV !== "production";

export const demoCompanySlug: string = env.DEMO_COMPANY_SLUG;
export type Env = typeof env;
