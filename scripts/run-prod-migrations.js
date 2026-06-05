/**
 * run-prod-migrations.js
 * ──────────────────────────────────────────────────────────────────────────────
 * Safe helper to run Prisma schema migrations against the production database.
 *
 * Usage:
 *   PROD_DATABASE_URL="postgresql://..." node scripts/run-prod-migrations.js
 *
 * Or add PROD_DATABASE_URL to your local .env (do NOT commit it) and run:
 *   node scripts/run-prod-migrations.js
 *
 * What it does:
 *   1. Reads PROD_DATABASE_URL from env (fails loudly if missing)
 *   2. Backs up the current .env
 *   3. Temporarily writes a .env with DATABASE_URL = PROD_DATABASE_URL
 *   4. Runs: npx prisma migrate deploy
 *   5. Runs: npx prisma generate
 *   6. Runs: npx prisma migrate status
 *   7. Restores the original .env
 *
 * NEVER commits PROD_DATABASE_URL. It must be set in the shell environment
 * or in a local-only .env that is gitignored.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const PROD_DB_URL = process.env.PROD_DATABASE_URL;

if (!PROD_DB_URL) {
  console.error(
    '\n❌  PROD_DATABASE_URL is not set.\n' +
      '    Add it to your local .env (gitignored) or pass it inline:\n' +
      '    PROD_DATABASE_URL="postgresql://..." node scripts/run-prod-migrations.js\n',
  );
  process.exit(1);
}

const envPath = path.resolve(__dirname, '../.env');
const backupPath = path.resolve(__dirname, '../.env.migration-backup');

// ── 1. Backup .env ────────────────────────────────────────────────────────────
const originalEnv = fs.readFileSync(envPath, 'utf-8');
fs.writeFileSync(backupPath, originalEnv);
console.log('📋  .env backed up to .env.migration-backup');

// ── 2. Write temp .env with production DATABASE_URL ───────────────────────────
const tempEnv = originalEnv.replace(
  /^DATABASE_URL=.*/m,
  `DATABASE_URL=${PROD_DB_URL}`,
);
fs.writeFileSync(envPath, tempEnv);
console.log('🔒  DATABASE_URL temporarily set to PROD_DATABASE_URL');

function restore() {
  fs.writeFileSync(envPath, originalEnv);
  if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
  console.log('♻️   .env restored');
}

try {
  // ── 3. Baseline: mark the full initial-schema migration as already applied ──
  // Production already has all tables (Company, User, Revenue, etc.) from a
  // prior manual migration. The migration file 20260228162239 contains the
  // same initial schema. We resolve it as "applied" so Prisma skips its SQL
  // and does NOT try to CREATE tables that already exist.
  console.log('\n▶  Resolving baseline migration as already applied...\n');
  try {
    execSync(
      'npx prisma migrate resolve --applied "20260228162239_add_data_migration_history"',
      { stdio: 'inherit' },
    );
  } catch (_) {
    // Ignored: if it is already resolved this command exits non-zero on some
    // Prisma versions. The deploy step below will handle the real state.
    console.log('   (resolve step had no-op or warning — continuing)\n');
  }

  // ── 4. Migrate deploy ───────────────────────────────────────────────────────
  // After the baseline resolve, only 20260228120000_add_data_migration_history
  // (DataMigrationHistory table) should be pending and will be applied.
  console.log('\n▶  Running: prisma migrate deploy\n');
  execSync('npx prisma migrate deploy', { stdio: 'inherit' });

  // ── 5. Generate client ──────────────────────────────────────────────────────
  console.log('\n▶  Running: prisma generate\n');
  execSync('npx prisma generate', { stdio: 'inherit' });

  // ── 6. Migration status ─────────────────────────────────────────────────────
  console.log('\n▶  Running: prisma migrate status\n');
  execSync('npx prisma migrate status', { stdio: 'inherit' });

  restore();
  console.log('\n✅  Production migration complete.\n');
} catch (err) {
  restore();
  console.error('\n❌  Migration failed:', err.message);
  process.exit(1);
}
