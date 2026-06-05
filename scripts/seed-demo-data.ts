#!/usr/bin/env npx tsx
/**
 * seed-demo-data.ts
 * ──────────────────────────────────────────────────────────────────────────────
 * Generates a rich, AI-ready demo dataset spanning 180 days that intentionally
 * triggers AI insight categories across all severity levels:
 *
 *   CRITICAL  : 2-3    (sudden 70% revenue drops, mass payment failures)
 *   HIGH      : 4-6    (repeated payment failures, churn clusters)
 *   MEDIUM    : 5-8    (20-30% revenue dips, delayed payments)
 *   LOW       : 5-10   (small fluctuations, isolated refunds)
 *
 * Seed rules:
 *   - Deterministic: uses seeded PRNG for reproducibility
 *   - Idempotent: upserts existing records, safe to run multiple times
 *   - Runs ONLY when ENABLE_DEMO_MODE=true (or ENABLE_DEMO_DATA=true)
 *   - Throws in NODE_ENV=production
 *
 * Usage:
 *   ENABLE_DEMO_MODE=true npx tsx scripts/seed-demo-data.ts
 */

import { PrismaClient, LeakageCategory } from "@prisma/client";
import bcrypt from "bcryptjs";

// ── Deterministic PRNG (Mulberry32) ─────────────────────────────────────────
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(42);
function randRange(min: number, max: number): number {
  return min + rand() * (max - min);
}
function randInt(min: number, max: number): number {
  return Math.floor(randRange(min, max + 1));
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)]!;
}

// ── Safety guards ───────────────────────────────────────────────────────────
if (process.env.NODE_ENV === "production") {
  console.error("❌ Cannot run demo seed in production.");
  process.exit(1);
}
if (
  process.env.ENABLE_DEMO_MODE !== "true" &&
  process.env.ENABLE_DEMO_DATA !== "true"
) {
  console.error(
    "❌ Set ENABLE_DEMO_MODE=true or ENABLE_DEMO_DATA=true to run demo seed.",
  );
  process.exit(1);
}

const DEMO_SLUG = process.env.DEMO_COMPANY_SLUG ?? "demo";

// ── Customer definitions ────────────────────────────────────────────────────
const CUSTOMERS = [
  // Enterprise
  {
    id: "cus_ent_acme",
    email: "billing@acme-corp.example.com",
    name: "Acme Corp",
    plan: "ENTERPRISE",
    mrr: 12000,
  },
  {
    id: "cus_ent_globex",
    email: "finance@globex.example.com",
    name: "Globex International",
    plan: "ENTERPRISE",
    mrr: 18500,
  },
  {
    id: "cus_ent_initech",
    email: "ar@initech.example.com",
    name: "Initech Industries",
    plan: "ENTERPRISE",
    mrr: 9800,
  },
  {
    id: "cus_ent_umbrella",
    email: "payments@umbrella.example.com",
    name: "Umbrella Group",
    plan: "ENTERPRISE",
    mrr: 22000,
  },
  {
    id: "cus_ent_wayne",
    email: "billing@wayneent.example.com",
    name: "Wayne Enterprises",
    plan: "ENTERPRISE",
    mrr: 15000,
  },

  // Mid-market
  {
    id: "cus_mm_atlas",
    email: "pay@atlasdata.example.com",
    name: "Atlas Data",
    plan: "PRO",
    mrr: 4200,
  },
  {
    id: "cus_mm_beacon",
    email: "finance@beaconai.example.com",
    name: "Beacon AI",
    plan: "PRO",
    mrr: 5600,
  },
  {
    id: "cus_mm_cipher",
    email: "billing@ciphertech.example.com",
    name: "Cipher Technologies",
    plan: "PRO",
    mrr: 3800,
  },
  {
    id: "cus_mm_delta",
    email: "ap@deltaops.example.com",
    name: "DeltaOps",
    plan: "PRO",
    mrr: 6100,
  },
  {
    id: "cus_mm_echo",
    email: "finance@echocloud.example.com",
    name: "Echo Cloud",
    plan: "PRO",
    mrr: 7200,
  },

  // SMB
  {
    id: "cus_smb_01",
    email: "admin@startup01.example.com",
    name: "Startup Alpha",
    plan: "STARTER",
    mrr: 800,
  },
  {
    id: "cus_smb_02",
    email: "admin@startup02.example.com",
    name: "Startup Beta",
    plan: "STARTER",
    mrr: 1200,
  },
  {
    id: "cus_smb_03",
    email: "admin@startup03.example.com",
    name: "Startup Gamma",
    plan: "STARTER",
    mrr: 600,
  },
  {
    id: "cus_smb_04",
    email: "admin@startup04.example.com",
    name: "Startup Delta",
    plan: "STARTER",
    mrr: 950,
  },
  {
    id: "cus_smb_05",
    email: "admin@startup05.example.com",
    name: "Startup Epsilon",
    plan: "STARTER",
    mrr: 1500,
  },
];

// ── Day-level anomaly calendar (day offsets from startDate) ─────────────────
// Each entry defines what kind of anomaly happens on that day offset.
interface AnomalyEvent {
  dayOffset: number;
  type:
    | "CRITICAL_DROP" // Revenue drops ~70%
    | "CRITICAL_MASS_FAIL" // Multiple large payment failures
    | "HIGH_CHURN_CLUSTER" // Several customers churn
    | "HIGH_PAYMENT_FAIL" // Repeated payment failures from 1-2 customers
    | "MEDIUM_DIP" // Revenue dips 20-30%
    | "MEDIUM_DELAYED" // Several delayed payments
    | "LOW_FLUCTUATION" // Small daily deviation
    | "LOW_REFUND"; // Isolated small refund
  customers?: string[]; // Which customer IDs are affected
  description: string;
}

const ANOMALY_EVENTS: AnomalyEvent[] = [
  // ── CRITICAL (days 30, 95) ────────────────────────────────────────────────
  {
    dayOffset: 30,
    type: "CRITICAL_DROP",
    description: "Major billing system outage — revenue drops 70%",
    customers: [
      "cus_ent_acme",
      "cus_ent_globex",
      "cus_ent_umbrella",
      "cus_mm_atlas",
      "cus_mm_echo",
    ],
  },
  {
    dayOffset: 95,
    type: "CRITICAL_MASS_FAIL",
    description:
      "Payment gateway failure — 8 enterprise/mid-market payments fail simultaneously",
    customers: [
      "cus_ent_acme",
      "cus_ent_globex",
      "cus_ent_initech",
      "cus_ent_umbrella",
      "cus_mm_beacon",
      "cus_mm_cipher",
      "cus_mm_delta",
      "cus_mm_echo",
    ],
  },
  {
    dayOffset: 145,
    type: "CRITICAL_DROP",
    description: "Unexpected 65% revenue drop after pricing migration error",
    customers: [
      "cus_ent_wayne",
      "cus_ent_globex",
      "cus_mm_atlas",
      "cus_mm_delta",
    ],
  },

  // ── HIGH (days 15, 55, 75, 110, 130, 160) ────────────────────────────────
  {
    dayOffset: 15,
    type: "HIGH_PAYMENT_FAIL",
    description: "Acme Corp — 3 consecutive payment retries failed",
    customers: ["cus_ent_acme"],
  },
  {
    dayOffset: 55,
    type: "HIGH_CHURN_CLUSTER",
    description: "Churn cluster — 4 SMB customers cancel within 48h",
    customers: ["cus_smb_01", "cus_smb_02", "cus_smb_03", "cus_smb_04"],
  },
  {
    dayOffset: 75,
    type: "HIGH_PAYMENT_FAIL",
    description: "Globex + Umbrella — expired card failures",
    customers: ["cus_ent_globex", "cus_ent_umbrella"],
  },
  {
    dayOffset: 110,
    type: "HIGH_CHURN_CLUSTER",
    description:
      "Mid-market churn — Beacon AI and Cipher downgrade then cancel",
    customers: ["cus_mm_beacon", "cus_mm_cipher"],
  },
  {
    dayOffset: 130,
    type: "HIGH_PAYMENT_FAIL",
    description: "Wayne Enterprises — payment gateway timeout 3x",
    customers: ["cus_ent_wayne"],
  },
  {
    dayOffset: 160,
    type: "HIGH_CHURN_CLUSTER",
    description: "SMB churn wave — 3 startups silently cancel",
    customers: ["cus_smb_02", "cus_smb_04", "cus_smb_05"],
  },

  // ── MEDIUM (days 10, 40, 65, 85, 120, 140, 155, 170) ─────────────────────
  {
    dayOffset: 10,
    type: "MEDIUM_DIP",
    description: "Revenue 25% below 7-day average",
    customers: ["cus_mm_atlas", "cus_mm_delta"],
  },
  {
    dayOffset: 40,
    type: "MEDIUM_DELAYED",
    description: "5 invoices pending > 15 days past due",
    customers: ["cus_ent_initech", "cus_mm_cipher", "cus_mm_echo"],
  },
  {
    dayOffset: 65,
    type: "MEDIUM_DIP",
    description:
      "Daily revenue 22% below rolling average — seasonal or alarming?",
    customers: ["cus_ent_wayne", "cus_mm_beacon"],
  },
  {
    dayOffset: 85,
    type: "MEDIUM_DELAYED",
    description: "Late payments cluster — 4 mid-market accounts",
    customers: [
      "cus_mm_atlas",
      "cus_mm_beacon",
      "cus_mm_cipher",
      "cus_mm_delta",
    ],
  },
  {
    dayOffset: 120,
    type: "MEDIUM_DIP",
    description: "Revenue dip 28% — correlated with product launch issues",
    customers: ["cus_ent_acme", "cus_mm_echo"],
  },
  {
    dayOffset: 140,
    type: "MEDIUM_DELAYED",
    description: "Enterprise account Initech — 3 invoices unpaid for 20+ days",
    customers: ["cus_ent_initech"],
  },
  {
    dayOffset: 155,
    type: "MEDIUM_DIP",
    description: "20% revenue decline in SMB segment",
    customers: ["cus_smb_01", "cus_smb_03", "cus_smb_05"],
  },
  {
    dayOffset: 170,
    type: "MEDIUM_DIP",
    description: "Post-churn revenue still 18% below expected baseline",
  },

  // ── LOW (days 5, 20, 35, 50, 70, 100, 115, 135, 150, 165) ────────────────
  {
    dayOffset: 5,
    type: "LOW_FLUCTUATION",
    description: "Daily variance +/- 8% — within normal range",
  },
  {
    dayOffset: 20,
    type: "LOW_REFUND",
    description: "Small refund issued to Startup Alpha — $120",
    customers: ["cus_smb_01"],
  },
  {
    dayOffset: 35,
    type: "LOW_FLUCTUATION",
    description: "Minor daily dip 5% below average",
  },
  {
    dayOffset: 50,
    type: "LOW_REFUND",
    description: "Prorated credit issued — Cipher Technologies plan change",
    customers: ["cus_mm_cipher"],
  },
  {
    dayOffset: 70,
    type: "LOW_FLUCTUATION",
    description: "Weekend revenue dip — expected seasonal pattern",
  },
  {
    dayOffset: 100,
    type: "LOW_REFUND",
    description: "Isolated failed payment — Startup Gamma — $600",
    customers: ["cus_smb_03"],
  },
  {
    dayOffset: 115,
    type: "LOW_FLUCTUATION",
    description: "Small variance in daily collections",
  },
  {
    dayOffset: 135,
    type: "LOW_REFUND",
    description: "Duplicate charge reversed — DeltaOps — $350",
    customers: ["cus_mm_delta"],
  },
  {
    dayOffset: 150,
    type: "LOW_FLUCTUATION",
    description: "Normal fluctuation — within 2σ",
  },
  {
    dayOffset: 165,
    type: "LOW_FLUCTUATION",
    description: "Minor intra-day revenue dip",
  },
];

// ── Severity + risk score mapping ───────────────────────────────────────────
function severityForType(type: string): {
  severity: string;
  riskMin: number;
  riskMax: number;
} {
  if (type.startsWith("CRITICAL"))
    return { severity: "CRITICAL", riskMin: 80, riskMax: 100 };
  if (type.startsWith("HIGH"))
    return { severity: "HIGH", riskMin: 55, riskMax: 79 };
  if (type.startsWith("MEDIUM"))
    return { severity: "MEDIUM", riskMin: 25, riskMax: 54 };
  return { severity: "LOW", riskMin: 1, riskMax: 24 };
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const prisma = new PrismaClient();

  try {
    // ── 1. Ensure demo company ──────────────────────────────────────────────
    let company = await prisma.company.findUnique({
      where: { slug: DEMO_SLUG },
    });
    if (!company) {
      company = await prisma.company.create({
        data: {
          name: "Demo Company",
          slug: DEMO_SLUG,
          billingEmail: "admin@demo.com",
          plan: "GROWTH",
          subscriptionStatus: "ACTIVE",
        },
      });
      console.log(`✅ Created demo company: ${company.id}`);
    }
    const companyId = company.id;

    // ── 2. Ensure demo users ────────────────────────────────────────────────
    const passwordHash = await bcrypt.hash("password123", 12);
    const users = [
      {
        email: "admin@demo.com",
        name: "Demo Admin",
        role: "COMPANY_ADMIN" as const,
      },
      {
        email: "analyst@demo.com",
        name: "Demo Analyst",
        role: "ANALYST" as const,
      },
      {
        email: "viewer@demo.com",
        name: "Demo Viewer",
        role: "VIEWER" as const,
      },
    ];
    for (const u of users) {
      await prisma.user.upsert({
        where: { companyId_email: { companyId, email: u.email } },
        update: {},
        create: {
          companyId,
          email: u.email,
          name: u.name,
          passwordHash,
          role: u.role,
          emailVerified: true,
          isActive: true,
        },
      });
    }
    console.log(`✅ Demo users ensured (${users.length})`);

    // ── 3. Clear old data (idempotent re-seed) ─────────────────────────────
    await prisma.aIInsight.deleteMany({ where: { companyId } });
    await prisma.revenueLeakage.deleteMany({ where: { companyId } });
    await prisma.revenue.deleteMany({ where: { companyId } });
    console.log("🗑️  Cleared old revenue, leakage, and insight data");

    // ── 4. Generate 180 days of daily revenue ──────────────────────────────
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 180);
    startDate.setHours(0, 0, 0, 0);

    // Pre-compute anomaly days for quick lookup
    const anomalyByDay = new Map<number, AnomalyEvent[]>();
    for (const evt of ANOMALY_EVENTS) {
      const existing = anomalyByDay.get(evt.dayOffset) ?? [];
      existing.push(evt);
      anomalyByDay.set(evt.dayOffset, existing);
    }

    let totalRevenue = 0;
    let revenueCount = 0;
    const revenueIds: string[] = [];

    // Compute baseline daily revenue from all customers
    const baselineDaily = CUSTOMERS.reduce((sum, c) => sum + c.mrr / 30, 0);

    // Build gradual decline factor: first 90 days stable, next 90 days decline
    function trendFactor(day: number): number {
      if (day < 90) return 1.0 + day * 0.002 * (rand() * 0.5 + 0.75); // slight growth
      // Gradual decline: -0.15% per day after day 90
      return 1.0 + 90 * 0.002 - (day - 90) * 0.0015;
    }

    for (let day = 0; day < 180; day++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + day);
      const dayAnomalies = anomalyByDay.get(day) ?? [];

      for (const customer of CUSTOMERS) {
        const dailyBase = customer.mrr / 30;
        let amount = dailyBase * trendFactor(day);

        // Apply normal noise (±10%)
        amount *= 0.9 + rand() * 0.2;

        // Apply anomaly effects
        for (const anomaly of dayAnomalies) {
          if (anomaly.customers && !anomaly.customers.includes(customer.id))
            continue;

          switch (anomaly.type) {
            case "CRITICAL_DROP":
              amount *= 0.3 + rand() * 0.1; // ~70% drop
              break;
            case "CRITICAL_MASS_FAIL":
              amount = 0; // Complete payment failure
              break;
            case "HIGH_PAYMENT_FAIL":
              amount = 0; // Payment failed
              break;
            case "HIGH_CHURN_CLUSTER":
              amount = 0; // Customer churned
              break;
            case "MEDIUM_DIP":
              amount *= 0.7 + rand() * 0.1; // 20-30% dip
              break;
            case "MEDIUM_DELAYED":
              amount *= 0.4 + rand() * 0.2; // Delayed = partial collection
              break;
            case "LOW_FLUCTUATION":
              amount *= 0.92 + rand() * 0.05; // 3-8% dip
              break;
            case "LOW_REFUND":
              amount = -(50 + rand() * 200); // Small refund
              break;
          }
        }

        const finalAmount = Math.round(amount * 100) / 100;
        const externalId = `demo-day${day}-${customer.id}`;

        const record = await prisma.revenue.upsert({
          where: { companyId_externalId: { companyId, externalId } },
          update: { amount: finalAmount },
          create: {
            companyId,
            externalId,
            customerId: customer.id,
            customerEmail: customer.email,
            amount: finalAmount,
            currency: "USD",
            mrr: customer.mrr,
            arr: customer.mrr * 12,
            product: `RevSecure ${customer.plan}`,
            plan: customer.plan,
            period: date,
            source: "demo",
            metadata: {
              generatedBy: "seed-demo-data",
              dayOffset: day,
              customerName: customer.name,
            },
          },
        });

        revenueIds.push(record.id);
        totalRevenue += Math.max(0, finalAmount);
        revenueCount++;
      }
    }
    console.log(
      `✅ Seeded ${revenueCount} revenue records — total $${totalRevenue.toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
    );

    // ── 5. Generate leakage records tied to anomaly events ──────────────────
    const leakageCategories: LeakageCategory[] = [
      "CHURN",
      "DUNNING_FAILURE",
      "PRICING_GAP",
      "FAILED_UPSELL",
      "REFUND",
      "DISCOUNT_ABUSE",
      "INVOICE_ERROR",
    ];

    const leakageRecords: Array<{
      category: LeakageCategory;
      title: string;
      description: string;
      amount: number;
      riskScore: number;
    }> = [];

    // CRITICAL leakages
    leakageRecords.push(
      {
        category: "DUNNING_FAILURE",
        title: "Billing outage — $67,500 in failed collections (Day 30)",
        description:
          "Major payment system outage caused 70% revenue drop across 5 accounts.",
        amount: 67500,
        riskScore: 95,
      },
      {
        category: "DUNNING_FAILURE",
        title:
          "Gateway failure — $82,100 in simultaneous payment failures (Day 95)",
        description: "8 enterprise/mid-market payments failed simultaneously.",
        amount: 82100,
        riskScore: 92,
      },
      {
        category: "PRICING_GAP",
        title: "Pricing migration error — $48,200 revenue shortfall (Day 145)",
        description:
          "Incorrect pricing tiers applied after migration caused 65% revenue drop.",
        amount: 48200,
        riskScore: 88,
      },
    );

    // HIGH leakages
    leakageRecords.push(
      {
        category: "DUNNING_FAILURE",
        title: "Acme Corp — 3 failed payment retries ($12,000)",
        description: "Consecutive card declines over 15 days.",
        amount: 12000,
        riskScore: 75,
      },
      {
        category: "CHURN",
        title: "SMB churn cluster — 4 cancellations ($3,550)",
        description: "4 startup customers cancelled within 48 hours.",
        amount: 3550,
        riskScore: 72,
      },
      {
        category: "DUNNING_FAILURE",
        title: "Globex + Umbrella — expired cards ($40,500)",
        description: "Two enterprise accounts with expired payment methods.",
        amount: 40500,
        riskScore: 70,
      },
      {
        category: "CHURN",
        title: "Mid-market churn — Beacon AI & Cipher ($9,400)",
        description: "Downgrade-to-cancel pattern detected.",
        amount: 9400,
        riskScore: 68,
      },
      {
        category: "DUNNING_FAILURE",
        title: "Wayne Enterprises — gateway timeout 3x ($15,000)",
        description: "Payment gateway timeouts on enterprise account.",
        amount: 15000,
        riskScore: 65,
      },
      {
        category: "CHURN",
        title: "SMB churn wave — 3 silent cancellations ($3,650)",
        description: "Customers cancelled without notice.",
        amount: 3650,
        riskScore: 60,
      },
    );

    // MEDIUM leakages
    leakageRecords.push(
      {
        category: "PRICING_GAP",
        title: "Revenue 25% below 7-day average (Day 10)",
        description: "Atlas Data and DeltaOps revenue dipped significantly.",
        amount: 3200,
        riskScore: 48,
      },
      {
        category: "INVOICE_ERROR",
        title: "5 invoices pending > 15 days past due (Day 40)",
        description: "Initech, Cipher, and Echo have outstanding invoices.",
        amount: 5800,
        riskScore: 45,
      },
      {
        category: "PRICING_GAP",
        title: "Daily revenue 22% below rolling average (Day 65)",
        description: "Potential seasonal or pricing issue.",
        amount: 4100,
        riskScore: 42,
      },
      {
        category: "INVOICE_ERROR",
        title: "Late payment cluster — 4 mid-market accounts (Day 85)",
        description: "Multiple accounts with delayed payments.",
        amount: 6500,
        riskScore: 40,
      },
      {
        category: "PRICING_GAP",
        title: "Revenue dip 28% — product launch correlation (Day 120)",
        description: "Acme and Echo affected during product transition.",
        amount: 7200,
        riskScore: 38,
      },
      {
        category: "INVOICE_ERROR",
        title: "Initech — 3 unpaid invoices 20+ days (Day 140)",
        description: "Enterprise account with persistent payment issues.",
        amount: 9800,
        riskScore: 35,
      },
      {
        category: "FAILED_UPSELL",
        title: "SMB segment 20% revenue decline (Day 155)",
        description: "Upsell opportunities missed in declining segment.",
        amount: 2100,
        riskScore: 32,
      },
      {
        category: "PRICING_GAP",
        title: "Post-churn revenue 18% below baseline (Day 170)",
        description: "Revenue not recovering as expected after churn events.",
        amount: 8400,
        riskScore: 30,
      },
    );

    // LOW leakages
    leakageRecords.push(
      {
        category: "REFUND",
        title: "Small refund — Startup Alpha — $120 (Day 20)",
        description: "Prorated refund for billing cycle mismatch.",
        amount: 120,
        riskScore: 15,
      },
      {
        category: "REFUND",
        title: "Prorated credit — Cipher plan change — $280 (Day 50)",
        description: "Mid-cycle plan change credit issued.",
        amount: 280,
        riskScore: 12,
      },
      {
        category: "DUNNING_FAILURE",
        title: "Isolated payment failure — Startup Gamma — $600 (Day 100)",
        description: "Single card decline, likely temporary.",
        amount: 600,
        riskScore: 18,
      },
      {
        category: "DISCOUNT_ABUSE",
        title: "Duplicate charge reversed — DeltaOps — $350 (Day 135)",
        description: "Automatic duplicate detection triggered.",
        amount: 350,
        riskScore: 10,
      },
      {
        category: "REFUND",
        title: "Minor weekend revenue dip — normal pattern (Day 70)",
        description: "Expected seasonal fluctuation.",
        amount: 450,
        riskScore: 8,
      },
    );

    let leakageTotal = 0;
    for (const lk of leakageRecords) {
      const detectedAt = new Date(startDate);
      const dayMatch = lk.title.match(/Day (\d+)/);
      if (dayMatch)
        detectedAt.setDate(detectedAt.getDate() + parseInt(dayMatch[1]!, 10));
      else detectedAt.setDate(detectedAt.getDate() + randInt(0, 179));

      await prisma.revenueLeakage.create({
        data: {
          companyId,
          revenueId: revenueIds[randInt(0, revenueIds.length - 1)],
          category: lk.category,
          title: lk.title,
          description: lk.description,
          amount: lk.amount,
          currency: "USD",
          riskScore: lk.riskScore,
          isResolved: rand() < 0.15,
          detectedAt,
        },
      });
      leakageTotal += lk.amount;
    }
    console.log(
      `✅ Seeded ${leakageRecords.length} leakage records — total $${leakageTotal.toLocaleString("en-US")}`,
    );

    // ── 6. Generate AI insights across severity levels ──────────────────────
    // Ensure AI model catalogue exists
    const modelId = "groq/llama-3.1-8b-instant";
    await prisma.aiModel.upsert({
      where: { id: modelId },
      update: {},
      create: {
        id: modelId,
        displayName: "LLaMA 3.1 8B Instant",
        provider: "Groq",
        isEnabled: true,
        isFree: true,
      },
    });

    interface InsightDef {
      type: string;
      severity: string;
      title: string;
      summary: string;
      riskScore: number;
      windowDays: number;
      data: Record<string, unknown>;
    }

    const insightDefs: InsightDef[] = [
      // ── CRITICAL (3) ────────────────────────────────────────────────────────
      {
        type: "ANOMALY",
        severity: "CRITICAL",
        title: "Severe billing outage — 70% revenue drop detected",
        summary:
          "Statistical analysis detected a catastrophic 70% revenue decline on day 30 affecting 5 key accounts. Immediate intervention required to restore billing pipeline.",
        riskScore: 95,
        windowDays: 7,
        data: {
          totalRevenue: 32450,
          leakageAmount: 67500,
          affectedAccounts: 5,
          dropPercent: 70,
          triggerDay: 30,
          anomalyType: "BILLING_OUTAGE",
        },
      },
      {
        type: "ANOMALY",
        severity: "CRITICAL",
        title: "Payment gateway cascade failure — 8 accounts affected",
        summary:
          "8 enterprise and mid-market accounts experienced simultaneous payment failures totaling $82,100 in unrealized revenue. Gateway provider reported intermittent errors.",
        riskScore: 92,
        windowDays: 14,
        data: {
          totalRevenue: 98200,
          leakageAmount: 82100,
          affectedAccounts: 8,
          failedPayments: 8,
          triggerDay: 95,
          anomalyType: "GATEWAY_CASCADE",
        },
      },
      {
        type: "ANOMALY",
        severity: "CRITICAL",
        title: "Pricing migration error — $48K revenue shortfall",
        summary:
          "Post-migration analysis shows incorrect pricing tiers were applied to 4 accounts, resulting in a 65% revenue shortfall. Manual repricing intervention required.",
        riskScore: 88,
        windowDays: 7,
        data: {
          totalRevenue: 26100,
          leakageAmount: 48200,
          affectedAccounts: 4,
          dropPercent: 65,
          triggerDay: 145,
          anomalyType: "PRICING_MIGRATION_ERROR",
        },
      },

      // ── HIGH (5) ────────────────────────────────────────────────────────────
      {
        type: "ANOMALY",
        severity: "HIGH",
        title: "Enterprise account Acme Corp — payment retry exhaustion",
        summary:
          "3 consecutive payment retries failed for Acme Corp ($12K MRR). Card on file may be expired. Risk of involuntary churn within 7 days.",
        riskScore: 75,
        windowDays: 14,
        data: {
          totalRevenue: 12000,
          leakageAmount: 12000,
          affectedAccounts: 1,
          failedRetries: 3,
          customerIds: ["cus_ent_acme"],
        },
      },
      {
        type: "COMPOSITE",
        severity: "HIGH",
        title: "SMB churn cluster — 4 cancellations in 48h",
        summary:
          "Unusual cluster of 4 SMB cancellations detected. Combined MRR loss of $3,550. Pattern suggests competitive pressure or onboarding issue.",
        riskScore: 72,
        windowDays: 7,
        data: {
          totalRevenue: 3550,
          leakageAmount: 3550,
          affectedAccounts: 4,
          churnRate: 0.27,
          customerIds: ["cus_smb_01", "cus_smb_02", "cus_smb_03", "cus_smb_04"],
        },
      },
      {
        type: "ANOMALY",
        severity: "HIGH",
        title: "Expired card failures — Globex & Umbrella ($40.5K)",
        summary:
          "Two enterprise accounts have expired payment methods. Combined at-risk MRR: $40,500. Card update notifications should be sent urgently.",
        riskScore: 70,
        windowDays: 14,
        data: {
          totalRevenue: 40500,
          leakageAmount: 40500,
          affectedAccounts: 2,
          expiredCards: 2,
          customerIds: ["cus_ent_globex", "cus_ent_umbrella"],
        },
      },
      {
        type: "COMPOSITE",
        severity: "HIGH",
        title: "Mid-market downgrade-to-cancel pattern detected",
        summary:
          "Beacon AI and Cipher Technologies followed a downgrade → cancel pattern. Combined loss: $9,400/month. Win-back campaign recommended.",
        riskScore: 68,
        windowDays: 30,
        data: {
          totalRevenue: 9400,
          leakageAmount: 9400,
          affectedAccounts: 2,
          pattern: "DOWNGRADE_CANCEL",
          customerIds: ["cus_mm_beacon", "cus_mm_cipher"],
        },
      },
      {
        type: "ANOMALY",
        severity: "HIGH",
        title: "Wayne Enterprises — gateway timeout triple failure",
        summary:
          "Enterprise account Wayne Enterprises ($15K MRR) experienced 3 consecutive payment gateway timeouts. Alternate payment method required.",
        riskScore: 65,
        windowDays: 7,
        data: {
          totalRevenue: 15000,
          leakageAmount: 15000,
          affectedAccounts: 1,
          timeoutCount: 3,
          customerIds: ["cus_ent_wayne"],
        },
      },

      // ── MEDIUM (7) ──────────────────────────────────────────────────────────
      {
        type: "ANOMALY",
        severity: "MEDIUM",
        title: "Revenue 25% below weekly average — Atlas & DeltaOps",
        summary:
          "Two mid-market accounts showed 25% revenue decline. May require account health check or pricing review.",
        riskScore: 48,
        windowDays: 7,
        data: {
          totalRevenue: 10300,
          leakageAmount: 3200,
          affectedAccounts: 2,
          dipPercent: 25,
        },
      },
      {
        type: "ANOMALY",
        severity: "MEDIUM",
        title: "5 invoices past due > 15 days — collection needed",
        summary:
          "Initech, Cipher, and Echo have outstanding invoices totaling $5,800. Automated dunning may be insufficient; manual follow-up advised.",
        riskScore: 45,
        windowDays: 14,
        data: {
          totalRevenue: 15600,
          leakageAmount: 5800,
          affectedAccounts: 3,
          overdueInvoices: 5,
          avgDaysOverdue: 18,
        },
      },
      {
        type: "FORECAST",
        severity: "MEDIUM",
        title: "Daily revenue 22% below rolling average — trend alert",
        summary:
          "Forecasting engine detects revenue trending 22% below 14-day rolling average. Correlates with Wayne and Beacon activity drop.",
        riskScore: 42,
        windowDays: 14,
        data: {
          totalRevenue: 78500,
          leakageAmount: 4100,
          dipPercent: 22,
          trend: "DECLINING",
        },
      },
      {
        type: "ANOMALY",
        severity: "MEDIUM",
        title: "Late payment cluster — 4 mid-market accounts",
        summary:
          "Atlas, Beacon, Cipher, and DeltaOps all have delayed payments. Cross-customer pattern suggests billing system latency.",
        riskScore: 40,
        windowDays: 7,
        data: {
          totalRevenue: 19100,
          leakageAmount: 6500,
          affectedAccounts: 4,
          avgDaysLate: 12,
        },
      },
      {
        type: "ANOMALY",
        severity: "MEDIUM",
        title: "Revenue dip 28% — product launch correlation",
        summary:
          "28% dip detected during product transition period. Acme and Echo were primary affected accounts.",
        riskScore: 38,
        windowDays: 14,
        data: {
          totalRevenue: 22200,
          leakageAmount: 7200,
          affectedAccounts: 2,
          dipPercent: 28,
          cause: "PRODUCT_TRANSITION",
        },
      },
      {
        type: "ANOMALY",
        severity: "MEDIUM",
        title: "Initech — persistent payment delays ($9.8K at risk)",
        summary:
          "Enterprise account Initech has 3 invoices unpaid for 20+ days. Escalation to finance team recommended.",
        riskScore: 35,
        windowDays: 30,
        data: {
          totalRevenue: 9800,
          leakageAmount: 9800,
          affectedAccounts: 1,
          unpaidInvoices: 3,
          avgDaysUnpaid: 22,
        },
      },
      {
        type: "FORECAST",
        severity: "MEDIUM",
        title: "Post-churn revenue 18% below expected recovery curve",
        summary:
          "Revenue recovery after churn events is 18% slower than model predictions. New customer acquisition or win-back may be needed.",
        riskScore: 30,
        windowDays: 30,
        data: {
          totalRevenue: 124000,
          leakageAmount: 8400,
          recoveryGap: 18,
          expectedRecoveryDays: 45,
          actualRecoveryDays: 60,
        },
      },

      // ── LOW (8) ──────────────────────────────────────────────────────────────
      {
        type: "ANOMALY",
        severity: "LOW",
        title: "Minor daily variance — within normal range (Day 5)",
        summary:
          "Daily revenue fluctuated ±8% from baseline. Within normal operating parameters.",
        riskScore: 8,
        windowDays: 7,
        data: {
          totalRevenue: 108500,
          leakageAmount: 0,
          variance: 8,
          status: "NORMAL",
        },
      },
      {
        type: "ANOMALY",
        severity: "LOW",
        title: "Small refund — Startup Alpha — $120",
        summary:
          "Prorated refund issued for billing cycle mismatch. No action needed.",
        riskScore: 15,
        windowDays: 7,
        data: {
          totalRevenue: 800,
          leakageAmount: 120,
          affectedAccounts: 1,
          refundAmount: 120,
        },
      },
      {
        type: "ANOMALY",
        severity: "LOW",
        title: "Weekend revenue dip — expected seasonal pattern",
        summary:
          "Revenue dipped 5% on weekend — consistent with historical Saturday/Sunday patterns.",
        riskScore: 5,
        windowDays: 7,
        data: {
          totalRevenue: 103200,
          leakageAmount: 450,
          dipPercent: 5,
          seasonal: true,
        },
      },
      {
        type: "ANOMALY",
        severity: "LOW",
        title: "Prorated credit — Cipher plan change — $280",
        summary:
          "Mid-cycle plan downgrade resulted in prorated credit. Expected behavior.",
        riskScore: 12,
        windowDays: 7,
        data: {
          totalRevenue: 3800,
          leakageAmount: 280,
          affectedAccounts: 1,
          creditType: "PLAN_CHANGE",
        },
      },
      {
        type: "ANOMALY",
        severity: "LOW",
        title: "Isolated payment failure — Startup Gamma — $600",
        summary:
          "Single card decline. Customer notified for card update. First occurrence — not a pattern.",
        riskScore: 18,
        windowDays: 7,
        data: {
          totalRevenue: 600,
          leakageAmount: 600,
          affectedAccounts: 1,
          failureType: "CARD_DECLINED",
        },
      },
      {
        type: "ANOMALY",
        severity: "LOW",
        title: "Duplicate charge reversal — DeltaOps — $350",
        summary:
          "Automatic duplicate detection caught and reversed a double charge. System working as designed.",
        riskScore: 10,
        windowDays: 7,
        data: {
          totalRevenue: 6100,
          leakageAmount: 350,
          affectedAccounts: 1,
          autoResolved: true,
        },
      },
      {
        type: "FORECAST",
        severity: "LOW",
        title: "Minor downward trend in SMB segment — watching",
        summary:
          "Small 3% decline in SMB segment over 30 days. Within forecast confidence interval but flagged for monitoring.",
        riskScore: 6,
        windowDays: 30,
        data: {
          totalRevenue: 28500,
          leakageAmount: 0,
          declinePercent: 3,
          segment: "SMB",
        },
      },
      {
        type: "ANOMALY",
        severity: "LOW",
        title: "Intra-day revenue dip — resolved by EOD",
        summary:
          "Temporary 4% dip in daily collections that self-corrected. Likely payment processing delay.",
        riskScore: 3,
        windowDays: 7,
        data: {
          totalRevenue: 110200,
          leakageAmount: 0,
          dipPercent: 4,
          autoResolved: true,
        },
      },
    ];

    const insightCounts: Record<string, number> = {
      CRITICAL: 0,
      HIGH: 0,
      MEDIUM: 0,
      LOW: 0,
    };

    for (const def of insightDefs) {
      const windowEnd = new Date();
      const windowStart = new Date(windowEnd);
      windowStart.setDate(windowStart.getDate() - def.windowDays);

      await prisma.aIInsight.create({
        data: {
          companyId,
          insightType: def.type,
          severity: def.severity,
          title: def.title,
          summary: def.summary,
          data: def.data,
          riskScore: def.riskScore,
          windowStart,
          windowEnd,
          llmEnriched: false,
          isRead: rand() < 0.2,
          modelId: null,
        },
      });
      insightCounts[def.severity] = (insightCounts[def.severity] ?? 0) + 1;
    }

    console.log(`✅ Seeded ${insightDefs.length} AI insights:`);
    console.log(`   CRITICAL: ${insightCounts.CRITICAL}`);
    console.log(`   HIGH:     ${insightCounts.HIGH}`);
    console.log(`   MEDIUM:   ${insightCounts.MEDIUM}`);
    console.log(`   LOW:      ${insightCounts.LOW}`);

    // ── 7. Ensure AiUsage row ──────────────────────────────────────────────
    await prisma.aiUsage.upsert({
      where: { companyId },
      update: {
        totalRuns: insightDefs.length,
        totalInsights: insightDefs.length,
      },
      create: {
        companyId,
        totalRuns: insightDefs.length,
        totalInsights: insightDefs.length,
        tokensUsed: 0,
        quotaRemaining: 100,
      },
    });

    // ── Summary ─────────────────────────────────────────────────────────────
    console.log("\n══════════════════════════════════════════");
    console.log("  Demo Data Seed Complete");
    console.log("══════════════════════════════════════════");
    console.log(`  Revenue records : ${revenueCount}`);
    console.log(
      `  Total revenue   : $${totalRevenue.toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
    );
    console.log(`  Leakage records : ${leakageRecords.length}`);
    console.log(`  Total leakage   : $${leakageTotal.toLocaleString("en-US")}`);
    console.log(`  AI insights     : ${insightDefs.length}`);
    console.log("══════════════════════════════════════════\n");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("❌ Demo seed failed:", err);
  process.exit(1);
});
