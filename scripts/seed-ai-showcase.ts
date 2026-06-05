/**
 * scripts/seed-ai-showcase.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Definitive seed for the AI Revenue Intelligence dashboard (POC / MVP).
 *
 * What this does (always wipes first — idempotent):
 *   1. Deletes ALL AIInsight rows for the demo company
 *   2. Deletes ALL Revenue rows for the LAST 30 DAYS (all prefixes)
 *   3. Deletes ALL RevenueLeakage for the LAST 30 DAYS
 *   4. Inserts 30 Revenue rows — ONE per day, sole source for statistical engine
 *   5. Inserts 15 high-impact RevenueLeakage rows (boosts leakage fraction)
 *   6. Inserts exactly 6 AIInsight rows matching the frontend mock distribution
 *   7. Resets AiUsage quota to 100
 *
 * The 6 pre-seeded AIInsight cards are what shows on the dashboard immediately.
 * The Revenue + Leakage data is crafted so that "Run Analysis" also produces
 * a dramatic result (~HIGH/CRITICAL, not the boring LOW 12/100).
 *
 * Usage:
 *   npx tsx scripts/seed-ai-showcase.ts          ← always wipes + reseeds
 *   npm run seed:ai                               ← same via npm script
 */

import { PrismaClient, LeakageCategory } from '@prisma/client';

const prisma = new PrismaClient();

// ── Helpers ───────────────────────────────────────────────────────────────────

const rand = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);
const daysAgo = (d: number) => {
  const dt = new Date();
  dt.setDate(dt.getDate() - d);
  dt.setHours(0, 0, 0, 0);
  return dt;
};

// ── The 6 showcase AIInsight cards (matches frontend mock exactly) ────────────
//
// severity distribution: critical / high / high / medium / medium / low
// The summary text is what the card actually displays.

const MOCK_INSIGHTS = [
  {
    severity: 'CRITICAL' as const,
    riskScore: 94,
    title: '12 anomalies detected — CRITICAL risk (94/100)',
    summary:
      'URGENT: Revenue declined 38% in 14 days. 12 anomalies detected (5 high severity, 4 medium). ' +
      'Stripe webhook outage caused $89,400 in uncaptured payments. Dunning failures affect 34 accounts ($8,400 MRR at risk). ' +
      'Revenue trend is declining (slope=−1,847, R²=0.85). 18% of revenue affected by leakage events. ' +
      'Composite risk score: 94/100 (CRITICAL).',
    insightType: 'COMPOSITE',
    trend: 'declining' as const,
    slope: -1847,
    rSquared: 0.85,
    anomalyCount: 12,
    highCount: 5,
    mediumCount: 4,
    lowCount: 3,
    minutesAgo: 8,
  },
  {
    severity: 'HIGH' as const,
    riskScore: 76,
    title: '8 anomalies — $41K double-charge event detected',
    summary:
      'Detected 8 revenue anomalies (3 high severity, 4 medium). An unexpected $41,200 spike on Feb 27 ' +
      'followed by 12 customer refund requests indicates a batch double-charge event. ' +
      'Root cause: idempotency key collision in payment processor. Revenue trend is declining. ' +
      'Composite risk score: 76/100 (HIGH).',
    insightType: 'COMPOSITE',
    trend: 'declining' as const,
    slope: -892,
    rSquared: 0.68,
    anomalyCount: 8,
    highCount: 3,
    mediumCount: 4,
    lowCount: 1,
    minutesAgo: 45,
  },
  {
    severity: 'HIGH' as const,
    riskScore: 71,
    title: '7 anomalies — enterprise churn wave eroding MRR',
    summary:
      'Detected 7 revenue anomalies (2 high severity, 3 medium). Three Enterprise-tier accounts ' +
      '($8,997/mo combined MRR) cancelled within 72 hours without triggering win-back sequences. ' +
      'Dunning retry exhaustion on 12 additional accounts adds $8,400 in at-risk MRR. ' +
      'Revenue trend is declining (R²=0.62). Composite risk score: 71/100 (HIGH).',
    insightType: 'COMPOSITE',
    trend: 'declining' as const,
    slope: -654,
    rSquared: 0.62,
    anomalyCount: 7,
    highCount: 2,
    mediumCount: 3,
    lowCount: 2,
    minutesAgo: 120,
  },
  {
    severity: 'MEDIUM' as const,
    riskScore: 55,
    title: '5 anomalies — invoice errors causing $23K under-collection',
    summary:
      'Detected 5 revenue anomalies (2 medium severity, 3 low). Tax engine misconfiguration on ' +
      '47 EU invoices resulted in $22,983 under-collection. Additionally, coupon code SAVE30 was ' +
      'reused 47 times beyond its single-use limit ($7,050 lost). Revenue trend is flat. ' +
      'Composite risk score: 55/100 (MEDIUM).',
    insightType: 'COMPOSITE',
    trend: 'flat' as const,
    slope: -34,
    rSquared: 0.41,
    anomalyCount: 5,
    highCount: 0,
    mediumCount: 2,
    lowCount: 3,
    minutesAgo: 360,
  },
  {
    severity: 'MEDIUM' as const,
    riskScore: 48,
    title: '4 anomalies — failed upsell costing $47K ARR',
    summary:
      'Detected 4 revenue anomalies (1 medium severity, 3 low). Annual plan conversion emails ' +
      'were not sent to 45 eligible renewal accounts (expected 22% conversion → $47,300 missed ARR). ' +
      '15 Starter accounts at 80%+ utilization with no upgrade prompt. Revenue trend is growing ' +
      'but upsell pipeline is underperforming. Composite risk score: 48/100 (MEDIUM).',
    insightType: 'COMPOSITE',
    trend: 'growing' as const,
    slope: 234,
    rSquared: 0.53,
    anomalyCount: 4,
    highCount: 0,
    mediumCount: 1,
    lowCount: 3,
    minutesAgo: 600,
  },
  {
    severity: 'LOW' as const,
    riskScore: 22,
    title: '2 minor anomalies — revenue health strong',
    summary:
      'Detected 2 revenue anomalies (2 low severity) within normal seasonal variation. ' +
      'MRR grew 8.3% month-over-month — new Enterprise sign-ups contributing $12,400 incremental MRR. ' +
      'Revenue shows a growing trend (R²=0.73). Customer retention at 97.4%. ' +
      'Composite risk score: 22/100 (LOW).',
    insightType: 'COMPOSITE',
    trend: 'growing' as const,
    slope: 568,
    rSquared: 0.73,
    anomalyCount: 2,
    highCount: 0,
    mediumCount: 0,
    lowCount: 2,
    minutesAgo: 1440,
  },
];

// ── Build the data JSON payload for each insight ──────────────────────────────

function buildInsightData(t: (typeof MOCK_INSIGHTS)[number]) {
  const windowEnd = hoursAgo(0);
  const windowStart = new Date(windowEnd.getTime() - 30 * 86_400_000);
  const topAnomalies = [
    ...Array(t.highCount)
      .fill(null)
      .map(() => ({
        timestamp: new Date(windowStart.getTime() + rand(1, 30) * 86_400_000).toISOString(),
        value: rand(2000, 12000),
        zScore: +(rand(40, 58) / 10).toFixed(2),
        severity: 'high',
      })),
    ...Array(t.mediumCount)
      .fill(null)
      .map(() => ({
        timestamp: new Date(windowStart.getTime() + rand(1, 30) * 86_400_000).toISOString(),
        value: rand(15000, 90000),
        zScore: +(rand(28, 39) / 10).toFixed(2),
        severity: 'medium',
      })),
    ...Array(Math.min(t.lowCount, 2))
      .fill(null)
      .map(() => ({
        timestamp: new Date(windowStart.getTime() + rand(1, 30) * 86_400_000).toISOString(),
        value: rand(40000, 60000),
        zScore: +(rand(25, 27) / 10).toFixed(2),
        severity: 'low',
      })),
  ].slice(0, 5);

  const baseValue = 55000;
  const forecasts = [1, 2, 3].map((ahead) => {
    const forecast = baseValue + t.slope * ahead;
    const margin = rand(3000, 7000);
    return {
      periodsAhead: ahead,
      forecast: Math.round(forecast),
      lowerBound: Math.round(forecast - margin),
      upperBound: Math.round(forecast + margin),
    };
  });

  return {
    anomalyReport: {
      totalPoints: 30,
      anomalyCount: t.anomalyCount,
      stats: { mean: 55000, stdDev: 18200, min: 4800, max: 148000, movingAvgWindow: 7 },
      anomalies: topAnomalies.map((a) => ({ ...a, isMovingAvgAnomaly: true, isZScoreAnomaly: true })),
    },
    forecastReport: {
      trend: t.trend,
      slope: t.slope,
      rSquared: t.rSquared,
      forecasts,
      reliable: t.rSquared > 0.5,
    },
    riskScore: {
      score: t.riskScore,
      level: t.severity.toLowerCase(),
      factors: {
        anomalyScore: Math.round(t.riskScore * 1.1),
        trendScore: t.trend === 'declining' ? rand(60, 100) : t.trend === 'flat' ? rand(25, 40) : rand(5, 25),
        leakageScore: rand(15, 50),
      },
      rationale: t.summary,
    },
    topAnomalies,
    dataPoints: 30,
    leakageAmount: rand(40000, 120000),
    totalRevenue: rand(800000, 1600000),
    lookbackDays: 30,
  };
}

// ── Revenue: 30 SOLE daily rows — crafted for the anomaly detector ───────────
//
// Design rationale (from studying the AnomalyDetector math):
//   - 30 data points with a tight baseline (~$55K ± $500)
//   - ONE extreme spike ($200K) on day 14 → z-score ~5.4 (HIGH anomaly)
//   - Declining slope from day 1→30 (~$57K→$52K) to make forecast = declining
//   - The single extreme outlier ensures z > 4 (HIGH severity), moving-avg also triggers
//   - Leakage at ~15% of total → risk score lands in HIGH range (~60-75)
//
// This means clicking "Run Analysis" produces a ~HIGH card (not LOW 12/100).

function buildRevenueSeries(companyId: string) {
  const rows: any[] = [];

  for (let d = 30; d >= 1; d--) {
    const date = daysAgo(d);

    // Declining baseline: 57,500 → 52,500 over 30 days
    const base = 57500 - ((30 - d) / 29) * 5000;

    // Very tight noise: ±$400 (keeps stddev under control)
    const noise = (Math.random() - 0.5) * 800;

    let amount: number;
    let label = 'normal';

    // ONE extreme spike to guarantee a HIGH-severity z-score anomaly
    if (d === 14) {
      amount = 198000; // ~3.6× baseline — this alone produces z ≈ 5.4
      label = 'spike-double-charge-event';
    } else if (d === 8) {
      // A moderate dip to add a second medium-severity anomaly
      amount = 28000; // ~0.5× baseline
      label = 'dip-payment-outage';
    } else if (d === 22) {
      // Another moderate spike
      amount = 95000; // ~1.7× baseline
      label = 'spike-annual-prepay';
    } else {
      amount = Math.round(base + noise);
    }

    rows.push({
      companyId,
      externalId: `showcase-daily-${date.toISOString().split('T')[0]}`,
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
      metadata: { type: 'daily_aggregate', seeded: 'showcase', event: label },
    });
  }

  return rows;
}

// ── Leakage: high-impact rows to boost leakage fraction ──────────────────────

function buildLeakages(companyId: string) {
  const scenarios: Array<{
    category: LeakageCategory;
    title: string;
    description: string;
    amount: number;
    riskScore: number;
  }> = [
    {
      category: 'CHURN',
      title: 'Enterprise TechCorp cancelled — no save offer triggered',
      description:
        'TechCorp Enterprise ($4,999/mo) churned without receiving win-back sequence. Account had 94% feature utilization.',
      amount: 14997,
      riskScore: 95,
    },
    {
      category: 'CHURN',
      title: '3 Growth accounts cancelled same week',
      description: 'Three Growth-tier accounts ($799/mo each) cancelled within 72 hours. Combined MRR loss: $2,397/mo.',
      amount: 7191,
      riskScore: 82,
    },
    {
      category: 'DUNNING_FAILURE',
      title: 'Payment retry exhausted — 12 accounts at risk',
      description:
        'Card declined for 12 active subscribers after 4 retries. Combined MRR: $8,400. Auto-cancel in 7 days.',
      amount: 8400,
      riskScore: 91,
    },
    {
      category: 'DUNNING_FAILURE',
      title: 'Stripe webhook 5xx — 48 payments missed',
      description:
        'Webhook returned 500 for 48 consecutive events. 34 successful payments not recorded. Est. $23,800 uncaptured.',
      amount: 23800,
      riskScore: 97,
    },
    {
      category: 'PRICING_GAP',
      title: '67 grandfathered accounts paying 50% under market',
      description: 'Legacy Starter at $99/mo vs. current $199/mo. Under-pricing: $6,700/mo ($80,400/yr).',
      amount: 6700,
      riskScore: 72,
    },
    {
      category: 'PRICING_GAP',
      title: 'API usage 3× above Growth limits — no upsell',
      description: '23 Growth accounts at Enterprise-tier API usage. No upgrade prompt configured.',
      amount: 16100,
      riskScore: 78,
    },
    {
      category: 'FAILED_UPSELL',
      title: 'Annual conversion emails not sent to 45 accounts',
      description:
        'Monthly-to-annual conversion emails skipped for 45 eligible renewals. Est. missed ARR: $47,300.',
      amount: 47300,
      riskScore: 85,
    },
    {
      category: 'REFUND',
      title: 'Double-charge refund wave — 12 customers',
      description: 'Processing error caused double-charges Feb 27. Full refunds issued: $41,200.',
      amount: 41200,
      riskScore: 93,
    },
    {
      category: 'REFUND',
      title: 'Disputed charges auto-refunded without review',
      description:
        '7 chargebacks auto-refunded. 4 had strong evidence for representment. Est. recoverable: $7,100.',
      amount: 12300,
      riskScore: 76,
    },
    {
      category: 'DISCOUNT_ABUSE',
      title: 'Coupon SAVE30 reused 47× beyond limit',
      description: 'Single-use coupon exploited via API bypass. 47 unauthorized redemptions: $7,050 lost.',
      amount: 7050,
      riskScore: 84,
    },
    {
      category: 'INVOICE_ERROR',
      title: 'Tax misconfiguration — 47 EU invoices under-charged',
      description: '0% VAT applied to 47 EU invoices. Under-collection: $22,983.',
      amount: 22983,
      riskScore: 89,
    },
    {
      category: 'INVOICE_ERROR',
      title: 'Wrong proration dates on 8 mid-cycle upgrades',
      description:
        'Prorated amounts used creation date instead of billing cycle start. Under-billed: $1,890.',
      amount: 1890,
      riskScore: 58,
    },
    {
      category: 'CHURN',
      title: 'Nexus Inc downgraded Enterprise → Growth silently',
      description: 'Downgrade lost $2,200/mo MRR with no retention intervention.',
      amount: 6600,
      riskScore: 88,
    },
    {
      category: 'DUNNING_FAILURE',
      title: 'ACH return unhandled — $3,200 uncollected',
      description: 'VertexAI ACH returned (NSF). No retry scheduled. Manual collection needed.',
      amount: 3200,
      riskScore: 79,
    },
    {
      category: 'FAILED_UPSELL',
      title: 'Analytics Add-on not offered at checkout',
      description: "34 Growth sign-ups this month never saw the $499/mo analytics upsell.",
      amount: 4420,
      riskScore: 67,
    },
  ];

  return scenarios.map((s) => ({
    companyId,
    revenueId: null,
    category: s.category,
    title: s.title,
    description: s.description,
    amount: s.amount,
    currency: 'USD',
    riskScore: s.riskScore,
    isResolved: false,
    resolvedAt: null,
    detectedAt: hoursAgo(rand(1, 600)),
    metadata: { seeded: 'showcase' },
  }));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🎨  AI Showcase seed — definitive version\n');

  // Find the Demo Company that has actual users (the one people log into).
  // There may be multiple "Demo Company" rows — pick the one with users.
  const company = await prisma.company.findFirst({
    where: {
      OR: [
        { slug: 'demo-company' },
        { slug: 'demo' },
        { name: { contains: 'Demo' } },
      ],
      users: { some: {} },
    },
    orderBy: { createdAt: 'asc' },
  });
  if (!company) {
    console.error('❌  Demo company with users not found. Run seed first.');
    process.exit(1);
  }
  const companyId = company.id;
  console.log(`🏢  Company: ${company.name} (${companyId})\n`);

  // ── Step 1: Wipe (always — this script is destructive by design) ────────────
  console.log('🗑   Wiping old data…');

  const thirtyDaysAgo = daysAgo(31);

  // Delete ALL AIInsight rows — clears the boring LOW 12/100 clutter
  const delInsights = await prisma.aIInsight.deleteMany({ where: { companyId } });

  // Delete ALL Revenue for last 30 days — critical: removes the smooth 100k-seed data
  const delRev = await prisma.$executeRawUnsafe(
    `DELETE FROM "Revenue" WHERE "companyId" = $1 AND period >= $2`,
    companyId,
    thirtyDaysAgo,
  );

  // Delete ALL RevenueLeakage for last 30 days
  const delLeak = await prisma.$executeRawUnsafe(
    `DELETE FROM "RevenueLeakage" WHERE "companyId" = $1 AND "detectedAt" >= $2`,
    companyId,
    thirtyDaysAgo,
  );

  // Reset quota
  await prisma.aiUsage.upsert({
    where: { companyId },
    create: { companyId, quotaRemaining: 100 },
    update: { quotaRemaining: 100, totalRuns: 0, totalInsights: 0, tokensUsed: 0 },
  });

  console.log(`  ✅  ${delInsights.count} AIInsight rows deleted`);
  console.log(`  ✅  ${delRev} Revenue rows deleted (last 30 days)`);
  console.log(`  ✅  ${delLeak} RevenueLeakage rows deleted (last 30 days)`);
  console.log('  ✅  Quota reset to 100\n');

  // ── Step 2: Seed the 6 mock AIInsight cards ─────────────────────────────────
  console.log('🧠  Seeding 6 AIInsight cards (mock distribution)…');

  for (const m of MOCK_INSIGHTS) {
    const createdAt = new Date(Date.now() - m.minutesAgo * 60_000);
    const windowEnd = createdAt;
    const windowStart = new Date(windowEnd.getTime() - 30 * 86_400_000);
    const data = buildInsightData(m);

    await prisma.aIInsight.create({
      data: {
        companyId,
        insightType: m.insightType,
        severity: m.severity,
        title: m.title,
        summary: m.summary,
        data: data as any,
        riskScore: m.riskScore,
        windowStart,
        windowEnd,
        llmEnriched: false,
        isRead: false, // all unread for blue dot
        createdAt,
      },
    });
  }
  console.log(
    '  ✅  6 cards seeded: CRITICAL(94) → HIGH(76) → HIGH(71) → MEDIUM(55) → MEDIUM(48) → LOW(22)\n',
  );

  // ── Step 3: Seed Revenue (30 sole daily rows — only data for last 30 days) ──
  console.log('📈  Seeding 30 Revenue rows (last 30 days — sole source for AI engine)…');
  const revRows = buildRevenueSeries(companyId);
  const revResult = await prisma.revenue.createMany({ data: revRows, skipDuplicates: true });
  console.log(`  ✅  ${revResult.count} Revenue rows inserted\n`);

  // ── Step 4: Seed Leakage ──────────────────────────────────────────────────
  console.log('🔴  Seeding 15 RevenueLeakage rows (high-impact)…');
  const leakRows = buildLeakages(companyId);
  const leakResult = await prisma.revenueLeakage.createMany({ data: leakRows });
  console.log(`  ✅  ${leakResult.count} RevenueLeakage rows inserted\n`);

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  📊  Dashboard will now show:');
  console.log('');
  console.log('  ┌──────────┬───────┬──────────────────────────────────────┐');
  console.log('  │ Severity │ Score │ Card title                           │');
  console.log('  ├──────────┼───────┼──────────────────────────────────────┤');
  for (const m of MOCK_INSIGHTS) {
    const sev = m.severity.padEnd(8);
    const score = String(m.riskScore).padStart(3);
    const title = m.title.substring(0, 38);
    console.log(`  │ ${sev} │  ${score} │ ${title.padEnd(36)} │`);
  }
  console.log('  └──────────┴───────┴──────────────────────────────────────┘');
  console.log('');
  console.log('  💡  Refresh the dashboard to see these cards.');
  console.log('  💡  Click "Run Analysis" → new card will be ~HIGH risk');
  console.log('       (not the old boring LOW 12/100).');
  console.log('═══════════════════════════════════════════════════════════\n');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
