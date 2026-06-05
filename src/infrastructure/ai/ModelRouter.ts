// ── ModelRouter ───────────────────────────────────────────────────────────────
// Provider-agnostic LLM caller that routes by the "provider/" prefix in modelId.
// Uses fetch() directly (no SDK dependencies) following the same pattern as
// OpenAIAdapter.  Supports all free-tier providers listed in the integration guide.
//
// Supported model ID formats:
//   groq/<model>                  → Groq Cloud (OpenAI-compatible)
//   gemini/<model>                → Google Generative AI REST API
//   mistral/<model>               → Mistral AI (OpenAI-compatible)
//   openrouter/<model>            → OpenRouter gateway (OpenAI-compatible)
//   openai/<model>                → OpenAI (legacy fallback)
//
// All providers support OpenAI-style messages except Gemini which has its own
// request/response shape – handled in the 'gemini' branch below.

import { PrismaClient } from '@prisma/client';
import type { StructuredInsight } from '../../domain/intelligence/AIInsightGenerator';

export interface ModelRouterConfig {
  maxTokens?: number;
  temperature?: number;
}

export interface EnrichmentResult {
  explanation: string;
  modelId: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  durationMs: number;
}

// ── Per-provider API base URLs ────────────────────────────────────────────────

const PROVIDER_ENDPOINTS: Record<string, string> = {
  groq:        'https://api.groq.com/openai/v1/chat/completions',
  mistral:     'https://api.mistral.ai/v1/chat/completions',
  openrouter:  'https://openrouter.ai/api/v1/chat/completions',
  openai:      'https://api.openai.com/v1/chat/completions',
};

// Very rough cost table (USD / 1K tokens) — update as pricing changes
const TOKEN_COST_PER_1K: Record<string, { prompt: number; completion: number }> = {
  'gpt-4o':                              { prompt: 0.005,    completion: 0.015   },
  'gpt-4o-mini':                         { prompt: 0.00015,  completion: 0.0006  },
  'gpt-3.5-turbo':                       { prompt: 0.0005,   completion: 0.0015  },
  'llama-3.1-8b-instant':                { prompt: 0.0000,   completion: 0.0000  }, // free
  'llama-3.3-70b-versatile':             { prompt: 0.0000,   completion: 0.0000  }, // free
  'mixtral-8x7b-32768':                  { prompt: 0.0000,   completion: 0.0000  }, // free
  'gemma2-9b-it':                        { prompt: 0.0000,   completion: 0.0000  }, // free
  'gemini-1.5-flash':                    { prompt: 0.0000,   completion: 0.0000  }, // free tier
  'gemini-2.0-flash':                    { prompt: 0.0000,   completion: 0.0000  }, // free tier
  'open-mistral-7b':                     { prompt: 0.0000,   completion: 0.0000  }, // free
  'mistral-small-latest':                { prompt: 0.0000,   completion: 0.0000  }, // free
};

// ── Main router class ─────────────────────────────────────────────────────────

export class ModelRouter {
  private readonly maxTokens: number;
  private readonly temperature: number;

  constructor(
    private readonly prisma: PrismaClient,
    config: ModelRouterConfig = {},
  ) {
    this.maxTokens   = config.maxTokens   ?? Number(process.env.AI_MAX_TOKENS  ?? 1024);
    this.temperature = config.temperature ?? Number(process.env.AI_TEMPERATURE ?? 0.3);
  }

  // ── Public interface ────────────────────────────────────────────────────────

  /**
   * Enrich an AIInsight row with an LLM-generated explanation.
   * Persists token usage to AIModelUsage and updates the insight summary.
   * Returns null on any failure so callers are never interrupted.
   */
  async enrichInsight(
    insightId: string,
    companyId: string,
    insight: StructuredInsight,
    modelId: string,
  ): Promise<EnrichmentResult | null> {
    const prompt = this._buildPrompt(insight);
    const start  = Date.now();

    try {
      const raw = await this._callModel(modelId, prompt);
      const durationMs = Date.now() - start;

      const usage       = raw.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
      const explanation = (raw.choices?.[0]?.message?.content as string | undefined)?.trim()
                       ?? insight.summary;

      const costUsd = this._computeCost(
        modelId,
        usage.prompt_tokens,
        usage.completion_tokens,
      );

      // Persist token usage
      await this.prisma.aIModelUsage.create({
        data: {
          companyId,
          model:            modelId,
          promptTokens:     usage.prompt_tokens,
          completionTokens: usage.completion_tokens,
          totalTokens:      usage.total_tokens,
          costUsd,
          purpose:    'insight_summary',
          insightId,
          durationMs,
        },
      });

      // Update insight with LLM summary + modelId
      await this.prisma.aIInsight.update({
        where: { id: insightId },
        data: { summary: explanation, llmEnriched: true, modelId },
      });

      return {
        explanation,
        modelId,
        promptTokens:     usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        totalTokens:      usage.total_tokens,
        costUsd,
        durationMs,
      };
    } catch (err) {
      console.error(`[ModelRouter] enrichInsight failed (model=${modelId}):`, err);
      return null;
    }
  }

  // ── Provider dispatch ───────────────────────────────────────────────────────

  private async _callModel(modelId: string, prompt: string): Promise<any> {
    const slashIdx = modelId.indexOf('/');
    if (slashIdx === -1) {
      throw new Error(`Invalid modelId format "${modelId}". Expected "provider/model".`);
    }

    const provider  = modelId.slice(0, slashIdx);          // e.g. "groq"
    const modelName = modelId.slice(slashIdx + 1);         // e.g. "llama-3.1-8b-instant"

    if (provider === 'gemini') {
      return this._callGemini(modelName, prompt);
    }

    // All other providers use the OpenAI Chat Completions format
    return this._callOpenAICompatible(provider, modelName, prompt);
  }

  // ── OpenAI-compatible (Groq, Mistral, OpenRouter, OpenAI) ─────────────────

  private async _callOpenAICompatible(
    provider: string,
    modelName: string,
    prompt: string,
  ): Promise<any> {
    const endpoint = PROVIDER_ENDPOINTS[provider];
    if (!endpoint) {
      throw new Error(`Unknown AI provider: "${provider}". Supported: ${Object.keys(PROVIDER_ENDPOINTS).join(', ')}`);
    }

    const apiKey = this._getApiKey(provider);
    if (!apiKey) {
      throw new Error(
        `No API key configured for provider "${provider}". ` +
        `Set ${providerEnvKey(provider)} in your .env file.`,
      );
    }

    const headers: Record<string, string> = {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`,
    };

    // OpenRouter requires these extra headers
    if (provider === 'openrouter') {
      headers['HTTP-Referer'] = process.env.APP_URL ?? 'http://localhost:3000';
      headers['X-Title']      = 'RevSecure Cloud';
    }

    const res = await fetch(endpoint, {
      method:  'POST',
      headers,
      body: JSON.stringify({
        model:      modelName,
        max_tokens: this.maxTokens,
        temperature: this.temperature,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${provider} API error ${res.status}: ${text}`);
    }

    return res.json();
  }

  // ── Google Gemini (different request/response schema) ─────────────────────

  private async _callGemini(modelName: string, prompt: string): Promise<any> {
    const apiKey = this._getApiKey('gemini');
    if (!apiKey) {
      throw new Error(
        'No API key configured for Gemini. Set GEMINI_API_KEY in your .env file.',
      );
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents:         [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: this.maxTokens, temperature: this.temperature },
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Gemini API error ${res.status}: ${text}`);
    }

    const geminiRes = await res.json() as any;

    // Normalise to OpenAI-style response shape so callers don't need to branch
    const text: string =
      geminiRes?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

    const usageMeta = geminiRes?.usageMetadata ?? {};

    return {
      choices: [{ message: { content: text } }],
      usage:   {
        prompt_tokens:     usageMeta.promptTokenCount     ?? 0,
        completion_tokens: usageMeta.candidatesTokenCount ?? 0,
        total_tokens:      usageMeta.totalTokenCount       ?? 0,
      },
    };
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private _getApiKey(provider: string): string | undefined {
    const envVar = providerEnvKey(provider);
    return process.env[envVar] || undefined;
  }

  private _computeCost(
    modelId: string,
    promptTokens: number,
    completionTokens: number,
  ): number {
    // Match by model name portion (after the provider prefix)
    const modelName = modelId.includes('/') ? modelId.split('/').slice(1).join('/') : modelId;
    const key = Object.keys(TOKEN_COST_PER_1K).find((k) => modelName.startsWith(k)) ?? '';
    const pricing = TOKEN_COST_PER_1K[key];
    if (!pricing) return 0;
    return (
      (promptTokens     / 1000) * pricing.prompt +
      (completionTokens / 1000) * pricing.completion
    );
  }

  /**
   * Build a token-efficient prompt from the structured insight.
   * NEVER includes raw revenue records, customer emails, or IDs.
   */
  private _buildPrompt(insight: StructuredInsight): string {
    const { riskScore, anomalyReport, forecastReport, topAnomalies, dataPoints } = insight;

    const anomalyLines = topAnomalies
      .slice(0, 3)
      .map(
        (a) =>
          `  - ${a.timestamp.toISOString().split('T')[0]}: value=${a.value.toFixed(2)}, z-score=${a.zScore.toFixed(2)}, severity=${a.severity}`,
      )
      .join('\n');

    return `You are a revenue intelligence assistant. Given the following analysis summary, write a concise 2–3 sentence explanation in plain English that a business owner can act on. Do NOT mention raw numbers beyond what is given. Do NOT make up data.

Analysis window: ${insight.windowStart.toISOString().split('T')[0]} – ${insight.windowEnd.toISOString().split('T')[0]}
Data points analysed: ${dataPoints}
Anomalies detected: ${anomalyReport.anomalyCount} of ${anomalyReport.totalPoints}
Risk score: ${riskScore.score}/100 (${riskScore.level})
Revenue trend: ${forecastReport.trend}${forecastReport.reliable ? ` (R²=${forecastReport.rSquared})` : ' (inconclusive)'}
Risk rationale: ${riskScore.rationale}
${topAnomalies.length > 0 ? `Top anomalies:\n${anomalyLines}` : ''}

Write a short, actionable summary.`;
  }
}

// ── Utility ───────────────────────────────────────────────────────────────────

/** Maps a provider slug to its environment variable name */
export function providerEnvKey(provider: string): string {
  const MAP: Record<string, string> = {
    groq:        'GROQ_API_KEY',
    gemini:      'GEMINI_API_KEY',
    mistral:     'MISTRAL_API_KEY',
    openrouter:  'OPENROUTER_API_KEY',
    openai:      'OPENAI_API_KEY',
  };
  return MAP[provider.toLowerCase()] ?? `${provider.toUpperCase()}_API_KEY`;
}

/** Returns a list of provider keys that have their API key configured */
export function configuredProviders(): string[] {
  return ['groq', 'gemini', 'mistral', 'openrouter', 'openai'].filter(
    (p) => !!process.env[providerEnvKey(p)],
  );
}
