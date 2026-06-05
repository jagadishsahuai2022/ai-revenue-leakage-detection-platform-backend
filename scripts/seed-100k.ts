/**
 * scripts/seed-100k.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Idempotent 100 000-record seed optimised for AI analysis testing.
 *
 * What gets seeded (all into the Demo Company tenant):
 *   ~80 000  Revenue   – 500 customers × ~160 daily records over 730 days
 *                        with growth trend, seasonality, anomalies & churn events
 *   ~20 000  Invoice   – 500 customers × ~40 invoices, realistic statuses
 *   ─────────────────────────────────────────────────────
 *   ~100 000  total rows
 *
 * AI patterns embedded in the data:
 *   • Global MRR growth trend (+0.04 % / day)
 *   • Monthly seasonality (end-of-quarter spikes, summer dip)
 *   • Per-customer lifecycle: trial → growth → plateau → optional churn
 *   • Random anomaly days (±40 % spike / drop, ~3 % probability)
 *   • 3 customer tiers: STARTER / GROWTH / ENTERPRISE with different MRR bands
 *   • 15 % of customers churn mid-way (revenue drops to 0 after churn date)
 *   • 10 % of customers upgrade (MRR doubles at upgrade date)
 *
 * Usage:
 *   npx tsx scripts/seed-100k.ts
 *   WIPE=true npx tsx scripts/seed-100k.ts   ← clears PREFIX rows first
 *
 * Safe to re-run (skipDuplicates / unique externalId prefix "100k-").
 */

import { PrismaClient, LeakageCategory } from '@prisma/client';

const prisma = new PrismaClient();
const WIPE = process.env.WIPE === 'true';

// ── Constants ─────────────────────────────────────────────────────────────────

const SEED_PREFIX = '100k';
const CUSTOMERS_COUNT = 500;
const DAYS_HISTORY = 730;         // 2 years of daily records per customer sample
const REVENUE_SAMPLE_DAYS = 160;  // each customer gets ~160 sampled days → 500×160 = 80 000
const INVOICES_PER_CUSTOMER = 40; // 500×40 = 20 000

// ── Helpers ───────────────────────────────────────────────────────────────────

const rand = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;
const randFloat = (min: number, max: number) =>
  +(Math.random() * (max - min) + min).toFixed(2);
const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

const daysAgo = (n: number): Date => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
};

const dateAddDays = (base: Date, days: number): Date => {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
};

/** Seasonal multiplier based on month (0-based) */
const seasonalMultiplier = (month: number): number => {
  // Q1 strong, summer dip, Q4 spike
  const base = [1.05, 1.02, 1.08, 1.0, 0.97, 0.93, 0.90, 0.92, 0.98, 1.03, 1.07, 1.12];
  return base[month] ?? 1.0;
};

async function batchInsert<T>(
  label: string,
  items: T[],
  inserter: (batch: T[]) => Promise<{ count: number }>,
  batchSize = 1_000,
): Promise<number> {
  let inserted = 0;
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const r = await inserter(batch);
    inserted += r.count;
    process.stdout.write(`\r  ↳  ${label}: ${inserted.toLocaleString()} / ${items.length.toLocaleString()} rows`);
  }
  console.log(`\r  ✅  ${label}: ${inserted.toLocaleString()} rows inserted (${items.length.toLocaleString()} attempted)`);
  return inserted;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🌱  Starting 100k AI-analysis seed…\n');

  // ── 0. Find / create demo company ───────────────────────────────────────────
  const company = await prisma.company.upsert({
    where: { slug: 'demo' },
    create: {
      name: 'Demo Company',
      slug: 'demo',
      plan: 'GROWTH',
      subscriptionStatus: 'ACTIVE',
      billingEmail: 'admin@democompany.io',
    },
    update: {},
  });
  const companyId = company.id;
  console.log(`🏢  Company: ${company.name} (${companyId})\n`);

  // ── WIPE mode (only rows with our prefix to avoid nuking other seeds) ────────
  if (WIPE) {
    console.log('🗑   WIPE=true — removing 100k-prefixed rows…');
    // Revenue: externalId starts with our prefix
    const deleted = await prisma.$executeRawUnsafe(
      `DELETE FROM "Revenue" WHERE "companyId" = $1 AND "externalId" LIKE $2`,
      companyId,
      `${SEED_PREFIX}-%`,
    );
    // Invoices: stripeInvoiceId starts with our prefix  
    const delInv = await prisma.$executeRawUnsafe(
      `DELETE FROM "Invoice" WHERE "companyId" = $1 AND "stripeInvoiceId" LIKE $2`,
      companyId,
      `in_${SEED_PREFIX}_%`,
    );
    console.log(`  ✅  Removed ${deleted} Revenue + ${delInv} Invoice rows\n`);
  }

  // ── 1. Build 500 virtual customers ──────────────────────────────────────────
  const PLAN_BANDS = {
    STARTER:    { min: 19_900,  max: 39_900  }, // $199–$399/mo in cents
    GROWTH:     { min: 79_900,  max: 149_900 }, // $799–$1499/mo
    ENTERPRISE: { min: 299_900, max: 499_900 }, // $2999–$4999/mo
  } as const;

  type PlanKey = keyof typeof PLAN_BANDS;
  const PLAN_WEIGHTS: PlanKey[] = [
    // 50 % STARTER, 35 % GROWTH, 15 % ENTERPRISE
    ...Array(50).fill('STARTER'),
    ...Array(35).fill('GROWTH'),
    ...Array(15).fill('ENTERPRISE'),
  ];

  const COMPANY_NAMES = [
    'acme', 'techcorp', 'nexus', 'vertex', 'orbit', 'quantum', 'helix',
    'apex', 'zenith', 'nova', 'fusion', 'prism', 'atlas', 'cobalt', 'forge',
    'spark', 'velo', 'crest', 'ionic', 'solace',
  ];

  const PRODUCTS: Record<PlanKey, string[]> = {
    STARTER:    ['RevSecure Starter', 'RevSecure Basic'],
    GROWTH:     ['RevSecure Growth', 'RevSecure Analytics Add-on'],
    ENTERPRISE: ['RevSecure Enterprise', 'RevSecure Enterprise + API'],
  };

  interface Customer {
    id: string;
    email: string;
    plan: PlanKey;
    baseMrr: number;           // cents
    churnDay: number | null;   // days-ago when they churned (null = active)
    upgradeDay: number | null; // days-ago when they upgraded (null = no upgrade)
    startDay: number;          // days-ago when they started
  }

  const customers: Customer[] = Array.from({ length: CUSTOMERS_COUNT }, (_, i) => {
    const plan = pick(PLAN_WEIGHTS) as PlanKey;
    const band = PLAN_BANDS[plan];
    const baseMrr = rand(band.min, band.max);
    const isChurner = Math.random() < 0.15;
    const isUpgrader = !isChurner && Math.random() < 0.10;
    const startDay = rand(Math.round(DAYS_HISTORY * 0.8), DAYS_HISTORY); // started 1.6–2 yrs ago
    const churnDay = isChurner ? rand(30, startDay - 30) : null;
    const upgradeDay = isUpgrader ? rand(30, startDay - 30) : null;

    return {
      id: `cust-100k-${String(i + 1).padStart(5, '0')}`,
      email: `customer${i + 1}@${pick(COMPANY_NAMES)}.io`,
      plan,
      baseMrr,
      churnDay,
      upgradeDay,
      startDay,
    };
  });

  // ── 2. REVENUE (target ~80 000 rows) ────────────────────────────────────────
  console.log('📈  Building Revenue rows…');

  type RevenueRow = {
    companyId: string;
    externalId: string;
    customerId: string;
    customerEmail: string;
    amount: number;
    currency: string;
    mrr: number;
    arr: number;
    product: string;
    plan: string;
    period: Date;
    source: string;
    metadata: object;
  };

  const revenueRows: RevenueRow[] = [];

  // Sample days spread evenly over [startDay … 1] for each customer
  for (const cust of customers) {
    const availableDays = cust.startDay - 1;
    if (availableDays <= 0) continue;

    // Evenly sample REVENUE_SAMPLE_DAYS days from their tenure
    const step = Math.max(1, Math.floor(availableDays / REVENUE_SAMPLE_DAYS));
    const sampledDays: number[] = [];
    for (let d = cust.startDay; d >= 1; d -= step) {
      sampledDays.push(d);
      if (sampledDays.length >= REVENUE_SAMPLE_DAYS) break;
    }

    for (const daysBack of sampledDays) {
      const date = daysAgo(daysBack);
      const month = date.getMonth();

      // Churned customers: revenue = 0 after churn day
      if (cust.churnDay !== null && daysBack <= cust.churnDay) continue;

      // Upgraded customers: MRR doubles after upgrade day
      const mrr =
        cust.upgradeDay !== null && daysBack <= cust.upgradeDay
          ? cust.baseMrr * 2
          : cust.baseMrr;

      // Trend: slight compounding growth
      const growthFactor = Math.pow(1.0004, DAYS_HISTORY - daysBack);

      // Seasonality
      const seasonal = seasonalMultiplier(month);

      // White noise ±6 %
      const noise = 1 + (Math.random() - 0.5) * 0.12;

      // Anomaly spike/drop (~3 % of days)
      const anomaly = Math.random() < 0.03
        ? (Math.random() < 0.6 ? 1 + rand(30, 40) / 100 : 1 - rand(25, 40) / 100)
        : 1;

      const amount = Math.max(100, Math.round(mrr * growthFactor * seasonal * noise * anomaly));

      revenueRows.push({
        companyId,
        externalId: `${SEED_PREFIX}-${cust.id}-${date.toISOString().split('T')[0]}`,
        customerId: cust.id,
        customerEmail: cust.email,
        amount,
        currency: 'USD',
        mrr,
        arr: mrr * 12,
        product: pick(PRODUCTS[cust.plan]),
        plan: cust.plan,
        period: date,
        source: 'stripe',
        metadata: {
          seeded: SEED_PREFIX,
          tier: cust.plan,
          churner: cust.churnDay !== null,
          upgrader: cust.upgradeDay !== null,
          anomaly: anomaly !== 1,
        },
      });
    }
  }

  console.log(`  ℹ️   Built ${revenueRows.length.toLocaleString()} Revenue rows in memory`);
  await batchInsert(
    'Revenue',
    revenueRows,
    (batch) => prisma.revenue.createMany({ data: batch, skipDuplicates: true }),
    1_000,
  );

  // Grab some Revenue IDs for FK refs later (used only by leakages if needed)
  const revenueIdSample = (
    await prisma.revenue.findMany({
      where: { companyId, externalId: { startsWith: `${SEED_PREFIX}-` } },
      select: { id: true },
      take: 5_000,
      orderBy: { createdAt: 'desc' },
    })
  ).map((r) => r.id);

  // ── 3. INVOICES (target ~20 000 rows) ────────────────────────────────────────
  console.log('\n🧾  Building Invoice rows…');

  const INVOICE_STATUSES = [
    // weight: 55 % paid, 20 % open, 12 % past_due, 8 % void, 5 % uncollectible
    ...Array(55).fill('paid'),
    ...Array(20).fill('open'),
    ...Array(12).fill('past_due'),
    ...Array(8).fill('void'),
    ...Array(5).fill('uncollectible'),
  ];

  type InvoiceRow = {
    companyId: string;
    stripeInvoiceId: string;
    stripeCustomerId: string;
    amount: number;
    currency: string;
    status: string;
    invoiceUrl: string;
    periodStart: Date;
    periodEnd: Date;
    paidAt: Date | null;
    createdAt: Date;
  };

  const invoiceRows: InvoiceRow[] = [];
  let invoiceIndex = 0;

  for (const cust of customers) {
    // Spread invoices over the customer's tenure
    const tenureDays = cust.churnDay !== null
      ? cust.startDay - cust.churnDay   // active until churn
      : cust.startDay;

    // Generate one invoice per ~(tenureDays / INVOICES_PER_CUSTOMER) days
    const intervalDays = Math.max(1, Math.floor(tenureDays / INVOICES_PER_CUSTOMER));

    for (let k = 0; k < INVOICES_PER_CUSTOMER; k++) {
      const daysBack = cust.startDay - k * intervalDays;
      if (daysBack < 1) break;

      // Skip if after churn
      if (cust.churnDay !== null && daysBack <= cust.churnDay) break;

      const periodStart = daysAgo(daysBack);
      const periodEnd = dateAddDays(periodStart, 30);
      const status = pick(INVOICE_STATUSES) as string;
      const amount = randFloat(
        PLAN_BANDS[cust.plan].min / 100,   // convert cents → dollars
        PLAN_BANDS[cust.plan].max / 100,
      );

      invoiceIndex++;
      invoiceRows.push({
        companyId,
        stripeInvoiceId: `in_${SEED_PREFIX}_${String(invoiceIndex).padStart(7, '0')}`,
        stripeCustomerId: cust.id,
        amount,
        currency: 'USD',
        status,
        invoiceUrl: `https://invoice.stripe.com/i/${SEED_PREFIX}_${invoiceIndex}`,
        periodStart,
        periodEnd,
        paidAt: status === 'paid'
          ? dateAddDays(periodStart, rand(1, 5))
          : null,
        createdAt: periodStart,
      });
    }
  }

  console.log(`  ℹ️   Built ${invoiceRows.length.toLocaleString()} Invoice rows in memory`);
  await batchInsert(
    'Invoice',
    invoiceRows,
    (batch) => prisma.invoice.createMany({ data: batch, skipDuplicates: true }),
    1_000,
  );

  // ── 4. Summary ────────────────────────────────────────────────────────────────
  console.log('\n📊  Final DB counts for Demo Company:');
  const [totalRevenue, totalInvoice] = await Promise.all([
    prisma.revenue.count({ where: { companyId } }),
    prisma.invoice.count({ where: { companyId } }),
  ]);
  const [seedRevenue, seedInvoice] = await Promise.all([
    prisma.revenue.count({ where: { companyId, externalId: { startsWith: `${SEED_PREFIX}-` } } }),
    prisma.invoice.count({ where: { companyId, stripeInvoiceId: { startsWith: `in_${SEED_PREFIX}_` } } }),
  ]);

  console.log(`\n   ${'Table'.padEnd(20)} ${'This run'.padStart(12)} ${'Total in DB'.padStart(14)}`);
  console.log(`   ${'─'.repeat(48)}`);
  console.log(`   ${'Revenue'.padEnd(20)} ${seedRevenue.toLocaleString().padStart(12)} ${totalRevenue.toLocaleString().padStart(14)}`);
  console.log(`   ${'Invoice'.padEnd(20)} ${seedInvoice.toLocaleString().padStart(12)} ${totalInvoice.toLocaleString().padStart(14)}`);
  console.log(`   ${'─'.repeat(48)}`);
  console.log(`   ${'TOTAL (this run)'.padEnd(20)} ${(seedRevenue + seedInvoice).toLocaleString().padStart(12)}`);

  console.log(`
📐  AI-analysis patterns embedded:
   • ${customers.filter(c => c.churnDay !== null).length} churner customers (15 %)
   • ${customers.filter(c => c.upgradeDay !== null).length} upgrader customers (~10 %)
   • ${revenueRows.filter(r => (r.metadata as any).anomaly).length.toLocaleString()} anomaly data points (~3 % of rows)
   • Growth trend: +0.04 %/day compounding
   • Seasonal multiplier applied (Q1 strong, summer dip, Q4 spike)
   • 3 tiers: STARTER / GROWTH / ENTERPRISE with distinct MRR bands
`);

  console.log('🎉  Done!\n');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
