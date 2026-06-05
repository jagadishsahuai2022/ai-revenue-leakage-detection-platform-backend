/**
 * scripts/seed-10k.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Idempotent 10 000-record seed for POC / MVP testing.
 *
 * What gets seeded (all into the Demo Company tenant):
 *   ~3 000  Revenue rows      – daily customer payments, 2 years of history
 *   ~2 500  RevenueLeakage    – realistic mix of 7 leakage categories
 *   ~2 000  RevenueEventLog   – SYNC_COMPLETED / LEAKAGE_DETECTED / etc.
 *   ~1 200  AuditLog          – login, CRUD, export actions
 *   ~  800  Invoice           – paid / open / past-due invoices
 *   ~  500  ConnectorEventRecord – Stripe + GitHub events
 *   ─────────────────────────────────────────────────────
 *   ≈10 000  total rows
 *
 * Usage:
 *   npx tsx scripts/seed-10k.ts
 *   WIPE=true npx tsx scripts/seed-10k.ts   ← clears existing seed data first
 *
 * Safe to run multiple times (skipDuplicates / upsert everywhere).
 */

import { PrismaClient, LeakageCategory } from '@prisma/client';

const prisma = new PrismaClient();
const WIPE = process.env.WIPE === 'true';

// ── Helpers ───────────────────────────────────────────────────────────────────

const rand = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;
const randFloat = (min: number, max: number) =>
  +(Math.random() * (max - min) + min).toFixed(2);
const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
};
const hoursAgo = (n: number) => new Date(Date.now() - n * 3_600_000);

async function batchInsert<T>(
  label: string,
  items: T[],
  inserter: (batch: T[]) => Promise<{ count: number }>,
  batchSize = 500,
) {
  let inserted = 0;
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const r = await inserter(batch);
    inserted += r.count;
  }
  console.log(`  ✅  ${label}: ${inserted} rows`);
  return inserted;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🌱  Starting 10k seed…\n');

  // ── 0. Find or create demo company ──────────────────────────────────────────
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
  console.log(`🏢  Company: ${company.name} (${companyId})`);

  // ── WIPE mode ────────────────────────────────────────────────────────────────
  if (WIPE) {
    console.log('\n🗑   WIPE=true — clearing seed data…');
    await prisma.connectorEventRecord.deleteMany({ where: { companyId } });
    await prisma.revenueEventLog.deleteMany({ where: { companyId } });
    await prisma.revenueLeakage.deleteMany({ where: { companyId } });
    await prisma.auditLog.deleteMany({ where: { companyId } });
    await prisma.invoice.deleteMany({ where: { companyId } });
    await prisma.revenue.deleteMany({ where: { companyId } });
    console.log('  ✅  Cleared\n');
  }

  // ── Lookup admin user for audit logs ────────────────────────────────────────
  const adminUser = await prisma.user.findFirst({
    where: { companyId, role: 'COMPANY_ADMIN' },
    select: { id: true, email: true, name: true },
  });

  // ── 1. CUSTOMERS (in-memory only) ────────────────────────────────────────────
  // 120 fictional B2B SaaS customers
  const CUSTOMERS = Array.from({ length: 120 }, (_, i) => ({
    id: `cust-${String(i + 1).padStart(4, '0')}`,
    email: `customer${i + 1}@example-${pick(['acme', 'techcorp', 'nexus', 'vertex', 'orbit'])}.io`,
    plan: pick(['STARTER', 'GROWTH', 'ENTERPRISE']),
    mrr: pick([199, 399, 799, 1499, 2999, 4999]) * 100, // cents
  }));

  const PRODUCTS = [
    'RevSecure Starter',
    'RevSecure Growth',
    'RevSecure Enterprise',
    'RevSecure Analytics Add-on',
    'RevSecure API Access',
  ];

  // ── 2. REVENUE ───────────────────────────────────────────────────────────────
  // 730 daily total rows (2-year aggregate, 1 per day) + 120 customers × recent
  // 3 months = ~1 080 individual rows = ~1 800 rows total
  console.log('\n📈  Seeding Revenue…');

  const revenueRows: {
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
  }[] = [];

  // 2a. Daily aggregate series — 730 days back (for AI trend analysis)
  for (let d = 730; d >= 1; d--) {
    const date = daysAgo(d);
    // Skip if we already have rows near this bucket (avoid re-seeding)
    // Slight growth trend: revenue increases 0.03% per day
    const growth = Math.pow(1.0003, 730 - d);
    const baseAmount = Math.round(45_000_00 * growth); // ~$45k/day base
    const noise = 1 + (Math.random() - 0.5) * 0.12;
    const spike = Math.random() < 0.04 ? (Math.random() < 0.5 ? 1.4 : 0.65) : 1;
    const amount = Math.round(baseAmount * noise * spike);

    revenueRows.push({
      companyId,
      externalId: `daily-agg-${date.toISOString().split('T')[0]}`,
      customerId: 'agg-all',
      customerEmail: 'aggregated@internal',
      amount,
      currency: 'USD',
      mrr: Math.round(amount * 0.92),
      arr: Math.round(amount * 0.92 * 12),
      product: 'All Products',
      plan: 'AGGREGATE',
      period: date,
      source: 'stripe',
      metadata: { type: 'daily_aggregate', seeded: true },
    });
  }

  // 2b. Individual customer subscription rows — last 90 days
  for (const customer of CUSTOMERS) {
    const startDay = rand(1, 90);
    for (let d = startDay; d >= 1; d -= rand(28, 31)) {
      const date = daysAgo(d);
      const noise = 1 + (Math.random() - 0.5) * 0.05;
      const amount = Math.round(customer.mrr * noise);
      revenueRows.push({
        companyId,
        externalId: `sub-${customer.id}-${date.toISOString().split('T')[0]}`,
        customerId: customer.id,
        customerEmail: customer.email,
        amount,
        currency: 'USD',
        mrr: customer.mrr,
        arr: customer.mrr * 12,
        product: pick(PRODUCTS),
        plan: customer.plan,
        period: date,
        source: 'stripe',
        metadata: { customerId: customer.id, seeded: true },
      });
    }
  }

  await batchInsert('Revenue', revenueRows, (batch) =>
    prisma.revenue.createMany({ data: batch, skipDuplicates: true }),
  );

  // Grab some IDs for FK references in leakages
  const revenueIds = (
    await prisma.revenue.findMany({
      where: { companyId },
      select: { id: true },
      take: 500,
      orderBy: { createdAt: 'desc' },
    })
  ).map((r) => r.id);

  // ── 3. REVENUE LEAKAGE ───────────────────────────────────────────────────────
  console.log('\n🔴  Seeding RevenueLeakage…');

  const LEAKAGE_CATEGORIES: LeakageCategory[] = [
    'CHURN',
    'DUNNING_FAILURE',
    'PRICING_GAP',
    'FAILED_UPSELL',
    'REFUND',
    'DISCOUNT_ABUSE',
    'INVOICE_ERROR',
  ];

  const leakageTitles: Record<LeakageCategory, string[]> = {
    CHURN: [
      'Subscription cancelled without win-back attempt',
      'High-value account churned — no save offer sent',
      'Customer downgraded to free tier silently',
    ],
    DUNNING_FAILURE: [
      'Payment retry exhausted — card declined',
      'Subscription paused after 3 failed charges',
      'ACH return unhandled — revenue lost',
    ],
    PRICING_GAP: [
      'Legacy pricing tier still active post-migration',
      'Grandfathered plan generating below-market revenue',
      'Feature usage exceeds plan limits without upsell trigger',
    ],
    FAILED_UPSELL: [
      'Upsell email sequence not triggered on usage spike',
      'Annual plan conversion missed at renewal',
      'Add-on not offered at checkout',
    ],
    REFUND: [
      'Disputed charge refunded without investigation',
      'Partial refund issued outside policy window',
      'Accidental double-charge refunded — root cause unpatched',
    ],
    DISCOUNT_ABUSE: [
      'Coupon code reused beyond single-use limit',
      'Referral credit claimed by non-qualifying account',
      'Stacked discounts exceed approval threshold',
    ],
    INVOICE_ERROR: [
      'Invoice sent with incorrect line items',
      'Tax calculation misconfigured — undercharged',
      'Prorated amount computed on wrong subscription dates',
    ],
  };

  const leakageRows: {
    companyId: string;
    revenueId: string | null;
    category: LeakageCategory;
    title: string;
    description: string;
    amount: number;
    currency: string;
    riskScore: number;
    isResolved: boolean;
    resolvedAt: Date | null;
    detectedAt: Date;
    metadata: object;
  }[] = [];

  for (let i = 0; i < 2500; i++) {
    const category = pick(LEAKAGE_CATEGORIES);
    const amount = randFloat(50, 12_000);
    const riskScore = rand(1, 100);
    const isResolved = Math.random() < 0.35;
    const detectedAt = hoursAgo(rand(1, 720 * 24)); // up to 2 years ago

    leakageRows.push({
      companyId,
      revenueId: Math.random() < 0.6 ? pick(revenueIds) : null,
      category,
      title: pick(leakageTitles[category]),
      description: `Detected ${category.toLowerCase().replace('_', ' ')} event affecting ${pick(CUSTOMERS).email}. Estimated revenue impact: $${amount.toLocaleString()}.`,
      amount,
      currency: 'USD',
      riskScore,
      isResolved,
      resolvedAt: isResolved ? new Date(detectedAt.getTime() + rand(1, 72) * 3_600_000) : null,
      detectedAt,
      metadata: { seeded: true, customer: pick(CUSTOMERS).id },
    });
  }

  await batchInsert('RevenueLeakage', leakageRows, (batch) =>
    prisma.revenueLeakage.createMany({ data: batch }),
  );

  // ── 4. REVENUE EVENT LOG ─────────────────────────────────────────────────────
  console.log('\n📋  Seeding RevenueEventLog…');

  const EVENT_TYPES = [
    'SYNC_COMPLETED',
    'LEAKAGE_DETECTED',
    'PAYMENT_FAILED',
    'SUBSCRIPTION_CREATED',
    'SUBSCRIPTION_CANCELLED',
    'REFUND_ISSUED',
    'DUNNING_STARTED',
    'DUNNING_RESOLVED',
    'UPSELL_TRIGGERED',
    'REVENUE_IMPORTED',
    'ANOMALY_DETECTED',
    'FORECAST_GENERATED',
  ];

  const eventLogRows = Array.from({ length: 2000 }, () => {
    const type = pick(EVENT_TYPES);
    const customer = pick(CUSTOMERS);
    return {
      companyId,
      type,
      payload: {
        customerId: customer.id,
        customerEmail: customer.email,
        amount: randFloat(100, 5000),
        currency: 'USD',
        source: pick(['stripe', 'manual', 'api']),
        seeded: true,
      },
      createdAt: hoursAgo(rand(1, 8760)),
    };
  });

  await batchInsert('RevenueEventLog', eventLogRows, (batch) =>
    prisma.revenueEventLog.createMany({ data: batch }),
  );

  // ── 5. AUDIT LOG ─────────────────────────────────────────────────────────────
  console.log('\n🔍  Seeding AuditLog…');

  const AUDIT_ACTIONS = [
    'USER_LOGIN',
    'USER_LOGOUT',
    'REVENUE_RECORD_CREATED',
    'REVENUE_RECORD_UPDATED',
    'LEAKAGE_RESOLVED',
    'LEAKAGE_DISMISSED',
    'AI_ANALYSIS_RUN',
    'INTEGRATION_CONNECTED',
    'INTEGRATION_DISCONNECTED',
    'API_KEY_CREATED',
    'API_KEY_REVOKED',
    'COMPANY_SETTINGS_UPDATED',
    'USER_INVITED',
    'USER_ROLE_CHANGED',
    'EXPORT_GENERATED',
    'BILLING_UPDATED',
    'PASSWORD_CHANGED',
  ];

  const auditRows = Array.from({ length: 1200 }, () => {
    const action = pick(AUDIT_ACTIONS);
    const actor = adminUser ?? { id: 'system', email: 'system@internal', name: 'System' };
    return {
      companyId,
      actorId: actor.id,
      actorEmail: actor.email,
      actorName: actor.name,
      action,
      resourceType: action.split('_')[0],
      resourceId: `res-${Math.random().toString(36).slice(2, 10)}`,
      detail: `${action} performed`,
      resource: action,
      ipAddress: `${rand(1, 254)}.${rand(1, 254)}.${rand(1, 254)}.${rand(1, 254)}`,
      userAgent: pick([
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Safari/605',
        'RevSecure-CLI/1.0.0',
        'PostmanRuntime/7.36',
      ]),
      metadata: { seeded: true },
      createdAt: hoursAgo(rand(1, 8760)),
    };
  });

  await batchInsert('AuditLog', auditRows, (batch) =>
    prisma.auditLog.createMany({ data: batch }),
  );

  // ── 6. INVOICES ───────────────────────────────────────────────────────────────
  console.log('\n🧾  Seeding Invoice…');

  const INVOICE_STATUSES = ['paid', 'open', 'past_due', 'void', 'uncollectible'];

  const invoiceRows = Array.from({ length: 800 }, (_, i) => {
    const customer = CUSTOMERS[i % CUSTOMERS.length];
    const status = pick(INVOICE_STATUSES);
    const amount = randFloat(199, 9_999);
    const periodStart = daysAgo(rand(30, 730));
    const periodEnd = new Date(periodStart.getTime() + 30 * 86_400_000);
    return {
      companyId,
      stripeInvoiceId: `in_seed_${String(i + 1).padStart(6, '0')}`,
      stripeCustomerId: customer.id,
      amount,
      currency: 'USD',
      status,
      invoiceUrl: `https://invoice.stripe.com/i/seed_${i + 1}`,
      periodStart,
      periodEnd,
      paidAt: status === 'paid' ? new Date(periodStart.getTime() + rand(1, 5) * 86_400_000) : null,
      createdAt: periodStart,
    };
  });

  await batchInsert('Invoice', invoiceRows, (batch) =>
    prisma.invoice.createMany({ data: batch, skipDuplicates: true }),
  );

  // ── 7. CONNECTOR EVENT RECORDS ────────────────────────────────────────────────
  console.log('\n🔌  Seeding ConnectorEventRecord…');

  const STRIPE_EVENTS = [
    'charge.succeeded',
    'charge.failed',
    'invoice.paid',
    'invoice.payment_failed',
    'customer.subscription.created',
    'customer.subscription.deleted',
    'customer.subscription.updated',
    'payment_intent.succeeded',
    'payment_intent.payment_failed',
    'refund.created',
    'dispute.created',
    'dispute.closed',
  ];

  const GITHUB_EVENTS = [
    'push',
    'pull_request.opened',
    'pull_request.closed',
    'issues.opened',
    'release.published',
    'workflow_run.completed',
  ];

  const connectorRows = Array.from({ length: 500 }, (_, i) => {
    const isStripe = i < 350;
    const provider = isStripe ? 'STRIPE' : 'GITHUB';
    const eventType = isStripe ? pick(STRIPE_EVENTS) : pick(GITHUB_EVENTS);
    const customer = pick(CUSTOMERS);
    return {
      companyId,
      provider: provider as 'STRIPE' | 'GITHUB',
      eventType,
      externalId: `evt_seed_${String(i + 1).padStart(6, '0')}`,
      rawPayload: {
        id: `evt_seed_${i + 1}`,
        type: eventType,
        data: {
          object: {
            customer: customer.id,
            amount: rand(100, 99900),
            currency: 'usd',
          },
        },
        seeded: true,
      },
      processed: Math.random() < 0.9,
      createdAt: hoursAgo(rand(1, 4380)),
    };
  });

  await batchInsert('ConnectorEventRecord', connectorRows, (batch) =>
    prisma.connectorEventRecord.createMany({ data: batch, skipDuplicates: true }),
  );

  // ── Summary ───────────────────────────────────────────────────────────────────
  console.log('\n📊  Final counts:');
  const counts = await Promise.all([
    prisma.revenue.count({ where: { companyId } }),
    prisma.revenueLeakage.count({ where: { companyId } }),
    prisma.revenueEventLog.count({ where: { companyId } }),
    prisma.auditLog.count({ where: { companyId } }),
    prisma.invoice.count({ where: { companyId } }),
    prisma.connectorEventRecord.count({ where: { companyId } }),
  ]);
  const labels = ['Revenue', 'RevenueLeakage', 'RevenueEventLog', 'AuditLog', 'Invoice', 'ConnectorEventRecord'];
  let total = 0;
  for (const [i, count] of counts.entries()) {
    console.log(`   ${labels[i].padEnd(24)} ${count.toLocaleString()}`);
    total += count;
  }
  console.log(`${'─'.repeat(35)}`);
  console.log(`   ${'TOTAL'.padEnd(24)} ${total.toLocaleString()}`);
  console.log('\n🎉  Done!\n');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
