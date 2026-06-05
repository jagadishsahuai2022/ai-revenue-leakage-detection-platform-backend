// ── AgentAIClient ─────────────────────────────────────────────────────────────
// Calls the configured LLM provider with a structured prompt derived from an
// AIInsight row, and parses the JSON proposals array from the response.
//
// Falls back to AI_DEFAULT_MODEL ('groq/llama-3.1-8b-instant') if no modelId
// is provided.  Never persists anything — that's the repository's job.

import { providerEnvKey } from "../../../../infrastructure/ai/ModelRouter";
import type { ActionType } from "../../domain/enums/ActionType";

export interface RawProposal {
  actionType: string;
  priorityScore: number;
  confidenceScore: number;
  estimatedImpact: number;
  payload: Record<string, unknown>;
  rationale: string;
}

export interface InsightRow {
  id: string;
  insightType: string;
  severity: string;
  title: string;
  summary: string | null;
  data: unknown;
  riskScore: number;
}

const PROVIDER_ENDPOINTS: Record<string, string> = {
  groq: "https://api.groq.com/openai/v1/chat/completions",
  mistral: "https://api.mistral.ai/v1/chat/completions",
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
  openai: "https://api.openai.com/v1/chat/completions",
};

const DEFAULT_MODEL =
  process.env.AI_DEFAULT_MODEL ?? "groq/llama-3.1-8b-instant";
const MAX_TOKENS = 2048; // increased from 1024 — gives room for 5-7 detailed proposals
const TEMPERATURE = 0.2;

export class AgentAIClient {
  async generateProposals(
    insight: InsightRow,
    modelId?: string,
  ): Promise<RawProposal[]> {
    const targetModel = modelId ?? DEFAULT_MODEL;
    const prompt = this._buildPrompt(insight);

    try {
      const responseText = await this._call(targetModel, prompt);
      return this._parse(responseText);
    } catch (err) {
      // Re-throw so the caller can surface a clear error to the user.
      // All proposals must be AI-generated from real insight data — no fake fallbacks.
      console.error("[AgentAIClient] generateProposals error:", err);
      throw err;
    }
  }

  // ── Prompt ────────────────────────────────────────────────────────────────

  private _buildPrompt(insight: InsightRow): string {
    // Provide up to 2000 chars of the structured data payload so the LLM has
    // enough context to calculate real impact numbers and vary proposal types.
    const dataSummary =
      typeof insight.data === "object" && insight.data !== null
        ? JSON.stringify(insight.data).slice(0, 2000)
        : "{}";

    // Extract a concrete revenue/leakage figure from the data payload so we
    // can give the LLM an explicit number to base estimatedImpact on.
    const insightData =
      typeof insight.data === "object" && insight.data !== null
        ? (insight.data as Record<string, unknown>)
        : {};
    const leakageAmount = Number(
      insightData["leakageEstimate"] ??
        insightData["estimatedLeakage"] ??
        insightData["totalRevenue"] ??
        0,
    );
    const impactHint =
      leakageAmount > 0
        ? `The insight data contains a measurable revenue/leakage figure of approximately $${leakageAmount.toFixed(2)} USD. Use this as the basis for estimatedImpact.`
        : `No explicit leakage figure is available. Use a conservative estimate: riskScore/100 × average monthly revenue if you can infer it from the data, or at minimum $${Math.max(100, insight.riskScore * 20)} USD.`;

    // Minimum 5 proposals are required for every risk level so the agent page
    // always surfaces actionable choices. Higher risk = more distinct strategies.
    const countHint =
      insight.riskScore >= 75
        ? "This is a CRITICAL risk — generate exactly 6 to 7 distinct, high-priority proposals covering diverse intervention strategies (retry, email, flag, invoice, disable, notify)."
        : insight.riskScore >= 50
          ? "This is HIGH risk — generate exactly 5 to 6 well-targeted proposals addressing different recovery dimensions (payment retry, collection emails, account flags, invoice actions, finance alerts)."
          : insight.riskScore >= 25
            ? "This is MEDIUM risk — generate exactly 5 proposals covering the most impactful recovery actions across at least 3 different actionType categories."
            : "This is LOW risk — generate exactly 5 focused, conservative proposals using the data available; prioritise low-disruption action types (email, notify, flag).";

    return `You are a revenue operations AI agent. Analyse the insight below and return a JSON array of action proposals.

CRITICAL REQUIREMENT: You MUST return a minimum of 5 proposals. Returning fewer than 5 proposals is an error.

Insight:
- Type: ${insight.insightType}
- Severity: ${insight.severity}
- Title: ${insight.title}
- Summary: ${insight.summary ?? "N/A"}
- Risk Score: ${insight.riskScore}/100
- Full Data: ${dataSummary}

Count guideline: ${countHint}
IMPORTANT: Only include proposals that are genuinely supported by the insight data above.
Do NOT pad to reach a maximum number — quality over quantity.
YOU MAY generate multiple proposals with the same actionType IF they target meaningfully 
different customer segments, risk profiles, or scenarios (e.g., "RETRY_PAYMENT for high-value 
customers" vs "RETRY_PAYMENT for at-risk churners" are both valid). Ensure each has distinct 
payload parameters that clearly differentiate the target scope or strategy.

Each proposal must be a JSON object with EXACTLY these fields:
{
  "actionType": one of [RETRY_PAYMENT, SEND_COLLECTION_EMAIL, FLAG_HIGH_RISK_ACCOUNT, GENERATE_INVOICE, DISABLE_SUBSCRIPTION, NOTIFY_FINANCE_TEAM],
  "priorityScore": integer 0-100 reflecting actual urgency from the data,
  "confidenceScore": float 0.0-1.0 (be honest — below 0.6 blocks execution),
  "estimatedImpact": positive integer USD amount (MUST be >= 100, NEVER return 0),
  "payload": { action-specific parameters only, no PII, no code },
  "rationale": "One sentence grounded specifically in the insight data above"
}

Rules:
- Return ONLY the JSON array — no markdown fences, no text before or after the array
- estimatedImpact MUST be a positive integer >= 100. ${impactHint}
- NEVER return estimatedImpact as 0 — if genuinely unknown, use a conservative positive estimate
- confidenceScore must reflect genuine certainty; use values below 0.6 when data is insufficient
- payload values must be safe, static configuration — no dynamic code or credentials
- Multiple proposals with the same actionType are ALLOWED if they target distinct segments or scenarios

Example (HIGH-risk insight with failed payments across multiple customer segments):
[
  {
    "actionType": "RETRY_PAYMENT",
    "priorityScore": 92,
    "confidenceScore": 0.85,
    "estimatedImpact": 12500,
    "payload": { "segment": "high_value", "mrrThreshold": 1000, "retryStrategy": "immediate" },
    "rationale": "High-value customers (>$1000 MRR) with recent payment failures have 85% recovery rate if retried within 24h."
  },
  {
    "actionType": "RETRY_PAYMENT",
    "priorityScore": 78,
    "confidenceScore": 0.79,
    "estimatedImpact": 6800,
    "payload": { "segment": "at_risk", "failureCount": 3, "retryStrategy": "staged" },
    "rationale": "Customers with 3+ consecutive failures need staged retry approach to avoid permanent churn."
  },
  {
    "actionType": "SEND_COLLECTION_EMAIL",
    "priorityScore": 65,
    "confidenceScore": 0.71,
    "estimatedImpact": 3200,
    "payload": { "templateId": "payment_failed_urgent", "segment": "enterprise" },
    "rationale": "Enterprise accounts respond better to personalized collection emails before automated retry."
  },
  {
    "actionType": "FLAG_HIGH_RISK_ACCOUNT",
    "priorityScore": 88,
    "confidenceScore": 0.82,
    "estimatedImpact": 4500,
    "payload": { "riskThreshold": 0.75, "alertTeam": true },
    "rationale": "Accounts with 75%+ risk score require immediate manual review to prevent churn."
  }
]`;
  }

  // ── LLM call (replicates ModelRouter pattern) ─────────────────────────────

  private async _call(modelId: string, prompt: string): Promise<string> {
    const slashIdx = modelId.indexOf("/");
    if (slashIdx === -1) {
      throw new Error(
        `Invalid modelId "${modelId}". Expected "provider/model".`,
      );
    }

    const provider = modelId.slice(0, slashIdx);
    const modelName = modelId.slice(slashIdx + 1);

    if (provider === "gemini") {
      return this._callGemini(modelName, prompt);
    }

    const endpoint = PROVIDER_ENDPOINTS[provider];
    if (!endpoint) {
      throw new Error(`Unknown provider "${provider}".`);
    }

    const apiKey = process.env[providerEnvKey(provider)];
    if (!apiKey) {
      throw new Error(
        `No API key for provider "${provider}". Set ${providerEnvKey(provider)}.`,
      );
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    };
    if (provider === "openrouter") {
      headers["HTTP-Referer"] = process.env.APP_URL ?? "http://localhost:3000";
      headers["X-Title"] = "RevSecure Cloud";
    }

    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: modelName,
        max_tokens: MAX_TOKENS,
        temperature: TEMPERATURE,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${provider} API error ${res.status}: ${text}`);
    }

    const json = (await res.json()) as any;
    return (json.choices?.[0]?.message?.content as string | undefined) ?? "";
  }

  private async _callGemini(
    modelName: string,
    prompt: string,
  ): Promise<string> {
    const apiKey = process.env["GEMINI_API_KEY"];
    if (!apiKey) throw new Error("GEMINI_API_KEY not set.");

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: MAX_TOKENS,
          temperature: TEMPERATURE,
        },
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Gemini API error ${res.status}: ${text}`);
    }
    const json = (await res.json()) as any;
    return json?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  }

  // ── JSON parser ───────────────────────────────────────────────────────────

  private _parse(raw: string): RawProposal[] {
    // Strip markdown fences if present
    const cleaned = raw
      .replace(/```json\s*/gi, "")
      .replace(/```\s*/g, "")
      .trim();

    // Find the outermost JSON array
    const start = cleaned.indexOf("[");
    const end = cleaned.lastIndexOf("]");
    if (start === -1 || end === -1) {
      console.warn("[AgentAIClient] No JSON array found in LLM response.");
      return [];
    }

    const jsonStr = cleaned.slice(start, end + 1);

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (err) {
      console.warn("[AgentAIClient] JSON parse error:", err);
      return [];
    }

    if (!Array.isArray(parsed)) return [];

    return parsed.filter((item): item is RawProposal => {
      return (
        typeof item === "object" &&
        item !== null &&
        typeof (item as any).actionType === "string" &&
        typeof (item as any).priorityScore === "number" &&
        typeof (item as any).confidenceScore === "number" &&
        typeof (item as any).estimatedImpact === "number"
      );
    });
  }
}
