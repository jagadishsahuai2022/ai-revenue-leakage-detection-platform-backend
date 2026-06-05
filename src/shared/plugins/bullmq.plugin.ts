import fp from "fastify-plugin";
import { FastifyInstance } from "fastify";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { JOB_QUEUES } from "../../config/constants";
import { env } from "../../config/env";

export type AppQueues = {
  [K in (typeof JOB_QUEUES)[keyof typeof JOB_QUEUES]]: Queue;
};

declare module "fastify" {
  interface FastifyInstance {
    queues?: AppQueues;
  }
}

async function bullmqPlugin(fastify: FastifyInstance): Promise<void> {
  if (!env.REDIS_ENABLED) {
    fastify.log.warn(
      "BullMQ is disabled (REDIS_ENABLED=false). Skipping queue initialization.",
    );
    return;
  }

  const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });

  const queues: Partial<AppQueues> = {};

  for (const name of Object.values(JOB_QUEUES)) {
    queues[name] = new Queue(name, {
      connection,
      defaultJobOptions: {
        attempts: 3,
        // 'custom' tells BullMQ to delegate delay calculation to the Worker's
        // backoffStrategy function (defined in each worker with equal jitter).
        backoff: { type: "custom", delay: 2000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 200 },
      },
    });
  }

  fastify.decorate("queues", queues as AppQueues);

  fastify.addHook("onClose", async () => {
    await Promise.all(Object.values(queues as AppQueues).map((q) => q.close()));
    await connection.quit();
  });

  fastify.log.info("✅ BullMQ queues initialized");
}

export default fp(bullmqPlugin, { name: "bullmq", dependencies: ["redis"] });
