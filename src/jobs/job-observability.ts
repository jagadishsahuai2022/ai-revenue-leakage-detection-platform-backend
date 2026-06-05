// ─────────────────────────────────────────────────────────────────────────────
// Job Observability Wrapper
//
// Provides a standard `observableProcessor` wrapper that:
//   • Creates a JobLog row with status PROCESSING on entry
//   • Updates to COMPLETED/FAILED on exit
//   • Captures durationMs, error messages, and result payload
//   • Emits structured pino log lines for centralized log aggregation
//
// Usage:
//   new Worker('queue', observableProcessor(prisma, 'queue-name', handler), opts);
// ─────────────────────────────────────────────────────────────────────────────

import { Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import pino from 'pino';
import { env } from '../config/env';

const log = pino({ name: 'job-observability', level: env.LOG_LEVEL });

export type JobProcessor<T, R = unknown> = (job: Job<T>) => Promise<R>;

/**
 * Wraps a BullMQ job processor with observability (JobLog + structured logs).
 * @param prisma    Prisma client
 * @param jobName   Logical job name (matches JOB_QUEUES constant)
 * @param processor The actual work function
 */
export function observableProcessor<T, R = unknown>(
  prisma: PrismaClient,
  jobName: string,
  processor: JobProcessor<T, R>,
): (job: Job<T>) => Promise<R> {
  return async (job: Job<T>): Promise<R> => {
    const companyId = (job.data as Record<string, unknown>).companyId as string | undefined;
    const startedAt = new Date();
    const startMs = performance.now();

    // Create initial log entry
    let logId: string | undefined;
    try {
      const logRow = await prisma.jobLog.create({
        data: {
          companyId: companyId ?? null,
          jobName,
          jobId: job.id ?? null,
          status: 'PROCESSING',
          payload: job.data as object,
          startedAt,
        },
      });
      logId = logRow.id;
    } catch (err) {
      log.warn({ err, jobName, jobId: job.id }, 'Failed to create JobLog entry');
    }

    log.info(
      { jobName, jobId: job.id, companyId, attemptsMade: job.attemptsMade },
      `Job started: ${jobName}`,
    );

    try {
      const result = await processor(job);
      const durationMs = Math.round(performance.now() - startMs);

      log.info(
        { jobName, jobId: job.id, companyId, durationMs },
        `Job completed: ${jobName} in ${durationMs}ms`,
      );

      // Update log entry
      if (logId) {
        await prisma.jobLog.update({
          where: { id: logId },
          data: {
            status: 'COMPLETED',
            result: result !== undefined && result !== null ? (result as object) : undefined,
            completedAt: new Date(),
          },
        }).catch((err) => log.warn({ err }, 'Failed to update JobLog to COMPLETED'));
      }

      return result;
    } catch (err) {
      const durationMs = Math.round(performance.now() - startMs);
      const errorMessage = err instanceof Error ? err.message : String(err);

      log.error(
        { jobName, jobId: job.id, companyId, durationMs, err },
        `Job failed: ${jobName} after ${durationMs}ms — ${errorMessage}`,
      );

      // Update log entry
      if (logId) {
        await prisma.jobLog.update({
          where: { id: logId },
          data: {
            status: 'FAILED',
            error: errorMessage,
            completedAt: new Date(),
          },
        }).catch((e) => log.warn({ err: e }, 'Failed to update JobLog to FAILED'));
      }

      throw err; // Re-throw so BullMQ can handle retries
    }
  };
}

/**
 * Get job statistics for observability dashboard.
 */
export async function getJobStats(
  prisma: PrismaClient,
  filters?: { companyId?: string; jobName?: string; since?: Date },
) {
  const where: Record<string, unknown> = {};
  if (filters?.companyId) where.companyId = filters.companyId;
  if (filters?.jobName) where.jobName = filters.jobName;
  if (filters?.since) where.createdAt = { gte: filters.since };

  const [total, completed, failed, processing] = await Promise.all([
    prisma.jobLog.count({ where }),
    prisma.jobLog.count({ where: { ...where, status: 'COMPLETED' } }),
    prisma.jobLog.count({ where: { ...where, status: 'FAILED' } }),
    prisma.jobLog.count({ where: { ...where, status: 'PROCESSING' } }),
  ]);

  return {
    total,
    completed,
    failed,
    processing,
    successRate: total > 0 ? Math.round((completed / total) * 10000) / 100 : 0,
  };
}
