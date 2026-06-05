// ─────────────────────────────────────────────────────────────────────────────
// Connector Reliability: DLQ + Retry Service
//
// Provides:
//   • executeWithRetry() — generic exponential-backoff wrapper
//   • sendToDeadLetterQueue() — persist failed events for manual inspection
//   • replayDeadLetterEvent() — attempt to re-process a DLQ entry
//
// Works with the DeadLetterEvent Prisma model.
// ─────────────────────────────────────────────────────────────────────────────

import { PrismaClient } from "@prisma/client";
import { jitteredDelay } from "./jitter";

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** Multiplier for exponential growth (default: 2) */
  factor?: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
  factor: 2,
};

/**
 * Equal-jitter exponential backoff (AWS-recommended pattern).
 * Waits in [cap/2, cap] where cap = min(maxDelayMs, baseDelayMs × factor^attempt).
 * • Lower bound cap/2 prevents degenerate 0-ms retries.
 * • Upper bound cap keeps worst-case latency bounded.
 * • Random spread across cap/2 window prevents thundering-herd synchronisation.
 */
function backoffDelay(attempt: number, config: RetryConfig): Promise<void> {
  const ms = jitteredDelay(
    attempt,
    config.baseDelayMs,
    config.maxDelayMs,
    config.factor ?? 2,
  );
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute an async function with exponential-backoff retries.
 * On exhaustion, calls `onExhausted` (if provided) and throws the last error.
 */
export async function executeWithRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {},
  onExhausted?: (error: Error, attempts: number) => Promise<void>,
): Promise<T> {
  const cfg = { ...DEFAULT_RETRY_CONFIG, ...config };
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt < cfg.maxRetries) {
        await backoffDelay(attempt, cfg);
      }
    }
  }

  // All retries exhausted
  if (onExhausted && lastError) {
    await onExhausted(lastError, cfg.maxRetries + 1);
  }

  throw lastError;
}

/**
 * Persist a failed event to the dead-letter queue table.
 */
export async function sendToDeadLetterQueue(
  prisma: PrismaClient,
  params: {
    companyId: string;
    source: string;
    eventType: string;
    payload: Record<string, unknown>;
    error: string;
    retryCount: number;
  },
): Promise<string> {
  const dlq = await prisma.deadLetterEvent.create({
    data: {
      companyId: params.companyId,
      source: params.source,
      eventType: params.eventType,
      payload: params.payload as object,
      error: params.error,
      retryCount: params.retryCount,
    },
  });
  return dlq.id;
}

/**
 * Mark a dead-letter event as resolved after manual replay or dismissal.
 */
export async function resolveDeadLetterEvent(
  prisma: PrismaClient,
  dlqId: string,
  resolvedBy: string,
): Promise<void> {
  await prisma.deadLetterEvent.update({
    where: { id: dlqId },
    data: {
      resolved: true,
      resolvedAt: new Date(),
      resolvedBy,
    },
  });
}

/**
 * Replay a dead-letter event using the provided handler function.
 * On success, marks the event as resolved. On failure, updates the error.
 */
export async function replayDeadLetterEvent(
  prisma: PrismaClient,
  dlqId: string,
  handler: (payload: Record<string, unknown>) => Promise<void>,
  resolvedBy: string,
): Promise<{ success: boolean; error?: string }> {
  const dlq = await prisma.deadLetterEvent.findUniqueOrThrow({
    where: { id: dlqId },
  });

  try {
    await handler(dlq.payload as Record<string, unknown>);
    await resolveDeadLetterEvent(prisma, dlqId, resolvedBy);
    return { success: true };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await prisma.deadLetterEvent.update({
      where: { id: dlqId },
      data: {
        error: errorMsg,
        retryCount: { increment: 1 },
      },
    });
    return { success: false, error: errorMsg };
  }
}
