/**
 * prisma/seed.ts  — legacy POC seed (kept for reference)
 * ──────────────────────────────────────────────────────────────────────────────
 * This file is NOT called automatically during schema migrations.
 * There is no `prisma.seed` entry in package.json, so `prisma migrate dev`
 * will NOT invoke it.
 *
 * To run manually:  npm run db:seed
 *
 * For richer, idempotent demo data use the new DemoDataService:
 *   ENABLE_DEMO_DATA=true npm run demo:seed
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Create demo company
  const passwordHash = await bcrypt.hash('password123', 12);

  const company = await prisma.company.upsert({
    where: { slug: 'demo-company' },
    update: {},
    create: {
      name: 'Demo Company',
      slug: 'demo-company',
      billingEmail: 'admin@demo.com',
      plan: 'GROWTH',
      subscriptionStatus: 'ACTIVE',
    },
  });

  // Create admin user
  const admin = await prisma.user.upsert({
    where: { companyId_email: { companyId: company.id, email: 'admin@demo.com' } },
    update: {},
    create: {
      companyId: company.id,
      email: 'admin@demo.com',
      name: 'Admin User',
      passwordHash,
      role: 'COMPANY_ADMIN',
      emailVerified: true,
    },
  });

  // Create analyst user
  await prisma.user.upsert({
    where: { companyId_email: { companyId: company.id, email: 'analyst@demo.com' } },
    update: {},
    create: {
      companyId: company.id,
      email: 'analyst@demo.com',
      name: 'Analyst User',
      passwordHash,
      role: 'ANALYST',
      emailVerified: true,
    },
  });

  // Seed sample revenue records
  const now = new Date();
  const revenues = [];
  for (let i = 0; i < 12; i++) {
    const period = new Date(now);
    period.setMonth(period.getMonth() - i);
    const amount = Math.round((5000 + Math.random() * 45000) * 100) / 100;

    revenues.push(
      await prisma.revenue.upsert({
        where: { companyId_externalId: { companyId: company.id, externalId: `seed-rev-${i}` } },
        update: {},
        create: {
          companyId: company.id,
          externalId: `seed-rev-${i}`,
          customerId: `cus_demo_${i}`,
          customerEmail: `customer${i}@example.com`,
          amount,
          currency: 'USD',
          mrr: amount / 12,
          arr: amount,
          product: i % 2 === 0 ? 'SaaS Pro' : 'SaaS Starter',
          plan: i % 2 === 0 ? 'PRO' : 'STARTER',
          period,
          source: 'stripe',
        },
      }),
    );
  }

  // Seed sample leakages
  const categories: Array<{
    category: any;
    title: string;
    amount: number;
    riskScore: number;
  }> = [
    { category: 'CHURN', title: 'High-value customer churn detected', amount: 4200, riskScore: 85 },
    { category: 'DUNNING_FAILURE', title: 'Failed payment recovery', amount: 1500, riskScore: 70 },
    { category: 'PRICING_GAP', title: 'Underpriced enterprise tier', amount: 8000, riskScore: 60 },
    { category: 'FAILED_UPSELL', title: 'Upsell opportunity missed', amount: 2200, riskScore: 45 },
    { category: 'REFUND', title: 'Unusual refund pattern', amount: 900, riskScore: 30 },
  ];

  for (let i = 0; i < categories.length; i++) {
    const { category, title, amount, riskScore } = categories[i]!;
    await prisma.revenueLeakage.create({
      data: {
        companyId: company.id,
        revenueId: revenues[i]?.id,
        category,
        title,
        amount,
        currency: 'USD',
        riskScore,
      },
    }).catch(() => {}); // idempotent
  }

  console.log(`✅ Seeded company: ${company.name} (${company.id})`);
  console.log(`✅ Seeded admin: admin@demo.com / password123`);
  console.log(`✅ Seeded analyst: analyst@demo.com / password123`);
  console.log(`✅ Seeded ${revenues.length} revenue records`);
  console.log(`✅ Seeded ${categories.length} leakage records`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
