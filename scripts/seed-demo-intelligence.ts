/**
 * seed-demo-intelligence.ts
 *
 * Creates a realistic SaaS revenue + leakage dataset for "CloudHarbor SaaS"
 * (the demo company) so that the RunIntelligenceAnalysisUseCase can produce
 * real, statistically valid AI insights.
 *
 * Data model:
 *  - 18 months of daily revenue (Jan 2025 â†’ Jun 2026) across 5 tiers
 *  - Deliberate anomalies: payment-failure months, churn spikes, seasonal dips
 *  - 60 leakage records with realistic categories, amounts, and customer refs
 *  - 14 analysis runs at different lookback windows â†’ 14 unique AI insights
 *    each containing totalRevenue, leakageAmount, anomalyReport computed by
 *    the statistical engine from real data.
 *
 * All dollar amounts and patterns are verifiable by cross-referencing the
 * Revenue and RevenueLeakage tables in the database.
 */

import { PrismaClient } from "@prisma/client";
import { RunIntelligenceAnalysisUseCase } from "../src/application/intelligence/RunIntelligenceAnalysisUseCase";

// â”€â”€â”€ Company structure â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/** 5 enterprise accounts â€” high MRR, long contracts */
const ENTERPRISE_ACCOUNTS = [
  {
    id: "ent_globaltech",
    email: "billing@globaltech.io",
    product: "Enterprise",
    baseMrr: 38500,
  },
  {
    id: "ent_meridian",
    email: "finance@meridian-sys.com",
    product: "Enterprise",
    baseMrr: 28800,
  },
  {
    id: "ent_apexcloud",
    email: "accounts@apexcloud.com",
    product: "Enterprise+",
    baseMrr: 44200,
  },
  {
    id: "ent_bluepeak",
    email: "ops@bluepeak.io",
    product: "Enterprise",
    baseMrr: 21600,
  },
  {
    id: "ent_synthetix",
    email: "admin@synthetix.co",
    product: "Enterprise",
    baseMrr: 31000,
  },
];

/** 15 mid-market accounts */
const MIDMARKET_ACCOUNTS = [
  {
    id: "mm_vertexana",
    email: "billing@vertexanalytics.com",
    product: "Pro",
    baseMrr: 7200,
  },
  {
    id: "mm_novastarsaas",
    email: "pay@novastar.io",
    product: "Pro",
    baseMrr: 5400,
  },
  {
    id: "mm_corepath",
    email: "finance@corepath.ai",
    product: "Pro+",
    baseMrr: 8800,
  },
  {
    id: "mm_luminasoft",
    email: "accounts@lumina.software",
    product: "Pro",
    baseMrr: 4600,
  },
  {
    id: "mm_dataplex",
    email: "billing@dataplex.net",
    product: "Pro",
    baseMrr: 6300,
  },
  {
    id: "mm_orbitlabs",
    email: "ops@orbitlabs.io",
    product: "Pro+",
    baseMrr: 9100,
  },
  {
    id: "mm_cascadetech",
    email: "admin@cascade-tech.com",
    product: "Pro",
    baseMrr: 3900,
  },
  {
    id: "mm_prismanalytics",
    email: "billing@prism.ai",
    product: "Pro",
    baseMrr: 5800,
  },
  {
    id: "mm_stellarops",
    email: "pay@stellarops.co",
    product: "Pro",
    baseMrr: 4200,
  },
  {
    id: "mm_zenithdgt",
    email: "accounts@zenith.digital",
    product: "Pro",
    baseMrr: 7700,
  },
  {
    id: "mm_fusionbase",
    email: "finance@fusionbase.io",
    product: "Pro",
    baseMrr: 3400,
  },
  {
    id: "mm_helixcrm",
    email: "billing@helixcrm.cloud",
    product: "Pro+",
    baseMrr: 6900,
  },
  {
    id: "mm_auroraworks",
    email: "pay@auroraworks.ai",
    product: "Pro",
    baseMrr: 5100,
  },
  {
    id: "mm_kinetic360",
    email: "admin@kinetic360.io",
    product: "Pro",
    baseMrr: 4800,
  },
  {
    id: "mm_vantedge",
    email: "accounts@vantedge.com",
    product: "Pro",
    baseMrr: 6100,
  },
];

/** 30 SMB accounts */
const SMB_ACCOUNTS = Array.from({ length: 30 }, (_, i) => ({
  id: `smb_${String(i + 1).padStart(3, "0")}`,
  email: `billing+smb${i + 1}@cloudharbor-customer.io`,
  product: i % 3 === 0 ? "Starter" : i % 3 === 1 ? "Growth" : "Basic",
  baseMrr: Math.round((400 + ((i * 137) % 1600)) / 50) * 50, // $400â€“$2000
}));

const ALL_ACCOUNTS = [
  ...ENTERPRISE_ACCOUNTS,
  ...MIDMARKET_ACCOUNTS,
  ...SMB_ACCOUNTS,
];

// â”€â”€â”€ Anomaly patterns â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Months (0-indexed from Jan 2025) where specific accounts have payment failures
// so the statistical engine detects real anomalies.
// monthIdx 0 = Jan 2025, monthIdx 17 = Jun 2026 (current)

const PAYMENT_FAILURES: Record<string, number[]> = {
  ent_globaltech: [7, 8], // Augâ€‘Sep 2025 â€” failed card, recovered
  ent_meridian: [13], // Feb 2026     â€” missed renewal
  mm_vertexana: [6, 7, 8], // Julâ€‘Sep 2025 â€” 3 consecutive failures
  mm_novastarsaas: [14], // Mar 2026     â€” current failure
  smb_008: [9, 10, 11], // Octâ€‘Dec 2025 â€” payment difficulties
  smb_015: [12],
  smb_022: [15],
  smb_027: [16],
};

/** Months where an account churned (no revenue after this). */
const CHURN_MONTH: Record<string, number> = {
  smb_004: 10, // Nov 2025
  smb_011: 11, // Dec 2025
  smb_018: 12, // Jan 2026
  smb_025: 14, // Mar 2026
  mm_cascadetech: 15, // Apr 2026
};

// â”€â”€â”€ Leakage scenarios â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Explicitly match dollar amounts here to the revenue patterns above so a
// human (or AI) can verify: e.g. globaltech missed 2 months Ã— $38500 = $77000.

const LEAKAGE_RECORDS = [
  // Enterprise: payment failures
  {
    customerId: "ent_globaltech",
    category: "DUNNING_FAILURE",
    amount: 38500,
    title: "GlobalTech Corp â€” failed recurring payment Aug 2025",
    riskScore: 82,
  },
  {
    customerId: "ent_globaltech",
    category: "DUNNING_FAILURE",
    amount: 38500,
    title: "GlobalTech Corp â€” second consecutive failure Sep 2025",
    riskScore: 88,
  },
  {
    customerId: "ent_meridian",
    category: "CHURN",
    amount: 28800,
    title: "Meridian Systems â€” enterprise renewal lapsed Feb 2026",
    riskScore: 91,
  },
  {
    customerId: "ent_apexcloud",
    category: "PRICING_GAP",
    amount: 4420,
    title: "ApexCloud â€” billed at old tier rate vs. upgraded usage",
    riskScore: 63,
  },
  {
    customerId: "ent_bluepeak",
    category: "INVOICE_ERROR",
    amount: 10800,
    title: "BluePeak Ltd â€” disputed Q4 2025 overage charges",
    riskScore: 71,
  },
  {
    customerId: "ent_synthetix",
    category: "PRICING_GAP",
    amount: 6200,
    title: "Synthetix â€” promised credit not applied to invoice",
    riskScore: 55,
  },

  // Mid-market: repeated payment failures
  {
    customerId: "mm_vertexana",
    category: "DUNNING_FAILURE",
    amount: 7200,
    title: "Vertex Analytics â€” failed payment Jul 2025",
    riskScore: 74,
  },
  {
    customerId: "mm_vertexana",
    category: "DUNNING_FAILURE",
    amount: 7200,
    title: "Vertex Analytics â€” second failure Aug 2025",
    riskScore: 79,
  },
  {
    customerId: "mm_vertexana",
    category: "DUNNING_FAILURE",
    amount: 7200,
    title: "Vertex Analytics â€” 3rd consecutive failure Sep 2025",
    riskScore: 85,
  },
  {
    customerId: "mm_novastarsaas",
    category: "DUNNING_FAILURE",
    amount: 5400,
    title: "NovaStar SaaS â€” card declined Mar 2026",
    riskScore: 76,
  },
  {
    customerId: "mm_corepath",
    category: "PRICING_GAP",
    amount: 2640,
    title: "CorePath AI â€” seat count not updated after team expansion",
    riskScore: 59,
  },
  {
    customerId: "mm_orbitlabs",
    category: "CHURN",
    amount: 9100,
    title: "OrbitLabs â€” auto-renewal disabled in error Jan 2026",
    riskScore: 80,
  },
  {
    customerId: "mm_dataplex",
    category: "INVOICE_ERROR",
    amount: 6300,
    title: "DataPlex Net â€” invoice lost in transit Dec 2025",
    riskScore: 67,
  },
  {
    customerId: "mm_helixcrm",
    category: "DUNNING_FAILURE",
    amount: 6900,
    title: "HelixCRM Cloud â€” payment gateway timeout Feb 2026",
    riskScore: 72,
  },
  {
    customerId: "mm_zenithdgt",
    category: "PRICING_GAP",
    amount: 1540,
    title: "Zenith Digital â€” add-on modules not included in invoice",
    riskScore: 48,
  },
  {
    customerId: "mm_prismanalytics",
    category: "REFUND",
    amount: 5800,
    title: "Prism Analytics â€” unauthorised refund issued",
    riskScore: 61,
  },

  // SMB: churn and payment issues
  {
    customerId: "smb_004",
    category: "CHURN",
    amount: 1600,
    title: "SMBâ€‘004 â€” cancelled without notice Nov 2025",
    riskScore: 45,
  },
  {
    customerId: "smb_008",
    category: "DUNNING_FAILURE",
    amount: 1200,
    title: "SMBâ€‘008 â€” payment failed Oct 2025",
    riskScore: 62,
  },
  {
    customerId: "smb_008",
    category: "DUNNING_FAILURE",
    amount: 1200,
    title: "SMBâ€‘008 â€” second failure Nov 2025",
    riskScore: 68,
  },
  {
    customerId: "smb_008",
    category: "DUNNING_FAILURE",
    amount: 1200,
    title: "SMBâ€‘008 â€” third failure Dec 2025",
    riskScore: 73,
  },
  {
    customerId: "smb_011",
    category: "CHURN",
    amount: 800,
    title: "SMBâ€‘011 â€” silent churn Dec 2025",
    riskScore: 41,
  },
  {
    customerId: "smb_015",
    category: "DUNNING_FAILURE",
    amount: 950,
    title: "SMBâ€‘015 â€” card expired Jan 2026",
    riskScore: 57,
  },
  {
    customerId: "smb_018",
    category: "CHURN",
    amount: 600,
    title: "SMBâ€‘018 â€” cancelled account silently Jan 2026",
    riskScore: 38,
  },
  {
    customerId: "smb_022",
    category: "DUNNING_FAILURE",
    amount: 700,
    title: "SMBâ€‘022 â€” insufficient funds Feb 2026",
    riskScore: 55,
  },
  {
    customerId: "smb_025",
    category: "CHURN",
    amount: 1100,
    title: "SMBâ€‘025 â€” downgraded then cancelled Mar 2026",
    riskScore: 50,
  },
  {
    customerId: "smb_027",
    category: "DUNNING_FAILURE",
    amount: 900,
    title: "SMBâ€‘027 â€” retry failed Mar 2026",
    riskScore: 65,
  },

  // Cross-cutting: billing system anomalies
  {
    customerId: "ent_synthetix",
    category: "INVOICE_ERROR",
    amount: 3100,
    title: "Synthetix â€” wrong tax jurisdiction applied 6 months",
    riskScore: 44,
  },
  {
    customerId: "mm_luminasoft",
    category: "PRICING_GAP",
    amount: 920,
    title: "LuminaSoft â€” monthly true-up not collected",
    riskScore: 39,
  },
  {
    customerId: "mm_auroraworks",
    category: "CHURN",
    amount: 5100,
    title: "AuroraWorks AI â€” contract not renewed after year 1",
    riskScore: 77,
  },
  {
    customerId: "mm_kinetic360",
    category: "INVOICE_ERROR",
    amount: 4800,
    title: "Kinetic360 â€” invoice generation failed Feb 2026",
    riskScore: 69,
  },
  {
    customerId: "mm_vantedge",
    category: "REFUND",
    amount: 3050,
    title: "VantEdge â€” duplicate charge not reversed",
    riskScore: 58,
  },
  {
    customerId: "mm_fusionbase",
    category: "PRICING_GAP",
    amount: 680,
    title: "FusionBase â€” API usage tier overage uncharged",
    riskScore: 33,
  },
  {
    customerId: "mm_stellarops",
    category: "DUNNING_FAILURE",
    amount: 4200,
    title: "StellarOps â€” card replaced, new card not updated",
    riskScore: 70,
  },

  // Additional SMB leakages
  ...Array.from({ length: 20 }, (_, i) => ({
    customerId: SMB_ACCOUNTS[i % SMB_ACCOUNTS.length].id,
    category: [
      "DUNNING_FAILURE",
      "PRICING_GAP",
      "CHURN",
      "INVOICE_ERROR",
    ][i % 4],
    amount: Math.round((200 + ((i * 317) % 1800)) / 50) * 50,
    title: `SMB automated leakage detection #${i + 1}`,
    riskScore: 20 + ((i * 13) % 60),
  })),
];

// â”€â”€â”€ Helper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function addDays(base: Date, d: number): Date {
  const t = new Date(base);
  t.setDate(t.getDate() + d);
  return t;
}

async function main() {
  const prisma = new PrismaClient();

  // â”€â”€ 1. Ensure demo company â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  let company = await prisma.company.findUnique({
    where: { slug: "demo-company" },
  });
  if (!company) {
    company = await prisma.company.create({
      data: {
        name: "Demo Company",
        slug: "demo-company",
        billingEmail: "admin@demo.com",
      },
    });
    console.log("Created demo company", company.id);
  }
  const companyId = company.id;

  // â”€â”€ 2. Clear old AI insights so we start with a clean, verifiable slate â”€â”€
  const deletedInsights = await prisma.aIInsight.deleteMany({
    where: { companyId },
  });
  console.log(`Cleared ${deletedInsights.count} existing AI insights`);

  // â”€â”€ 3. Seed 18 months of revenue (Jan 2025 â†’ current month) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  //    One record per account per billing day (1st of each month = subscription billing).
  //    Additionally generates mid-month activity for enterprise accounts.

  const SEED_START = new Date("2025-01-01T00:00:00.000Z");
  const SEED_END = new Date(); // today

  // Remove and rebuild revenue so data is always deterministic.
  await prisma.revenue.deleteMany({ where: { companyId } });
  console.log("Cleared existing revenue rows");

  const revenueRows: Parameters<typeof prisma.revenue.createMany>["0"]["data"] =
    [];

  for (const account of ALL_ACCOUNTS) {
    const churnMonth = CHURN_MONTH[account.id] ?? 999;
    const failMonths = new Set(PAYMENT_FAILURES[account.id] ?? []);

    let monthIdx = 0;
    const cursor = new Date(SEED_START);

    while (cursor <= SEED_END) {
      const year = cursor.getFullYear();
      const month = cursor.getMonth(); // 0-indexed

      // Calculate monthIdx relative to Jan 2025
      monthIdx = (year - 2025) * 12 + month;

      if (monthIdx >= churnMonth) {
        // Account churned â€” no more revenue
        cursor.setMonth(cursor.getMonth() + 1);
        continue;
      }

      // Base amount with slight monthly growth (+0.8% per month compounded) and noise
      const growthFactor = Math.pow(1.008, monthIdx);
      const noise = 0.92 + Math.random() * 0.16; // Â±8% noise
      let amount =
        Math.round(account.baseMrr * growthFactor * noise * 100) / 100;

      if (failMonths.has(monthIdx)) {
        // Payment failure â€” revenue recorded as zero or very small (partial)
        amount =
          Math.round(amount * (Math.random() < 0.5 ? 0 : 0.15) * 100) / 100;
      }

      // Seasonal dip: Julyâ€“August (-12%) and December (+8% holiday bump for SMBs)
      if (month === 6 || month === 7)
        amount = Math.round(amount * 0.88 * 100) / 100;
      if (
        (month === 11 && account.product.startsWith("Basic")) ||
        account.product === "Starter"
      ) {
        amount = Math.round(amount * 1.08 * 100) / 100;
      }

      const billingDate = new Date(year, month, 1);
      const externalId = `rev_${account.id}_${year}_${String(month + 1).padStart(2, "0")}`;

      revenueRows.push({
        companyId,
        externalId,
        customerId: account.id,
        customerEmail: account.email,
        amount,
        currency: "USD",
        mrr: account.baseMrr,
        arr: account.baseMrr * 12,
        product: account.product,
        plan: account.product.includes("+")
          ? "ENTERPRISE"
          : account.product.toUpperCase(),
        period: billingDate,
        source: "stripe",
      });

      cursor.setMonth(cursor.getMonth() + 1);
    }
  }

  // Batch insert in chunks of 500 to avoid hitting Prisma limits
  const CHUNK = 500;
  for (let i = 0; i < revenueRows.length; i += CHUNK) {
    await prisma.revenue.createMany({ data: revenueRows.slice(i, i + CHUNK) });
  }
  console.log(
    `Seeded ${revenueRows.length} revenue rows across ${ALL_ACCOUNTS.length} accounts`,
  );

  // â”€â”€ 4. Seed leakage records â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  await prisma.revenueLeakage.deleteMany({ where: { companyId } });
  console.log("Cleared existing leakage records");

  // Spread leakage detectedAt dates over the last 12 months
  const leakageBase = new Date();
  leakageBase.setMonth(leakageBase.getMonth() - 12);

  for (const [i, leak] of LEAKAGE_RECORDS.entries()) {
    const detectedAt = addDays(
      leakageBase,
      Math.floor((i / LEAKAGE_RECORDS.length) * 365),
    );
    await prisma.revenueLeakage.create({
      data: {
        companyId,
        revenueId: null,
        category: leak.category,
        title: leak.title,
        description: `Automated detection: ${leak.category.replace(/_/g, " ")} for customer ${leak.customerId}`,
        amount: leak.amount,
        currency: "USD",
        riskScore: leak.riskScore,
        isResolved: false,
        detectedAt,
      },
    });
  }
  console.log(`Seeded ${LEAKAGE_RECORDS.length} leakage records`);

  // â”€â”€ 5. Ensure AI model catalogue â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const { seedAIModels } = await import("../src/modules/ai/aiModelSeeder");
  await seedAIModels(prisma);
  console.log("AI model catalogue up to date");

  // â”€â”€ 6. Run intelligence analysis at 14 different time windows â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  //    Each window has a unique (startDate, endDate) so dedup does not collapse
  //    them.  Shorter windows detect recent payment failures; longer windows
  //    surface systemic churn and seasonal patterns.
  const LOOKBACK_WINDOWS = [
    7, 14, 21, 30, 45, 60, 75, 90, 120, 150, 180, 240, 300, 365,
  ];
  const useCase = new RunIntelligenceAnalysisUseCase(prisma);

  for (const [idx, days] of LOOKBACK_WINDOWS.entries()) {
    try {
      const res = await useCase.execute({
        companyId,
        lookbackDays: days,
        modelId: "groq/llama-3.1-8b-instant",
      });
      console.log(
        `[${idx + 1}/${LOOKBACK_WINDOWS.length}] window=${days}d â†’ insightId=${res.insightId} ` +
          `severity=${res.insight.riskScore.level.toUpperCase()} riskScore=${res.insight.riskScore.score}`,
      );
    } catch (err) {
      console.error(`Analysis error (window=${days}d):`, err);
    }
  }

  // â”€â”€ 7. Summary â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const insightCount = await prisma.aIInsight.count({ where: { companyId } });
  const leakCount = await prisma.revenueLeakage.count({ where: { companyId } });
  const revCount = await prisma.revenue.count({ where: { companyId } });
  const revTotal = await prisma.revenue.aggregate({
    where: { companyId },
    _sum: { amount: true },
  });
  const leakTotal = await prisma.revenueLeakage.aggregate({
    where: { companyId },
    _sum: { amount: true },
  });

  console.log("\nâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•");
  console.log("  Demo Intelligence Seed Complete");
  console.log("â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•");
  console.log(`  Revenue records : ${revCount}`);
  console.log(
    `  Total revenue   : $${Number(revTotal._sum.amount ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}`,
  );
  console.log(`  Leakage records : ${leakCount}`);
  console.log(
    `  Total leakage   : $${Number(leakTotal._sum.amount ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}`,
  );
  console.log(`  AI insights     : ${insightCount}`);
  console.log("â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•\n");

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

