# Copilot Prompt — AI Revenue Intelligence Backend

> **Status**: Phase 3 is implemented. Use this document as a reference for the
> existing implementation and as a starting point for future extensions.

---

## Implemented Endpoints

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| `POST` | `/api/v1/ai/run` | JWT (COMPANY_ADMIN) | Triggers statistical analysis + optional LLM enrichment |
| `GET` | `/api/v1/ai/insights` | JWT | Lists insights for company, filterable by severity/unread |
| `GET` | `/api/v1/ai/insights/:id` | JWT | Single insight, auto-marks as read |
| `PATCH` | `/api/v1/ai/insights/:id/read` | JWT | Explicit mark-read |
| `GET` | `/api/v1/ai/usage` | JWT (COMPANY_ADMIN) | Quota + token usage stats |

> **All routes** return `{ success: true, data: <payload> }`.
> The feature flag `ENABLE_AI_ENGINE=false` (default) makes all routes return
> `404` silently — they become invisible until the flag is enabled.

---

## Architecture

```
src/
  domain/intelligence/
    AnomalyDetector.ts        ← moving-average + z-score detection (pure math)
    ForecastEngine.ts         ← linear regression + 3-period forecast (pure math)
    RiskScoringEngine.ts      ← weighted composite score 0-100
    AIInsightGenerator.ts     ← orchestrates all three → StructuredInsight

  application/intelligence/
    RunIntelligenceAnalysisUseCase.ts
      ↳ fetches bucketed Revenue rows (no PII dump)
      ↳ runs statistical engine
      ↳ persists AIInsight
      ↳ optional: calls OpenAIAdapter

  infrastructure/ai/
    OpenAIAdapter.ts          ← raw fetch (no SDK), tracks AIModelUsage, fails gracefully

  modules/ai/
    ai.schema.ts              ← Zod validation
    ai.controller.ts          ← 5 route handlers + new /usage quota endpoint
    ai.routes.ts              ← Fastify route registration + feature flag guard
```

---

## DB Models (Prisma)

### `ai_insights`

```prisma
model AIInsight {
  id          String    @id @default(cuid())
  companyId   String
  insightType String    @default("COMPOSITE")
  severity    String    // LOW | MEDIUM | HIGH | CRITICAL
  title       String
  summary     String?
  data        Json      @default("{}")   // full statistical payload
  riskScore   Int       @default(0)      // 0-100
  windowStart DateTime?
  windowEnd   DateTime?
  llmEnriched Boolean   @default(false)
  isRead      Boolean   @default(false)
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  company     Company   @relation(...)
  modelUsages AIModelUsage[]

  @@map("ai_insights")
}
```

### `ai_model_usage`

Tracks every LLM API call (cost + token audit):

```prisma
model AIModelUsage {
  id               String   @id @default(cuid())
  companyId        String?
  model            String   // e.g. "gpt-4o-mini"
  promptTokens     Int
  completionTokens Int
  totalTokens      Int
  costUsd          Decimal?
  purpose          String   // "insight_summary"
  insightId        String?
  durationMs       Int?
  createdAt        DateTime @default(now())

  @@map("ai_model_usage")
}
```

### `ai_usage` (quota tracker)

Per-company quota + run counter:

```prisma
model AiUsage {
  id               String    @id @default(cuid())
  companyId        String    @unique
  totalRuns        Int       @default(0)
  totalInsights    Int       @default(0)
  tokensUsed       Int       @default(0)
  quotaRemaining   Int       @default(100)
  lastRunAt        DateTime?
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt

  @@map("ai_usage")
}
```

---

## Response Shapes (TypeScript DTOs)

```typescript
// GET /ai/insights  →  { success: true, data: { items, total, page, limit, totalPages } }
interface AiInsightDto {
  id: string;
  insightType: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  title: string;
  summary: string | null;
  riskScore: number;          // 0-100
  windowStart: string | null;
  windowEnd: string | null;
  llmEnriched: boolean;
  isRead: boolean;
  createdAt: string;
}

// POST /ai/run  →  { success: true, data: { ... } }
interface AiRunResultDto {
  insightId: string;
  riskScore: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  anomalyCount: number;
  trend: 'growing' | 'declining' | 'flat';
  sufficient: boolean;
  summary: string;
  llmEnriched: boolean;
  topAnomalies: Array<{ timestamp: string; value: number; zScore: number; severity: string }>;
}

// GET /ai/usage  →  { success: true, data: { ... } }
interface AiUsageDto {
  totalRuns: number;
  totalInsights: number;
  lastRunAt: string | null;
  tokensUsed: number;
  quotaRemaining: number;
}

// PATCH /ai/insights/:id/read  →  { success: true, data: { id, isRead: true } }
```

---

## POST /ai/run — Quota + Stub mode

```
1. Check ai_usage.quotaRemaining > 0  →  else 402
2. Run RunIntelligenceAnalysisUseCase (statistical engine — always runs)
3. If body.enrichWithLLM=true AND OPENAI_API_KEY is set  →  call OpenAIAdapter
4. Update ai_usage: totalRuns++, totalInsights += newInsights, tokensUsed += tokens
5. Return AiRunResultDto
```

**Stub mode** (`ENABLE_AI_ENGINE=false`): all 5 routes return `404`. No stubs are
inserted — the feature is completely invisible.

---

## Environment Variables

```dotenv
# ─── AI Intelligence Engine (Phase 3) ───────────────────────────────
ENABLE_AI_ENGINE=true          # false = all /ai/* routes return 404

# LLM enrichment (optional — statistical analysis always works without it)
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
OPENAI_MAX_TOKENS=400

# Quota per company per billing cycle (default 100)
AI_QUOTA_PER_COMPANY=100
```

> Add `ENABLE_AI_ENGINE=true` and optionally `OPENAI_API_KEY` in the Render
> environment panel to activate in production.

---

## Extending this feature

### Add a new insight type
1. Add the type string to `AIInsight.insightType` (no migration needed, it's a `VARCHAR`)
2. Add a new use-case class in `src/application/intelligence/`
3. Call it from `ai.controller.ts`

### Switch LLM provider (e.g. Anthropic Claude)
1. Create `src/infrastructure/ai/AnthropicAdapter.ts` mirroring `OpenAIAdapter.ts`
2. Add `ANTHROPIC_API_KEY` to `env.ts`
3. Swap the adapter instance in `ai.controller.ts`

### Add background job / async run
1. Set `Redis_ENABLED=true` and configure BullMQ
2. Enqueue a job in `POST /ai/run` and return `{ status: 'queued', jobId }`
3. Add a worker in `src/jobs/workers/ai-analysis.worker.ts`
