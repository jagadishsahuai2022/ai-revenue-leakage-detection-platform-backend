/**
 * DemoDataService
 * ──────────────────────────────────────────────────────────────────────────────
 * Generates realistic demo data for the RevSecureCloud POC.
 *
 * Safety guarantees:
 *   - Throws if NODE_ENV === 'production'   (step 7 cloud migration policy)
 *   - Throws if ENABLE_DEMO_DATA !== 'true' (step 1 env guard)
 *   - Idempotent: safe to call multiple times (upsert / skip-if-exists)
 *   - Does NOT require Redis
 *   - Does NOT touch any routes or API shapes
 *
 * Revenue trend simulation:
 *   - Months 1–18  : gradual growth (+6–10% MoM with noise)
 *   - Month 19     : sudden drop (~40% below prior month)
 *   - Months 20–24 : slow recovery (+3–5% MoM)
 *   - ~5 records   : zero-invoice (billing failures)
 *   - ~5 records   : underbilling (amount is 10–25% of expected)
 *
 * Isolation rules (for demo company):
 *   Blocked: webhook ingestion, connector creation, agent execution
 *   Allowed: AI analysis, dashboard access, insight viewing
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import pino from "pino";
import { isDemoMode, demoCompanySlug } from "../../config/env";

const logger = pino({
  name: "DemoDataService",
  level: process.env.LOG_LEVEL ?? "info",
});

// ─── Types ────────────────────────────────────────────────────────────────────

interface DemoCompany {
  id: string;
  slug: string;
  name: string;
}

// ─── Revenue trend helper ─────────────────────────────────────────────────────

function buildRevenueAmounts(count: number): number[] {
  const amounts: number[] = [];
  const dropMonth = Math.floor(count * 0.72); // ~72% through = sudden drop
  let baseAmount = 4_000; // starting MRR per customer record

  for (let i = 0; i < count; i++) {
    if (i < dropMonth) {
      // Gradual growth: 6–10% MoM
      const growthRate = 0.06 + Math.random() * 0.04;
      baseAmount = baseAmount * (1 + growthRate);
    } else if (i === dropMonth) {
      // Sudden drop: −35–45%
      const dropRate = 0.35 + Math.random() * 0.1;
      baseAmount = baseAmount * (1 - dropRate);
    } else {
      // Slow recovery: 3–5% MoM
      const recoveryRate = 0.03 + Math.random() * 0.02;
      baseAmount = baseAmount * (1 + recoveryRate);
    }

    // Apply per-record noise ±12%
    const noise = 0.88 + Math.random() * 0.24;
    amounts.push(Math.round(baseAmount * noise * 100) / 100);
  }

  return amounts;
}

// ─── Demo Isolation Guards ────────────────────────────────────────────────────
// Static utilities that controllers / services call to gate operations on the
// demo company.  These are side-effect-free and safe to call unconditionally.

/**
 * Returns true if the given company slug matches the demo company AND demo mode
 * is active.  Returns false if demo mode is off — in that case the company
 * should be completely invisible.
 */
export function isDemoCompany(companySlug: string | undefined): boolean {
  if (!companySlug) return false;
  return isDemoMode && companySlug === demoCompanySlug;
}

/**
 * If demo mode is OFF, any API that lists companies must exclude the demo slug.
 * Use this to build Prisma `where.NOT` clause fragments.
 */
export function demoExclusionFilter(): { slug?: { not: string } } {
  if (isDemoMode) return {}; // Demo visible — no filter
  return { slug: { not: demoCompanySlug } }; // Hide demo company
}

// Operations blocked on the demo company
const BLOCKED_DEMO_OPERATIONS = new Set([
  "WEBHOOK_INGESTION",
  "CONNECTOR_CREATION",
  "AGENT_EXECUTION",
]);

/**
 * Throws if the requested operation is blocked for the demo company.
 * Allowed operations: AI analysis, dashboard access, insight viewing.
 */
export function assertDemoOperationAllowed(
  companySlug: string | undefined,
  operation: string,
): void {
  if (!isDemoCompany(companySlug)) return; // Not demo → always allowed
  if (BLOCKED_DEMO_OPERATIONS.has(operation)) {
    throw new Error(
      `[DemoIsolation] Operation "${operation}" is blocked for the demo company ` +
        `("${demoCompanySlug}"). Demo mode only allows AI analysis, dashboard access, ` +
        `and insight viewing.`,
    );
  }
}

// ─── DemoDataService ──────────────────────────────────────────────────────────

export class DemoDataService {
  private readonly db: PrismaClient;
  private readonly slug: string;

  constructor() {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "[DemoDataService] Demo seeding is DISABLED in NODE_ENV=production. " +
          "Set ENABLE_DEMO_DATA=true only in development or staging.",
      );
    }

    if (process.env.ENABLE_DEMO_DATA !== "true") {
      throw new Error(
        '[DemoDataService] ENABLE_DEMO_DATA must be set to "true" to run demo seeding.',
      );
    }

    this.db = new PrismaClient();
    this.slug = process.env.DEMO_COMPANY_SLUG ?? "demo";
  }

  // ── ensureDemoCompany ──────────────────────────────────────────────────────

  async ensureDemoCompany(): Promise<DemoCompany> {
    const company = await this.db.company.upsert({
      where: { slug: this.slug },
      update: {},
      create: {
        name: "Demo Corp",
        slug: this.slug,
        billingEmail: `admin@${this.slug}.example.com`,
        plan: "GROWTH",
        subscriptionStatus: "ACTIVE",
        settings: {},
      },
    });

    logger.info(
      { companyId: company.id, slug: company.slug },
      "demo company ensured",
    );
    return { id: company.id, slug: company.slug, name: company.name };
  }

  // ── createDemoUsers ────────────────────────────────────────────────────────

  async createDemoUsers(companyId: string): Promise<void> {
    const passwordHash = await bcrypt.hash("demo-password-123", 12);

    const users: Array<{
      email: string;
      name: string;
      role: "COMPANY_ADMIN" | "ANALYST" | "VIEWER";
    }> = [
      {
        email: `admin@${this.slug}.example.com`,
        name: "Demo Admin",
        role: "COMPANY_ADMIN",
      },
      {
        email: `analyst@${this.slug}.example.com`,
        name: "Demo Analyst",
        role: "ANALYST",
      },
      {
        email: `viewer@${this.slug}.example.com`,
        name: "Demo Viewer",
        role: "VIEWER",
      },
    ];

    for (const u of users) {
      await this.db.user.upsert({
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
      logger.info({ email: u.email, role: u.role }, "demo user ensured");
    }
  }

  // ── createDemoRevenueRecords ───────────────────────────────────────────────

  async createDemoRevenueRecords(count: number = 75): Promise<string[]> {
    // Check how many already exist for this demo company
    const company = await this.db.company.findUnique({
      where: { slug: this.slug },
    });
    if (!company)
      throw new Error(
        "[DemoDataService] Demo company not found — call ensureDemoCompany() first.",
      );

    const existing = await this.db.revenue.count({
      where: { companyId: company.id },
    });
    if (existing >= count) {
      logger.info(
        { existing, count },
        "demo revenue records already exist — skipping",
      );
      const ids = await this.db.revenue.findMany({
        where: { companyId: company.id },
        select: { id: true },
        take: count,
      });
      return ids.map((r) => r.id);
    }

    const amounts = buildRevenueAmounts(count);
    const zeroIndices = new Set<number>();
    const underbillIndices = new Set<number>();

    // Pick 5 random indices for zero invoices (billing failures)
    while (zeroIndices.size < 5)
      zeroIndices.add(Math.floor(Math.random() * count));
    // Pick 5 more for underbilling (not overlapping zeros)
    while (underbillIndices.size < 5) {
      const idx = Math.floor(Math.random() * count);
      if (!zeroIndices.has(idx)) underbillIndices.add(idx);
    }

    const now = new Date();
    const customers = [
      {
        id: `demo_cus_alpha`,
        email: `alpha@${this.slug}-customer.example.com`,
      },
      { id: `demo_cus_beta`, email: `beta@${this.slug}-customer.example.com` },
      {
        id: `demo_cus_gamma`,
        email: `gamma@${this.slug}-customer.example.com`,
      },
    ];

    const products = [
      { product: "RevSecure Pro", plan: "PRO" },
      { product: "RevSecure Starter", plan: "STARTER" },
      { product: "RevSecure Enterprise", plan: "ENTERPRISE" },
    ];

    const revenueIds: string[] = [];

    for (let i = 0; i < count; i++) {
      const externalId = `demo-rev-${String(i + 1).padStart(3, "0")}`;
      const period = new Date(now);
      // Spread records over ~24 months going backwards
      period.setDate(1);
      period.setHours(0, 0, 0, 0);
      period.setMonth(period.getMonth() - Math.floor((count - i - 1) / 3));

      const customer = customers[i % customers.length]!;
      const productInfo = products[i % products.length]!;

      let finalAmount = amounts[i]!;

      // Override for zero invoices
      if (zeroIndices.has(i)) {
        finalAmount = 0;
      } else if (underbillIndices.has(i)) {
        // Underbilling: 10–25% of expected
        finalAmount =
          Math.round(finalAmount * (0.1 + Math.random() * 0.15) * 100) / 100;
      }

      const mrr = finalAmount / 12;
      const arr = finalAmount;

      const record = await this.db.revenue.upsert({
        where: { companyId_externalId: { companyId: company.id, externalId } },
        update: {},
        create: {
          companyId: company.id,
          externalId,
          customerId: customer.id,
          customerEmail: customer.email,
          amount: finalAmount,
          currency: "USD",
          mrr,
          arr,
          product: productInfo.product,
          plan: productInfo.plan,
          period,
          source: "demo",
          metadata: {
            isZeroInvoice: zeroIndices.has(i),
            isUnderbilling: underbillIndices.has(i),
            batchIndex: i,
          },
        },
      });

      revenueIds.push(record.id);
    }

    logger.info(
      { count: revenueIds.length, companyId: company.id },
      "demo revenue records created",
    );
    return revenueIds;
  }

  // ── createDemoLeakages ─────────────────────────────────────────────────────

  async createDemoLeakages(revenueIds: string[]): Promise<void> {
    const company = await this.db.company.findUnique({
      where: { slug: this.slug },
    });
    if (!company) throw new Error("[DemoDataService] Demo company not found.");

    const existing = await this.db.revenueLeakage.count({
      where: { companyId: company.id },
    });
    if (existing >= 10) {
      logger.info({ existing }, "demo leakages already exist — skipping");
      return;
    }

    const leakageTemplates: Array<{
      category:
        | "CHURN"
        | "DUNNING_FAILURE"
        | "PRICING_GAP"
        | "FAILED_UPSELL"
        | "REFUND"
        | "DISCOUNT_ABUSE"
        | "INVOICE_ERROR";
      title: string;
      description: string;
      amountMultiplier: number; // relative to a baseline
      riskScore: number;
    }> = [
      {
        category: "CHURN",
        title: "High-value customer churned (Q1)",
        description:
          'Customer "alpha" downgraded and churned after pricing increase.',
        amountMultiplier: 1.0,
        riskScore: 90,
      },
      {
        category: "CHURN",
        title: "Mid-tier customer churn (Q2)",
        description: 'Customer "beta" did not renew annual plan.',
        amountMultiplier: 0.7,
        riskScore: 80,
      },
      {
        category: "DUNNING_FAILURE",
        title: "Failed payment recovery — alpha",
        description: "Card declined 3 times; retries exhausted.",
        amountMultiplier: 0.4,
        riskScore: 75,
      },
      {
        category: "DUNNING_FAILURE",
        title: "Subscription past-due > 30 days",
        description: "No valid payment method on file.",
        amountMultiplier: 0.3,
        riskScore: 70,
      },
      {
        category: "PRICING_GAP",
        title: "Underpriced Pro tier vs market",
        description: "Competitor analysis shows 20% cheaper pricing.",
        amountMultiplier: 1.5,
        riskScore: 65,
      },
      {
        category: "PRICING_GAP",
        title: "Enterprise features leaking to Starter",
        description: "API rate limits not enforced for legacy accounts.",
        amountMultiplier: 0.8,
        riskScore: 60,
      },
      {
        category: "FAILED_UPSELL",
        title: "Upsell to Enterprise missed — gamma",
        description:
          "Customer requested extra seats but rep did not follow up.",
        amountMultiplier: 0.6,
        riskScore: 55,
      },
      {
        category: "DISCOUNT_ABUSE",
        title: "Coupon reused beyond intended limit",
        description: "Same 30% coupon applied to 4 renewals.",
        amountMultiplier: 0.3,
        riskScore: 50,
      },
      {
        category: "REFUND",
        title: "Unusual refund spike — March",
        description: "Refund rate 4× baseline; root cause: billing bug.",
        amountMultiplier: 0.25,
        riskScore: 45,
      },
      {
        category: "INVOICE_ERROR",
        title: "Invoice amount mismatch — beta",
        description: "Invoice total differs from contracted amount by $200.",
        amountMultiplier: 0.1,
        riskScore: 40,
      },
      {
        category: "INVOICE_ERROR",
        title: "Duplicate invoice sent — April cycle",
        description: "Customer billed twice for same period; refund issued.",
        amountMultiplier: 0.2,
        riskScore: 35,
      },
      {
        category: "FAILED_UPSELL",
        title: "Annual plan conversion opportunity — alpha",
        description:
          "Monthly plan user in 8th month; annual offer not presented.",
        amountMultiplier: 0.5,
        riskScore: 50,
      },
      {
        category: "CHURN",
        title: "Trial-to-paid conversion gap",
        description:
          "12 trial accounts expired without conversion this quarter.",
        amountMultiplier: 0.9,
        riskScore: 72,
      },
      {
        category: "DISCOUNT_ABUSE",
        title: "Internal employee discount exposed",
        description: "Internal 50% code leaked publicly via Slack.",
        amountMultiplier: 0.2,
        riskScore: 38,
      },
      {
        category: "PRICING_GAP",
        title: "Volume discount not reflected in contract",
        description:
          "Customer on 5-seat contract upgraded to 12 seats with no uplift.",
        amountMultiplier: 0.6,
        riskScore: 55,
      },
    ];

    const baseline = 3_000; // USD baseline for leakage amounts

    for (let i = 0; i < leakageTemplates.length; i++) {
      const t = leakageTemplates[i]!;
      const amount =
        Math.round(
          baseline * t.amountMultiplier * (0.85 + Math.random() * 0.3) * 100,
        ) / 100;
      const revenueId = revenueIds[i % revenueIds.length] ?? undefined;

      await this.db.revenueLeakage.create({
        data: {
          companyId: company.id,
          revenueId,
          category: t.category,
          title: t.title,
          description: t.description,
          amount,
          currency: "USD",
          riskScore: t.riskScore,
          isResolved: Math.random() < 0.2, // ~20% already resolved
          metadata: { generatedBy: "DemoDataService", batchIndex: i },
        },
      });

      logger.debug(
        { category: t.category, amount, riskScore: t.riskScore },
        "demo leakage created",
      );
    }

    logger.info(
      { count: leakageTemplates.length, companyId: company.id },
      "demo leakages created",
    );
  }

  // ── seed (top-level orchestrator) ─────────────────────────────────────────

  async seed(): Promise<void> {
    logger.info({ slug: this.slug }, "▶ DemoDataService.seed() start");

    try {
      const company = await this.ensureDemoCompany();
      await this.createDemoUsers(company.id);
      const revenueIds = await this.createDemoRevenueRecords(75);
      await this.createDemoLeakages(revenueIds);
      logger.info({ slug: this.slug }, "✅ DemoDataService.seed() complete");
    } finally {
      await this.db.$disconnect();
    }
  }
}
