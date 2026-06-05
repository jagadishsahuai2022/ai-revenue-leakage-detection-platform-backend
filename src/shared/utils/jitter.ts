// ─────────────────────────────────────────────────────────────────────────────
// Jitter Utilities — Anti-Thundering-Herd Building Blocks
//
// ALL retry / polling / scheduling code in this codebase should use this module.
//
// Background:
//   When multiple clients (or workers) fail simultaneously and retry with the
//   same deterministic delay, they re-converge on the same request pattern and
//   hammer the downstream simultaneously again — a "thundering herd" / self-DoS.
//
// Recommended pattern: "Equal Jitter" (AWS Exponential Backoff & Jitter blog)
//   cap  = min(maxMs, baseMs × factor^attempt)
//   wait = cap/2 + random(0, cap/2)
//
// This ensures:
//   • We always wait at least cap/2  → no degenerate 0-ms retries
//   • Upper bound is still cap       → bounded worst-case latency
//   • Spread across a full cap/2 window → prevents synchronization
//
// Additional helpers:
//   • randomBetween(min, max)        → uniform jitter within a range
//   • sleepWithJitter(...)           → async sleep using equal jitter
//   • startupJitter(maxMs)           → random startup stagger for cron jobs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute an equal-jitter exponential-backoff delay.
 *
 * @param attempt   0-based retry attempt number
 * @param baseMs    Base delay (ms) before any exponential growth
 * @param maxMs     Hard cap on the computed delay
 * @param factor    Exponential growth factor (default 2)
 * @returns         Integer delay in milliseconds in [cap/2, cap]
 */
export function jitteredDelay(
  attempt: number,
  baseMs: number,
  maxMs: number,
  factor = 2,
): number {
  const cap = Math.min(maxMs, baseMs * Math.pow(factor, attempt));
  // Equal jitter: always at least half the cap, spread across the upper half
  return Math.round(cap / 2 + Math.random() * (cap / 2));
}

/**
 * Return a uniformly random integer in [min, max] (inclusive).
 * Use for one-off random ranges (e.g. logger flush interval spread).
 */
export function randomBetween(min: number, max: number): number {
  return Math.round(min + Math.random() * (max - min));
}

/**
 * Async sleep using equal-jitter exponential backoff.
 * Drop-in replacement for `await sleep(delay)` inside retry loops.
 *
 * @param attempt  0-based retry attempt number
 * @param baseMs   Base delay before exponential growth
 * @param maxMs    Hard cap on the resulting sleep
 * @param factor   Exponential factor (default 2)
 */
export function sleepWithJitter(
  attempt: number,
  baseMs: number,
  maxMs: number,
  factor = 2,
): Promise<void> {
  return new Promise((resolve) =>
    setTimeout(resolve, jitteredDelay(attempt, baseMs, maxMs, factor)),
  );
}

/**
 * Random startup stagger for cron / scheduled jobs.
 *
 * When multiple instances (dynos, replicas) start at the same second due to
 * a cron trigger, they will all hit the database at the same instant without
 * this stagger.  Sleeping a random duration within [0, maxMs] ensures they
 * spread their initial DB queries across the full window.
 *
 * @param maxMs  Maximum startup stagger in milliseconds (default 30 s)
 */
export function startupJitter(maxMs = 30_000): Promise<number> {
  const delayMs = Math.floor(Math.random() * maxMs);
  return new Promise((resolve) => setTimeout(() => resolve(delayMs), delayMs));
}
