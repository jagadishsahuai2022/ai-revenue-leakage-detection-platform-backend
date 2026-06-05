// ─────────────────────────────────────────────────────────────────────────────
// AI Safety Logger
//
// Records every AI prompt/completion pair to the AiSafetyLog table.
// Runs lightweight heuristic checks for:
//   • Hallucination risk — numeric claims, percentage claims, money references
//   • Prompt injection attempts — common markers
//   • Policy violations — forbidden output patterns
//
// This is NOT a substitute for a dedicated ML-based moderation layer.
// It provides a baseline auditable record for compliance and debugging.
// ─────────────────────────────────────────────────────────────────────────────

import { PrismaClient } from '@prisma/client';

export type SafetyVerdict = 'SAFE' | 'WARNING' | 'BLOCKED';

export interface SafetyCheckResult {
  verdict: SafetyVerdict;
  flaggedHallucination: boolean;
  flaggedPolicyViolation: boolean;
  flaggedPromptInjection: boolean;
  safetyNotes: string[];
}

export interface AISafetyInput {
  companyId: string;
  model: string;
  prompt: string;
  completion: string;
  promptTokens: number;
  completionTokens: number;
  durationMs?: number;
  /** Optional soft-link to the AIInsight this safety check was generated for. */
  insightId?: string;
}

// ── Heuristic patterns ──────────────────────────────────────────────────────

/**
 * Patterns that suggest the model may be hallucinating (making up facts).
 * Not exhaustive — just the most common signals.
 */
const HALLUCINATION_PATTERNS = [
  /(?:as of|since|in)\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}/i,
  /\b(according to|studies show|research indicates|data confirms)\b/i,
  /\b\d{1,3}(?:\.\d{1,2})?%\s+(increase|decrease|growth|decline|drop|reduction|improvement)\b/i,
];

/**
 * Patterns for prompt injection attempts in the input.
 */
const PROMPT_INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /you\s+are\s+now\s+(a|an)\s+/i,
  /system\s*:\s*/i,
  /\bDAN\b.*\bmode\b/i,
  /do\s+anything\s+now/i,
  /\[system\]/i,
  /<<\s*SYS\s*>>/i,
];

/**
 * Patterns that violate output policy (e.g. generating code, SQL, scripts).
 */
const POLICY_VIOLATION_PATTERNS = [
  /DROP\s+TABLE/i,
  /DELETE\s+FROM\s+/i,
  /exec\s*\(/i,
  /eval\s*\(/i,
  /<script\b/i,
  /rm\s+-rf\s+/i,
];

// ── Check functions ─────────────────────────────────────────────────────────

function checkHallucination(completion: string): { flagged: boolean; notes: string[] } {
  const notes: string[] = [];
  for (const pattern of HALLUCINATION_PATTERNS) {
    if (pattern.test(completion)) {
      notes.push(`Potential hallucination detected: pattern "${pattern.source}"`);
    }
  }
  return { flagged: notes.length > 0, notes };
}

function checkPromptInjection(prompt: string): { flagged: boolean; notes: string[] } {
  const notes: string[] = [];
  for (const pattern of PROMPT_INJECTION_PATTERNS) {
    if (pattern.test(prompt)) {
      notes.push(`Prompt injection attempt detected: pattern "${pattern.source}"`);
    }
  }
  return { flagged: notes.length > 0, notes };
}

function checkPolicyViolation(completion: string): { flagged: boolean; notes: string[] } {
  const notes: string[] = [];
  for (const pattern of POLICY_VIOLATION_PATTERNS) {
    if (pattern.test(completion)) {
      notes.push(`Policy violation detected: pattern "${pattern.source}"`);
    }
  }
  return { flagged: notes.length > 0, notes };
}

// ── Main safety check ───────────────────────────────────────────────────────

export function runSafetyChecks(prompt: string, completion: string): SafetyCheckResult {
  const hallucination = checkHallucination(completion);
  const injection = checkPromptInjection(prompt);
  const policy = checkPolicyViolation(completion);

  const allNotes = [...hallucination.notes, ...injection.notes, ...policy.notes];

  // Determine verdict: BLOCKED if injection or policy violation, WARNING if hallucination
  let verdict: SafetyVerdict = 'SAFE';

  if (injection.flagged || policy.flagged) {
    verdict = 'BLOCKED';
  } else if (hallucination.flagged) {
    verdict = 'WARNING';
  }

  return {
    verdict,
    flaggedHallucination: hallucination.flagged,
    flaggedPolicyViolation: policy.flagged,
    flaggedPromptInjection: injection.flagged,
    safetyNotes: allNotes,
  };
}

// ── Logger ──────────────────────────────────────────────────────────────────

/**
 * Log an AI interaction to the AiSafetyLog table.
 * Truncates prompt/completion to 2000 chars for storage.
 * Returns the safety check result.
 */
export async function logAISafety(
  prisma: PrismaClient,
  input: AISafetyInput,
): Promise<SafetyCheckResult> {
  const check = runSafetyChecks(input.prompt, input.completion);

  try {
    await prisma.aiSafetyLog.create({
      data: {
        companyId: input.companyId,
        model: input.model,
        insightId: input.insightId ?? null,
        promptSnippet: input.prompt.slice(0, 2000),
        completionSnippet: input.completion.slice(0, 2000),
        promptTokens: input.promptTokens,
        completionTokens: input.completionTokens,
        durationMs: input.durationMs ?? null,
        flaggedHallucination: check.flaggedHallucination,
        flaggedPolicyViolation: check.flaggedPolicyViolation,
        flaggedPromptInjection: check.flaggedPromptInjection,
        safetyNotes: check.safetyNotes.join('\n') || null,
        verdict: check.verdict,
      },
    });
  } catch (err) {
    // Never let safety logging failure break the main flow
    console.error('[AISafetyLogger] Failed to persist safety log:', err);
  }

  return check;
}
