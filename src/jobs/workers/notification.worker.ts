import { Worker, Job } from "bullmq";
import IORedis from "ioredis";
import { PrismaClient } from "@prisma/client";
import { JOB_QUEUES } from "../../config/constants";
import { env } from "../../config/env";
import pino from "pino";

const log = pino({ name: "notification-worker", level: env.LOG_LEVEL });

interface NotificationPayload {
  type: "email" | "slack";
  to: string;
  subject?: string;
  body: string;
  companyId?: string;
}

export function createNotificationWorker(prisma: PrismaClient): Worker {
  const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });

  const worker = new Worker<NotificationPayload>(
    JOB_QUEUES.NOTIFICATIONS,
    async (job: Job<NotificationPayload>) => {
      const { type, to, subject, body } = job.data;
      log.info({ jobId: job.id, type, to }, "Processing notification");

      switch (type) {
        case "email":
          // Integrate with sendgrid/resend/SES here
          log.info({ to, subject }, "[EMAIL] Would send email");
          break;
        case "slack":
          // Post to Slack webhook
          log.info({ to }, "[SLACK] Would send Slack message");
          break;
        default:
          log.warn({ type }, "Unknown notification type");
      }
    },
    {
      connection,
      concurrency: 5,
      settings: {
        // Equal-jitter custom backoff: wait in [cap/2, cap] where cap = min(60s, 2s × 2^attempt)
        backoffStrategy: (attemptsMade: number) => {
          const cap = Math.min(60_000, 2_000 * Math.pow(2, attemptsMade));
          return Math.round(cap / 2 + Math.random() * (cap / 2));
        },
      },
    },
  );

  worker.on("failed", (job, err) => {
    log.error({ jobId: job?.id, err }, "Notification job failed");
  });

  return worker;
}
