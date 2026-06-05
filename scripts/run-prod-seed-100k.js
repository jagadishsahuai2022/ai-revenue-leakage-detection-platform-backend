/**
 * scripts/run-prod-seed-100k.js
 * ──────────────────────────────────────────────────────────────────────────────
 * Safely seeds ~100k Revenue + Invoice rows into the production Neon database
 * without touching the local dev DATABASE_URL.
 *
 * Usage:
 *   node scripts/run-prod-seed-100k.js
 *
 * Requires PROD_DATABASE_URL in local .env (gitignored) or shell env.
 * Optional:
 *   WIPE=true node scripts/run-prod-seed-100k.js   ← clears 100k-prefixed rows first
 *
 * What it does:
 *   1. Reads PROD_DATABASE_URL from env (fails loudly if missing)
 *   2. Backs up the current .env
 *   3. Temporarily writes a .env with DATABASE_URL = PROD_DATABASE_URL
 *   4. Runs: npx tsx scripts/seed-100k.ts
 *   5. Restores the original .env
 *
 * NEVER commits PROD_DATABASE_URL. It must be set in the shell environment
 * or in a local-only .env that is gitignored.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const PROD_DB_URL = process.env.PROD_DATABASE_URL;
const WIPE = process.env.WIPE === 'true';

if (!PROD_DB_URL) {
  console.error(
    '\n❌  PROD_DATABASE_URL is not set.\n' +
      '    Add it to your local .env (gitignored) or pass it inline:\n' +
      '    PROD_DATABASE_URL="postgresql://..." node scripts/run-prod-seed-100k.js\n',
  );
  process.exit(1);
}

const envPath = path.resolve(__dirname, '../.env');
const backupPath = path.resolve(__dirname, '../.env.seed-backup');

// ── 1. Backup .env ────────────────────────────────────────────────────────────
const originalEnv = fs.readFileSync(envPath, 'utf-8');
fs.writeFileSync(backupPath, originalEnv);
console.log('📋  .env backed up to .env.seed-backup');

// ── 2. Write temp .env with production DATABASE_URL ───────────────────────────
const tempEnv = originalEnv.replace(
  /^DATABASE_URL=.*/m,
  `DATABASE_URL=${PROD_DB_URL}`,
);
fs.writeFileSync(envPath, tempEnv);
console.log('🔒  DATABASE_URL temporarily set to PROD_DATABASE_URL');
console.log(`📡  Target: ${PROD_DB_URL.replace(/:([^:@]+)@/, ':***@')}\n`);

function restore() {
  fs.writeFileSync(envPath, originalEnv);
  if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
  console.log('\n♻️   .env restored to local dev config');
}

try {
  const wipeFlag = WIPE ? 'WIPE=true ' : '';
  console.log(`▶  Running: ${wipeFlag}npx tsx scripts/seed-100k.ts\n`);
  execSync(`${wipeFlag}npx tsx scripts/seed-100k.ts`, {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: PROD_DB_URL, WIPE: String(WIPE) },
  });

  restore();
  console.log('\n✅  Production 100k seed complete.\n');
} catch (err) {
  restore();
  console.error('\n❌  Seed failed:', err.message);
  process.exit(1);
}
