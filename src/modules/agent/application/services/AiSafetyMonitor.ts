// ─────────────────────────────────────────────────────────────────────────────
// AI Safety Monitor
//
// Logs every AI response to the AiSafetyLog table for safety auditing.
// Evaluates flagging rules:
//   • actionType not in whitelist
//   • confidenceScore < 0.6
//   • impactScore anomaly vs baseline
//
// NEVER blocks execution automatically — only logs and flags.
// ─────────────────────────────────────────────────────────────────────────────

import { PrismaClient } from "@prisma/client";
import { createHash } from "crypto";
import { isWhitelistedAction } from "../../domain/enums/ActionType";

export interface SafetyLogInput {
  companyId: string;
  insightId?: string;
  model: string;
  promptSnippet: string;
  completionSnippet: string;
  promptTokens?: number;
  completionTokens?: number;
  durationMs?: number;
  confidenceScore: number;
  actionType?: string;
  impactScore?: number;
}

export interface SafetyLogResult {
  id: string;
  flagged: boolean;
  verdict: string;
  safetyNotes: string | null;
}

export class AiSafetyMonitor {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Log an AI response and evaluate safety flags.
   * Never blocks execution — only records and flags.
   */
  async logAndEvaluate(input: SafetyLogInput): Promise<SafetyLogResult> {
    const promptHash = this.sha256(input.promptSnippet);
    const responseHash = this.sha256(input.completionSnippet);

    // Evaluate flagging rules
    const flags = this.evaluateFlags(input);
    const hallucinationRisk = this.estimateHallucinationRisk(
      input.confidenceScore,
    );

    const flagged =
      flags.whitelistViolation || flags.lowConfidence || flags.impactAnomaly;
    const verdict = flagged ? "WARNING" : "SAFE";

    const notes: string[] = [];
    if (flags.whitelistViolation)
      notes.push(`Action "${input.actionType}" not in whitelist`);
    if (flags.lowConfidence)
      notes.push(`Confidence ${input.confidenceScore.toFixed(2)} < 0.6`);
    if (flags.impactAnomaly)
      notes.push(`Impact score ${input.impactScore?.toFixed(2)} is anomalous`);

    const row = await this.prisma.aiSafetyLog.create({
      data: {
        companyId: input.companyId,
        insightId: input.insightId ?? null,
        model: input.model,
        promptHash,
        responseHash,
        promptSnippet: input.promptSnippet.slice(0, 2000),
        completionSnippet: input.completionSnippet.slice(0, 2000),
        promptTokens: input.promptTokens ?? 0,
        completionTokens: input.completionTokens ?? 0,
        durationMs: input.durationMs ?? null,
        confidenceScore: input.confidenceScore,
        hallucinationRiskScore: hallucinationRisk,
        flagged,
        flaggedHallucination: hallucinationRisk > 0.7,
        flaggedPolicyViolation: flags.whitelistViolation,
        flaggedPromptInjection: false,
        safetyNotes: notes.length > 0 ? notes.join("; ") : null,
        verdict,
      },
    });

    return {
      id: row.id,
      flagged,
      verdict,
      safetyNotes: notes.length > 0 ? notes.join("; ") : null,
    };
  }

  private evaluateFlags(input: SafetyLogInput): {
    whitelistViolation: boolean;
    lowConfidence: boolean;
    impactAnomaly: boolean;
  } {
    return {
      whitelistViolation: input.actionType
        ? !isWhitelistedAction(input.actionType)
        : false,
      lowConfidence: input.confidenceScore < 0.6,
      impactAnomaly: input.impactScore != null && input.impactScore > 0.9,
    };
  }

  private estimateHallucinationRisk(confidence: number): number {
    // Inverse relationship: lower confidence → higher hallucination risk
    return parseFloat(Math.max(0, Math.min(1, 1 - confidence)).toFixed(3));
  }

  private sha256(input: string): string {
    return createHash("sha256").update(input).digest("hex");
  }
}
