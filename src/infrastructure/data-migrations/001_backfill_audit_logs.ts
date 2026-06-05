/**
 * Data Migration: 001_backfill_audit_logs
 *
 * Backfills actorId, actorEmail, actorName, resourceType, and detail fields
 * on existing AuditLog rows that were created before the actor fields were added.
 *
 * - Rows that already have actorEmail set are skipped (idempotent).
 * - actorId / actorEmail / actorName are populated from the legacy userId FK
 *   (which was removed from the schema but the raw column still exists as actorId = userId).
 * - resourceType is set to the legacy `resource` column value.
 * - detail is set to a generic message combining action + resource.
 *
 * Run via:  npm run db:migrate:data
 */

import { PrismaClient } from '@prisma/client';

export async function run(prisma: PrismaClient): Promise<void> {
  // Find all audit logs that are missing the new actor fields
  const staleRows = await (prisma as any).$queryRaw<
    Array<{ id: string; action: string; resource: string; actorId: string | null }>
  >`
    SELECT id, action, resource, "actorId"
    FROM "AuditLog"
    WHERE "actorEmail" IS NULL
    LIMIT 1000
  `;

  if (staleRows.length === 0) {
    console.log('  ✓ No stale AuditLog rows to backfill');
    return;
  }

  console.log(`  → Backfilling ${staleRows.length} AuditLog rows …`);

  for (const row of staleRows) {
    let actorEmail: string | null = null;
    let actorName: string | null = null;

    // Try to resolve actor from User table if actorId is set
    if (row.actorId) {
      const user = await prisma.user.findUnique({
        where: { id: row.actorId },
        select: { email: true, name: true },
      });
      if (user) {
        actorEmail = user.email;
        actorName = user.name;
      }
    }

    await (prisma as any).$executeRaw`
      UPDATE "AuditLog"
      SET
        "actorEmail"   = ${actorEmail},
        "actorName"    = ${actorName},
        "resourceType" = ${row.resource ?? null},
        "detail"       = ${`${row.action} on ${row.resource}`}
      WHERE id = ${row.id}
    `;
  }

  console.log(`  ✓ Backfilled ${staleRows.length} AuditLog rows`);
}
