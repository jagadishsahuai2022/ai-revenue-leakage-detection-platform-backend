/**
 * _example_migration.ts
 * ──────────────────────────────────────────────────────────────────────────────
 * Template / reference for writing a data migration.
 *
 * Files prefixed with _ are SKIPPED by run-data-migrations.ts.
 * Copy this file, remove the _ prefix, and give it a numbered name, e.g.:
 *
 *   001_backfill_mrr_arr.ts
 *
 * Rules:
 *   - Export exactly one async function named `run`.
 *   - Use the provided `prisma` client — do NOT instantiate a new one.
 *   - Keep the migration idempotent where possible (upsert / skip-if-exists).
 *   - Do NOT perform any destructive schema changes (use Prisma migrations for that).
 *   - Log progress using `console.log` or inject a logger if preferred.
 */

import { PrismaClient } from '@prisma/client';

export async function run(prisma: PrismaClient): Promise<void> {
  // Example: back-fill MRR / ARR for existing revenue records that have no value.
  const unset = await prisma.revenue.findMany({
    where: { mrr: null },
    select: { id: true, amount: true },
  });

  console.log(`[example] found ${unset.length} revenue records without MRR — back-filling`);

  for (const r of unset) {
    const amount = Number(r.amount);
    await prisma.revenue.update({
      where: { id: r.id },
      data: { mrr: amount / 12, arr: amount },
    });
  }

  console.log(`[example] back-fill complete`);
}
