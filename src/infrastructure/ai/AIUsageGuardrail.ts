// ── AIUsageGuardrail ──────────────────────────────────────────────────────────
// Centralised AI usage limit enforcement.
//
// Rules:
//   1. Each company has a `monthlyLimit` and `monthlyUsed` on `ai_usage`.
//   2. Before every AI run, call `checkAndIncrement()`. If `monthlyUsed >=
//      monthlyLimit`, an AppError(402) is thrown.
//   3. A monthly reset function zeroes `monthlyUsed` and advances
//      `monthlyResetAt` — intended to be called from a cron job.
//
// The guardrail is independent of the legacy `quotaRemaining` counter so
// existing quota logic keeps working in parallel.

import { PrismaClient } from "@prisma/client";
import { AppError } from "../../shared/errors/AppError";
import { env } from "../../config/env";

export class AIUsageGuardrail {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Check whether the company has remaining monthly AI runs.
   * If yes, atomically increment `monthlyUsed` and return the new count.
   * If no, throw 402 (Payment Required).
   */
  async checkAndIncrement(
    companyId: string,
  ): Promise<{ monthlyUsed: number; monthlyLimit: number }> {
    // Ensure a row exists (first-run safe)
    const row = await this.prisma.aiUsage.upsert({
      where: { companyId },
      create: {
        companyId,
        quotaRemaining: env.AI_QUOTA_PER_COMPANY,
        monthlyLimit: 1000,
        monthlyUsed: 0,
        monthlyResetAt: this.nextResetDate(),
      },
      update: {},
    });

    // Auto-reset if the reset date has passed
    if (row.monthlyResetAt && row.monthlyResetAt <= new Date()) {
      const updated = await this.prisma.aiUsage.update({
        where: { companyId },
        data: {
          monthlyUsed: 1,
          monthlyResetAt: this.nextResetDate(),
        },
      });
      return {
        monthlyUsed: updated.monthlyUsed,
        monthlyLimit: updated.monthlyLimit,
      };
    }

    if (row.monthlyUsed >= row.monthlyLimit) {
      throw AppError.paymentRequired(
        `AI analysis monthly limit reached (${row.monthlyUsed}/${row.monthlyLimit}). ` +
          `The counter resets on ${row.monthlyResetAt?.toISOString().slice(0, 10) ?? "the next billing cycle"}.`,
      );
    }

    const updated = await this.prisma.aiUsage.update({
      where: { companyId },
      data: { monthlyUsed: { increment: 1 } },
    });

    return {
      monthlyUsed: updated.monthlyUsed,
      monthlyLimit: updated.monthlyLimit,
    };
  }

  /**
   * Reset monthly counters for ALL companies. Intended to be called from a
   * scheduled cron job (e.g. first of each month at 00:00 UTC).
   * Returns the number of rows reset.
   */
  async resetAllMonthlyCounters(): Promise<number> {
    const result = await this.prisma.aiUsage.updateMany({
      data: {
        monthlyUsed: 0,
        monthlyResetAt: this.nextResetDate(),
      },
    });
    return result.count;
  }

  /**
   * Reset a single company's monthly counter.
   */
  async resetForCompany(companyId: string): Promise<void> {
    await this.prisma.aiUsage.update({
      where: { companyId },
      data: {
        monthlyUsed: 0,
        monthlyResetAt: this.nextResetDate(),
      },
    });
  }

  // ── Helper ──────────────────────────────────────────────────────────────────

  /** Returns the first day of next month at 00:00 UTC */
  private nextResetDate(): Date {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  }
}
