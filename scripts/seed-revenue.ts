/**
 * scripts/seed-revenue.ts
 * Seeds 60 days of daily revenue data for every company that has fewer than 10 revenue rows.
 * Usage: npx tsx scripts/seed-revenue.ts
 * Optional: SEED_COMPANY_ID=xxx npx tsx scripts/seed-revenue.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Find companies that need revenue data
  const companies = await prisma.company.findMany({
    where: process.env.SEED_COMPANY_ID
      ? { id: process.env.SEED_COMPANY_ID }
      : undefined,
    select: { id: true, name: true },
  });

  const since30 = new Date();
  since30.setDate(since30.getDate() - 30);

  for (const company of companies) {
    // Count rows within the AI analysis window (last 30 days)
    const recentRows = await prisma.revenue.count({
      where: { companyId: company.id, period: { gte: since30 } },
    });
    if (recentRows >= 10) {
      console.log(`⏭  ${company.name} (${company.id}) already has ${recentRows} rows in last 30 days — skipping`);
      continue;
    }

    console.log(`🌱 Seeding 60 days of revenue for: ${company.name} (${company.id}) [had ${recentRows} recent rows]`);

    const rows = [];
    const now = new Date();
    // Baseline MRR in cents: random between $8k–$25k
    const baseMRR = Math.floor(Math.random() * 17_000 + 8_000) * 100;

    for (let i = 59; i >= 0; i--) {
      const period = new Date(now);
      period.setDate(period.getDate() - i);
      period.setHours(0, 0, 0, 0);

      // Add some realistic variation: ±15% noise + occasional spike/dip
      const noise = (Math.random() - 0.5) * 0.15;
      const spike = Math.random() < 0.05 ? (Math.random() < 0.5 ? 1.3 : 0.7) : 1.0;
      const dailyAmount = Math.round(baseMRR * (1 + noise) * spike);

      rows.push({
        companyId: company.id,
        source: 'MANUAL',
        currency: 'USD',
        amount: dailyAmount,
        mrr: baseMRR,
        arr: baseMRR * 12,
        period,
        metadata: { seededBy: 'scripts/seed-revenue.ts' } as any,
      });
    }

    await prisma.revenue.createMany({ data: rows, skipDuplicates: true });
    console.log(`   ✅ Created ${rows.length} revenue rows`);
  }

  // Summary
  const summary = await prisma.$queryRaw<{ name: string; rows: number }[]>`
    SELECT c.name, COUNT(r.id)::int AS rows
    FROM "Company" c
    LEFT JOIN "Revenue" r ON r."companyId" = c.id
    GROUP BY c.name
    ORDER BY c.name
  `;
  console.log('\n📊 Revenue rows per company:');
  for (const row of summary) {
    console.log(`   ${row.name}: ${row.rows}`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
