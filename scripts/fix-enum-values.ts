/**
 * fix-enum-values.ts
 *
 * ALTER TYPE ... ADD VALUE cannot run inside a PostgreSQL transaction.
 * Prisma wraps migrations in transactions, so manually-written enum migration
 * files are silently rolled back. This script runs the ADD VALUE statements
 * directly via $executeRawUnsafe (each in its own implicit transaction).
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ log: ['error'] });

async function main() {
  const providers = ['SQUARE', 'PAYPAL', 'SHOPIFY', 'QUICKBOOKS', 'XERO'];

  for (const p of providers) {
    try {
      await prisma.$executeRawUnsafe(
        `ALTER TYPE "IntegrationProvider" ADD VALUE IF NOT EXISTS '${p}'`
      );
      console.log(`✓ Added ${p} to IntegrationProvider enum`);
    } catch (err: any) {
      if (err?.message?.includes('already exists')) {
        console.log(`– ${p} already in enum, skipping`);
      } else {
        console.error(`✗ Failed to add ${p}:`, err?.message ?? err);
        process.exit(1);
      }
    }
  }

  // Verify
  const result: Array<{ enumlabel: string }> = await prisma.$queryRawUnsafe(
    `SELECT enumlabel FROM pg_enum e
     JOIN pg_type t ON e.enumtypid = t.oid
     WHERE t.typname = 'IntegrationProvider'
     ORDER BY e.enumsortorder`
  );
  console.log('\nFinal enum values:', result.map((r) => r.enumlabel).join(', '));
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
