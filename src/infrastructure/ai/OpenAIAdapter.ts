// ── OpenAIAdapter ─────────────────────────────────────────────────────────────
// Thin infrastructure adapter for the OpenAI Chat Completions API.
// Responsibilities:
//   • Accept a structured insight from the domain layer (NOT raw DB data)
//   • Build a concise, token-efficient prompt (no PII, no bulk data)
//   • Call OpenAI and return a plain-text explanation
//   • Track every call in AIModelUsage for cost auditing
//
// STRICT RULES:
//   • Never pass raw revenue records to the LLM
//   • Always enforce a max_tokens cap
//   • Fail gracefully (return null) if the API is unavailable

import { PrismaClient } from '@prisma/client';
import type { StructuredInsight } from '../../domain/intelligence/AIInsightGenerator';

export interface OpenAIAdapterConfig {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface EnrichmentResult {
  explanation: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  durationMs: number;
}

// Very rough cost table (USD per 1 K tokens) – update as pricing changes
const TOKEN_COST_PER_1K: Record<string, { prompt: number; completion: number }> = {
  'gpt-4o': { prompt: 0.005, completion: 0.015 },
  'gpt-4o-mini': { prompt: 0.00015, completion: 0.0006 },
  'gpt-3.5-turbo': { prompt: 0.0005, completion: 0.0015 },
};

const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_MAX_TOKENS = 400;

export class OpenAIAdapter {
  private readonly config: Required<OpenAIAdapterConfig>;

  constructor(
    private readonly prisma: PrismaClient,
    config: OpenAIAdapterConfig,
  ) {
    this.config = {
      model: DEFAULT_MODEL,
      maxTokens: DEFAULT_MAX_TOKENS,
      temperature: 0.3,
      ...config,
    };
  }

  /**
   * Generate a plain-text explanation from a structured insight and persist
   * token usage. Returns null if the API call fails.
   */
  async enrichInsight(
    insightId: string,
    companyId: string,
    insight: StructuredInsight,
  ): Promise<EnrichmentResult | null> {
    const prompt = this._buildPrompt(insight);
    const start = Date.now();

    try {
      const response = await this._callOpenAI(prompt);
      const durationMs = Date.now() - start;

      const usage = response.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
      const explanation: string =
        response.choices?.[0]?.message?.content?.trim() ?? insight.summary;

      const cost = this._computeCost(
        this.config.model,
        usage.prompt_tokens,
        usage.completion_tokens,
      );

      // Persist usage record
      await this.prisma.aIModelUsage.create({
        data: {
          companyId,
          model: this.config.model,
          promptTokens: usage.prompt_tokens,
          completionTokens: usage.completion_tokens,
          totalTokens: usage.total_tokens,
          costUsd: cost,
          purpose: 'insight_summary',
          insightId,
          durationMs,
        },
      });

      // Update the insight row with the LLM-generated summary
      await this.prisma.aIInsight.update({
        where: { id: insightId },
        data: { summary: explanation, llmEnriched: true },
      });

      return {
        explanation,
        model: this.config.model,
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
        costUsd: cost,
        durationMs,
      };
    } catch (err) {
      // Log but never crash the caller
      console.error('[OpenAIAdapter] enrichInsight failed:', err);
      return null;
    }
  }

  // ── Private ────────────────────────────────────────────────────────────────

  /**
   * Build a token-efficient prompt from the structured insight.
   * NEVER include raw revenue records, customer emails, or IDs.
   */
  private _buildPrompt(insight: StructuredInsight): string {
    const { riskScore, anomalyReport, forecastReport, topAnomalies, dataPoints } = insight;

    const anomalyLines = topAnomalies
      .slice(0, 3)
      .map(
        (a) =>
          `  - ${a.timestamp.toISOString().split('T')[0]}: value=${a.value}, z-score=${a.zScore}, severity=${a.severity}`,
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

  /** Raw fetch call to OpenAI – no SDK dependency */
  private async _callOpenAI(prompt: string): Promise<any> {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenAI API error ${res.status}: ${text}`);
    }

    return res.json();
  }

  private _computeCost(model: string, promptTokens: number, completionTokens: number): number {
    // Normalise model name: "gpt-4o-mini-2024-xx" → "gpt-4o-mini"
    const key = Object.keys(TOKEN_COST_PER_1K).find((k) => model.startsWith(k)) ?? '';
    const pricing = TOKEN_COST_PER_1K[key];
    if (!pricing) return 0;
    return (
      (promptTokens / 1000) * pricing.prompt +
      (completionTokens / 1000) * pricing.completion
    );
  }
}
