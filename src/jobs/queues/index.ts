import { PrismaClient } from '@prisma/client';
import { Worker } from 'bullmq';
import { createRevenueAnalysisWorker } from '../workers/revenue-analysis.worker';
import { createNotificationWorker } from '../workers/notification.worker';

let workers: Worker[] = [];

export function startWorkers(prisma: PrismaClient): void {
  workers = [
    createRevenueAnalysisWorker(prisma),
    createNotificationWorker(prisma),
  ];
}

export async function stopWorkers(): Promise<void> {
  await Promise.all(workers.map((w) => w.close()));
  workers = [];
}
