/**
 * seed-health-records.ts
 *
 * Creates initial HEALTHY connector_health rows for every ACTIVE ProviderConnection
 * that doesn't already have one. Safe to run multiple times (upsert no-op).
 *
 * Run against local:  npx tsx scripts/seed-health-records.ts
 * Run against Neon:   DATABASE_URL="neon-url" npx tsx scripts/seed-health-records.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ log: ['error'] });

async function main() {
  const active = await prisma.providerConnection.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, companyId: true, provider: true },
  });

  if (active.length === 0) {
    console.log('No ACTIVE connections found.');
    return;
  }

  console.log(`Found ${active.length} ACTIVE connection(s). Seeding health records…`);

  let created = 0;
  let skipped = 0;

  for (const conn of active) {
    const result = await prisma.connectorHealth.upsert({
      where: { companyId_provider: { companyId: conn.companyId, provider: conn.provider } },
      create: {
        companyId: conn.companyId,
        provider: conn.provider,
        status: 'HEALTHY',
        errorRate: 0,
        avgLatencyMs: 0,
        consecutiveFailures: 0,
        lastError: null,
        lastSyncAt: null,
      },
      update: {}, // no-op if already exists
    });

    // upsert returns the row; check if it was just created by comparing timestamps
    const wasCreated =
      Math.abs(result.createdAt.getTime() - result.updatedAt.getTime()) < 100;
    if (wasCreated) {
      console.log(`  ✓ Created HEALTHY record for ${conn.provider} (company ${conn.companyId})`);
      created++;
    } else {
      console.log(`  – ${conn.provider} already has a health record, skipped`);
      skipped++;
    }
  }

  console.log(`\nDone: ${created} created, ${skipped} already existed.`);

  // Verify: show current health records
  const all = await prisma.connectorHealth.findMany({
    select: { provider: true, status: true, errorRate: true, avgLatencyMs: true },
  });
  console.log('\nHealth records in DB:');
  for (const h of all) {
    console.log(`  ${h.provider}: ${h.status} (errorRate=${h.errorRate}, latency=${h.avgLatencyMs}ms)`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
