/**
 * generate-demo.ts
 * ──────────────────────────────────────────────────────────────────────────────
 * CLI entrypoint for demo data generation.
 *
 * Usage:
 *   ENABLE_DEMO_DATA=true npm run demo:seed
 *   ENABLE_DEMO_DATA=true DEMO_COMPANY_SLUG=demo-corp npm run demo:seed
 *
 * This script is NEVER called automatically.
 * It must be invoked explicitly by a developer or CI step that explicitly
 * sets ENABLE_DEMO_DATA=true in a non-production environment.
 */

import 'dotenv/config';
import pino from 'pino';
// DemoDataService is imported at module scope (CJS hoists requires).
// Its constructor performs a second production + flag check.
import { DemoDataService } from '../src/infrastructure/demo/DemoDataService';

const logger = pino({
  name: 'generate-demo',
  level: process.env.LOG_LEVEL ?? 'info',
});

// ── Production guard (belt-and-suspenders; DemoDataService also throws) ───────
if (process.env.NODE_ENV === 'production') {
  logger.error('BLOCKED: demo seed must not run in NODE_ENV=production.');
  process.exit(1);
}

if (process.env.ENABLE_DEMO_DATA !== 'true') {
  logger.error(
    'BLOCKED: Set ENABLE_DEMO_DATA=true to run demo seeding. ' +
      'Example: ENABLE_DEMO_DATA=true npm run demo:seed',
  );
  process.exit(1);
}

// ── Import after guards so PrismaClient isn't instantiated if we're exiting ───
// (Note: in TSC/CJS the import is hoisted; the constructor guard is the true runtime check.)

async function main(): Promise<void> {
  logger.info(
    {
      NODE_ENV: process.env.NODE_ENV,
      DEMO_COMPANY_SLUG: process.env.DEMO_COMPANY_SLUG ?? 'demo',
      // NOTE: never log DATABASE_URL or secrets
    },
    'starting demo seed',
  );

  const service = new DemoDataService();

  await service.seed();

  logger.info('demo seed completed successfully');
}

main().catch((err: unknown) => {
  logger.error({ err }, 'demo seed FAILED');
  process.exit(1);
});
