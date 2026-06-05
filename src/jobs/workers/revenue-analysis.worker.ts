import { Worker, Job } from "bullmq";
import IORedis from "ioredis";
import { PrismaClient } from "@prisma/client";
import { JOB_QUEUES } from "../../config/constants";
import { env } from "../../config/env";
import pino from "pino";

const log = pino({ name: "revenue-worker", level: env.LOG_LEVEL });

interface RevenueAnalysisPayload {
  companyId: string;
  revenueId?: string;
  triggerType: "full_scan" | "incremental" | "single";
}

export function createRevenueAnalysisWorker(prisma: PrismaClient): Worker {
  const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });

  const worker = new Worker<RevenueAnalysisPayload>(
    JOB_QUEUES.REVENUE_ANALYSIS,
    async (job: Job<RevenueAnalysisPayload>) => {
      const { companyId, revenueId, triggerType } = job.data;
      log.info(
        { jobId: job.id, companyId, triggerType },
        "Processing revenue analysis job",
      );

      await prisma.jobLog
        .create({
          data: {
            companyId,
            jobName: JOB_QUEUES.REVENUE_ANALYSIS,
            jobId: job.id,
            status: "PROCESSING",
            payload: job.data as any,
            startedAt: new Date(),
          },
        })
        .catch(() => {});

      try {
        if (triggerType === "full_scan") {
          await runFullLeakageScan(prisma, companyId);
        } else if (triggerType === "single" && revenueId) {
          await analyzeRevenue(prisma, companyId, revenueId);
        } else {
          await runIncrementalScan(prisma, companyId);
        }

        await prisma.jobLog
          .updateMany({
            where: { jobId: job.id },
            data: { status: "COMPLETED", completedAt: new Date() },
          })
          .catch(() => {});

        log.info({ jobId: job.id, companyId }, "Revenue analysis completed");
      } catch (err) {
        await prisma.jobLog
          .updateMany({
            where: { jobId: job.id },
            data: {
              status: "FAILED",
              error: String(err),
              completedAt: new Date(),
            },
          })
          .catch(() => {});
        throw err;
      }
    },
    {
      connection,
      concurrency: 2,
      limiter: { max: 10, duration: 60_000 },
      settings: {
        // Equal-jitter custom backoff: wait in [cap/2, cap] where cap = min(60s, 2s × 2^attempt)
        // Prevents all failed workers from retrying at exactly the same instant.
        backoffStrategy: (attemptsMade: number) => {
          const cap = Math.min(60_000, 2_000 * Math.pow(2, attemptsMade));
          return Math.round(cap / 2 + Math.random() * (cap / 2));
        },
      },
    },
  );

  worker.on("failed", (job, err) => {
    log.error({ jobId: job?.id, err }, "Revenue analysis job failed");
  });

  return worker;
}

// ── Analysis Helpers ──────────────────────────────────────────────────────────

async function runFullLeakageScan(prisma: PrismaClient, companyId: string) {
  // Detect dunning failures: revenues without matching invoices (heuristic)
  const revenues = await prisma.revenue.findMany({
    where: { companyId },
    orderBy: { period: "desc" },
    take: 1000,
  });

  for (const revenue of revenues) {
    await analyzeRevenue(prisma, companyId, revenue.id);
  }
}

async function runIncrementalScan(prisma: PrismaClient, companyId: string) {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // last week
  const revenues = await prisma.revenue.findMany({
    where: { companyId, createdAt: { gte: since } },
  });

  for (const revenue of revenues) {
    await analyzeRevenue(prisma, companyId, revenue.id);
  }
}

async function analyzeRevenue(
  prisma: PrismaClient,
  companyId: string,
  revenueId: string,
) {
  const revenue = await prisma.revenue.findUnique({
    where: { id: revenueId },
    include: { leakages: true },
  });

  if (!revenue) return;

  const leakagesToCreate: Array<{
    category: string;
    title: string;
    description: string;
    amount: number;
    riskScore: number;
  }> = [];

  // Heuristic 1: Zero-amount revenue entry
  if (Number(revenue.amount) === 0) {
    leakagesToCreate.push({
      category: "INVOICE_ERROR",
      title: "Zero-amount revenue detected",
      description: `Revenue record ${revenueId} has zero amount.`,
      amount: 0,
      riskScore: 40,
    });
  }

  // Heuristic 2: Revenue without MRR/ARR set (potential pricing gap)
  if (!revenue.mrr && !revenue.arr && Number(revenue.amount) > 0) {
    leakagesToCreate.push({
      category: "PRICING_GAP",
      title: "Revenue missing MRR/ARR tracking",
      description:
        "MRR and ARR not recorded — revenue may not be properly tracked in forecasting.",
      amount: Number(revenue.amount) * 0.05, // 5% estimated leakage
      riskScore: 25,
    });
  }

  // Create detected leakages (skip if already exists for this revenue)
  const existingCategories = revenue.leakages.map((l) => l.category);

  for (const leakage of leakagesToCreate) {
    if (!existingCategories.includes(leakage.category as any)) {
      await prisma.revenueLeakage
        .create({
          data: {
            companyId,
            revenueId,
            category: leakage.category as any,
            title: leakage.title,
            description: leakage.description,
            amount: leakage.amount,
            riskScore: leakage.riskScore,
          },
        })
        .catch(() => {});
    }
  }
}
