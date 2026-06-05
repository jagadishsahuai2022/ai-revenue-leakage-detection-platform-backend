/**
 * localization-extended.service.ts — Extended localization capabilities
 *
 * Provides:
 *   • Dictionary endpoint (bulk-load frequent translations per locale)
 *   • Translation warmup (preload common routes)
 *   • Translation telemetry (record usage, surface most/least used)
 *   • Localization health (translation coverage per language)
 *   • AI translation suggestions
 *   • Community translation contributions
 */

import { PrismaClient } from "@prisma/client";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DictionaryEntry {
  sourceText: string;
  translatedText: string;
}

export interface TranslationHealthEntry {
  locale: string;
  totalKeys: number;
  translatedKeys: number;
  coveragePercent: number;
}

export interface TelemetryEntry {
  sourceText: string;
  locale: string;
  hitCount: number;
  lastUsedAt: string;
}

// ── Dictionary ────────────────────────────────────────────────────────────────

/** Return all cached translations for a locale (dictionary endpoint). */
export async function getDictionary(
  prisma: PrismaClient,
  locale: string,
  limit = 500,
): Promise<DictionaryEntry[]> {
  const baseLocale = locale.split("-")[0].toLowerCase();

  const rows = await prisma.translationCache.findMany({
    where: { targetLang: baseLocale },
    select: { sourceText: true, translatedText: true },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return rows.map((r) => ({
    sourceText: r.sourceText,
    translatedText: r.translatedText,
  }));
}

// ── Warmup ────────────────────────────────────────────────────────────────────

/**
 * Warm-up: bulk-translate a list of texts and ensure they are cached.
 * Reuses translateBatch from the main localization service.
 */
export async function warmupTranslations(
  prisma: PrismaClient,
  translateBatchFn: (
    prisma: PrismaClient,
    opts: { texts: string[]; locale: string; companyId: string },
  ) => Promise<unknown[]>,
  params: { texts: string[]; locale: string; companyId: string },
): Promise<{ warmedUp: number }> {
  const results = await translateBatchFn(prisma, params);
  return { warmedUp: results.length };
}

// ── Telemetry ─────────────────────────────────────────────────────────────────

/** Record translation usage (upsert hit counter). */
export async function recordTranslationUsage(
  prisma: PrismaClient,
  locale: string,
  sourceText: string,
): Promise<void> {
  const baseLocale = locale.split("-")[0].toLowerCase();

  await prisma.translationTelemetry.upsert({
    where: {
      locale_sourceText: { locale: baseLocale, sourceText },
    },
    create: { locale: baseLocale, sourceText, hitCount: 1 },
    update: {
      hitCount: { increment: 1 },
      lastUsedAt: new Date(),
    },
  });
}

/** Batch-record translation usages. */
export async function recordBatchUsage(
  prisma: PrismaClient,
  locale: string,
  texts: string[],
): Promise<void> {
  // Run upserts concurrently in small batches to avoid connection exhaustion
  const BATCH = 10;
  for (let i = 0; i < texts.length; i += BATCH) {
    const chunk = texts.slice(i, i + BATCH);
    await Promise.all(
      chunk.map((t) => recordTranslationUsage(prisma, locale, t)),
    );
  }
}

/** Get most-used translations. */
export async function getMostUsedTranslations(
  prisma: PrismaClient,
  locale?: string,
  limit = 50,
): Promise<TelemetryEntry[]> {
  const where = locale ? { locale: locale.split("-")[0].toLowerCase() } : {};

  const rows = await prisma.translationTelemetry.findMany({
    where,
    orderBy: { hitCount: "desc" },
    take: limit,
  });

  return rows.map((r) => ({
    sourceText: r.sourceText,
    locale: r.locale,
    hitCount: r.hitCount,
    lastUsedAt: r.lastUsedAt.toISOString(),
  }));
}

/** Get least-used (potentially unused) translations. */
export async function getLeastUsedTranslations(
  prisma: PrismaClient,
  locale?: string,
  limit = 50,
): Promise<TelemetryEntry[]> {
  const where = locale ? { locale: locale.split("-")[0].toLowerCase() } : {};

  const rows = await prisma.translationTelemetry.findMany({
    where,
    orderBy: { hitCount: "asc" },
    take: limit,
  });

  return rows.map((r) => ({
    sourceText: r.sourceText,
    locale: r.locale,
    hitCount: r.hitCount,
    lastUsedAt: r.lastUsedAt.toISOString(),
  }));
}

// ── Health ────────────────────────────────────────────────────────────────────

/**
 * Calculate translation coverage per locale.
 * Coverage = (cached translations for locale) / (total unique source texts in cache).
 */
export async function getTranslationHealth(
  prisma: PrismaClient,
  totalKeyCount: number,
  locales: string[],
): Promise<TranslationHealthEntry[]> {
  const results: TranslationHealthEntry[] = [];

  for (const locale of locales) {
    const baseLocale = locale.split("-")[0].toLowerCase();
    if (baseLocale === "en") {
      results.push({
        locale: baseLocale,
        totalKeys: totalKeyCount,
        translatedKeys: totalKeyCount,
        coveragePercent: 100,
      });
      continue;
    }

    const translatedCount = await prisma.translationCache.count({
      where: { targetLang: baseLocale },
    });

    const percent =
      totalKeyCount > 0
        ? Math.round((translatedCount / totalKeyCount) * 100)
        : 0;

    results.push({
      locale: baseLocale,
      totalKeys: totalKeyCount,
      translatedKeys: translatedCount,
      coveragePercent: Math.min(percent, 100),
    });
  }

  return results;
}

// ── AI Translation Suggestions ────────────────────────────────────────────────

export interface AISuggestionInput {
  locale: string;
  sourceText: string;
  currentTranslation?: string;
}

export interface AISuggestionResult {
  id: string;
  locale: string;
  sourceText: string;
  currentTranslation: string | null;
  suggestedTranslation: string;
  confidence: number;
  status: string;
}

/** Create an AI translation suggestion record. */
export async function createAISuggestion(
  prisma: PrismaClient,
  data: AISuggestionInput & {
    suggestedTranslation: string;
    confidence: number;
  },
): Promise<AISuggestionResult> {
  const row = await prisma.translationSuggestion.create({
    data: {
      locale: data.locale,
      sourceText: data.sourceText,
      currentTranslation: data.currentTranslation,
      suggestedTranslation: data.suggestedTranslation,
      confidence: data.confidence,
      status: "pending",
    },
  });

  return {
    id: row.id,
    locale: row.locale,
    sourceText: row.sourceText,
    currentTranslation: row.currentTranslation,
    suggestedTranslation: row.suggestedTranslation,
    confidence: row.confidence,
    status: row.status,
  };
}

/** List AI suggestions (optionally filter by locale/status). */
export async function listAISuggestions(
  prisma: PrismaClient,
  opts?: { locale?: string; status?: string },
): Promise<AISuggestionResult[]> {
  const where: Record<string, unknown> = {};
  if (opts?.locale) where.locale = opts.locale;
  if (opts?.status) where.status = opts.status;

  const rows = await prisma.translationSuggestion.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return rows.map((r) => ({
    id: r.id,
    locale: r.locale,
    sourceText: r.sourceText,
    currentTranslation: r.currentTranslation,
    suggestedTranslation: r.suggestedTranslation,
    confidence: r.confidence,
    status: r.status,
  }));
}

/** Accept or reject an AI suggestion. */
export async function reviewAISuggestion(
  prisma: PrismaClient,
  id: string,
  decision: "accepted" | "rejected",
  reviewerUserId: string,
): Promise<AISuggestionResult> {
  const row = await prisma.translationSuggestion.update({
    where: { id },
    data: { status: decision, reviewedBy: reviewerUserId },
  });

  return {
    id: row.id,
    locale: row.locale,
    sourceText: row.sourceText,
    currentTranslation: row.currentTranslation,
    suggestedTranslation: row.suggestedTranslation,
    confidence: row.confidence,
    status: row.status,
  };
}

// ── Community Translation Contributions ───────────────────────────────────────

export interface ContributionInput {
  locale: string;
  sourceText: string;
  suggestedTranslation: string;
  contributorId?: string;
  contributorEmail?: string;
}

export interface ContributionResult {
  id: string;
  locale: string;
  sourceText: string;
  suggestedTranslation: string;
  status: string;
  contributorEmail: string | null;
  createdAt: string;
}

/** Submit a community translation contribution. */
export async function submitContribution(
  prisma: PrismaClient,
  data: ContributionInput,
): Promise<ContributionResult> {
  const row = await prisma.translationContribution.create({
    data: {
      locale: data.locale,
      sourceText: data.sourceText,
      suggestedTranslation: data.suggestedTranslation,
      contributorId: data.contributorId,
      contributorEmail: data.contributorEmail,
      status: "pending",
    },
  });

  return {
    id: row.id,
    locale: row.locale,
    sourceText: row.sourceText,
    suggestedTranslation: row.suggestedTranslation,
    status: row.status,
    contributorEmail: row.contributorEmail,
    createdAt: row.createdAt.toISOString(),
  };
}

/** List community contributions (optionally filter by locale/status). */
export async function listContributions(
  prisma: PrismaClient,
  opts?: { locale?: string; status?: string },
): Promise<ContributionResult[]> {
  const where: Record<string, unknown> = {};
  if (opts?.locale) where.locale = opts.locale;
  if (opts?.status) where.status = opts.status;

  const rows = await prisma.translationContribution.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return rows.map((r) => ({
    id: r.id,
    locale: r.locale,
    sourceText: r.sourceText,
    suggestedTranslation: r.suggestedTranslation,
    status: r.status,
    contributorEmail: r.contributorEmail,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** Review a community contribution. */
export async function reviewContribution(
  prisma: PrismaClient,
  id: string,
  decision: "approved" | "rejected",
  reviewerUserId: string,
): Promise<ContributionResult> {
  const row = await prisma.translationContribution.update({
    where: { id },
    data: { status: decision, reviewedBy: reviewerUserId },
  });

  return {
    id: row.id,
    locale: row.locale,
    sourceText: row.sourceText,
    suggestedTranslation: row.suggestedTranslation,
    status: row.status,
    contributorEmail: row.contributorEmail,
    createdAt: row.createdAt.toISOString(),
  };
}
