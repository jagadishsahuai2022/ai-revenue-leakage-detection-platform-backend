/**
 * run-data-migrations.ts
 * ──────────────────────────────────────────────────────────────────────────────
 * Idempotent data-migration runner.
 *
 * Usage:
 *   npm run db:migrate:data
 *
 * Behaviour:
 *   1. Scans src/infrastructure/data-migrations/ for *.ts files
 *      (files starting with _ are skipped — use them for templates/examples).
 *   2. Sorts files alphabetically (run order is determined by filename prefix,
 *      e.g. 001_..., 002_...).
 *   3. For each file checks DataMigrationHistory for the version (filename stem).
 *   4. If NOT already executed: runs the migration, inserts a history record.
 *   5. If ALREADY executed: logs "skip" and moves on.
 *
 * Does NOT require Redis. All DB operations use Prisma directly.
 */

import "dotenv/config";
import path from "path";
import fs from "fs";
import { PrismaClient } from "@prisma/client";
import pino from "pino";

const logger = pino({
  name: "data-migration-runner",
  level: process.env.LOG_LEVEL ?? "info",
});

// tsx / CommonJS: __dirname is available and resolves correctly on Windows
const MIGRATIONS_DIR = path.resolve(
  __dirname,
  "../src/infrastructure/data-migrations",
);

interface DataMigration {
  run: (prisma: PrismaClient) => Promise<void>;
}

async function main(): Promise<void> {
  const db = new PrismaClient();

  try {
    logger.info(
      { migrationsDir: MIGRATIONS_DIR },
      "scanning data-migrations directory",
    );

    if (!fs.existsSync(MIGRATIONS_DIR)) {
      logger.warn("data-migrations directory not found — nothing to run");
      return;
    }

    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".ts") && !f.startsWith("_"))
      .sort(); // alphabetical = execution order

    if (files.length === 0) {
      logger.info("no data-migration files found");
      return;
    }

    logger.info({ count: files.length }, "data-migration files found");

    let executed = 0;
    let skipped = 0;

    for (const file of files) {
      const version = path.basename(file, ".ts");
      const filePath = path.join(MIGRATIONS_DIR, file);

      // Check history
      const alreadyRun = await db.dataMigrationHistory.findUnique({
        where: { version },
      });

      if (alreadyRun) {
        logger.info(
          { version, executedAt: alreadyRun.executedAt },
          "skip (already executed)",
        );
        skipped++;
        continue;
      }

      logger.info({ version }, "executing data migration");

      // Dynamically import the migration module.  Node ESM requires a file:// URL
      // when using absolute paths on Windows, otherwise it treats the drive letter
      // as a protocol (see ERR_UNSUPPORTED_ESM_URL_SCHEME).  Use the url module to
      // convert our normalized path into a proper file URL.
      const { pathToFileURL } = require("url");
      const normPath = filePath.replace(/\\/g, "/");
      const fileUrl = pathToFileURL(normPath).href;
      const mod = (await import(fileUrl)) as DataMigration;

      if (typeof mod.run !== "function") {
        logger.error(
          { version, filePath },
          "migration file must export async function run(prisma)",
        );
        process.exit(1);
      }

      try {
        await mod.run(db);

        // Record execution
        await db.dataMigrationHistory.create({ data: { version } });

        logger.info({ version }, "data migration completed ✓");
        executed++;
      } catch (err) {
        logger.error({ version, err }, "data migration FAILED");
        throw err; // abort; operator must fix and re-run
      }
    }

    logger.info({ executed, skipped }, "data-migration run complete");
  } finally {
    await db.$disconnect();
  }
}

main().catch((err: unknown) => {
  logger.error({ err }, "data-migration runner failed");
  process.exit(1);
});
