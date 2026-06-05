/**
 * LocalizationService — Enterprise Localization Engine
 *
 * Single canonical entry point for ALL backend translation logic.
 * Database-driven with $0 infrastructure cost (free translation providers).
 *
 * Translation priority:
 *   1️⃣  Admin override  (TranslationOverride — company-specific or global)
 *   2️⃣  Cached translation  (TranslationCache — persists across sessions)
 *   3️⃣  Translation provider  (MyMemory → Google Translate → fallback)
 *   4️⃣  English fallback  (source text returned as-is)
 *
 * Providers (tried in order, no API keys required):
 *   • MyMemory API         — https://mymemory.translated.net
 *   • Google Translate API — unofficial, no key, widely available
 *
 * Supports:
 *   • Any ISO 639 language code (en, fr, de, hi, ta, bn, etc.)
 *   • Locale variants (en-US, en-GB, fr-FR, hi-IN, ta-IN, bn-IN)
 *   • Batch translation with concurrency control
 *   • Rate limit handling with retry + provider fallback
 *   • Admin override CRUD (company-scoped and global)
 *   • Automatic cache warm-up (translations stored after first fetch)
 */

import { PrismaClient } from "@prisma/client";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Strip HTML tags, XLIFF inline elements (<g>, <x/>, etc.) and decode common
 * HTML entities from a translation result.
 * MyMemory sometimes returns translation memory with XLIFF markup.
 */
function stripTranslationArtifacts(text: string): string {
  return text
    .replace(/<[^>]+>/g, "") // strip all HTML / XML / XLIFF tags
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

// ── Configuration ─────────────────────────────────────────────────────────────

/** Optional self-hosted LibreTranslate URL (overrides all other providers if set). */
const CUSTOM_TRANSLATE_URL = process.env.LIBRE_TRANSLATE_URL ?? "";
const CUSTOM_TRANSLATE_API_KEY = process.env.LIBRE_TRANSLATE_API_KEY ?? "";

/** Timeout per provider request (ms). */
const PROVIDER_TIMEOUT = 8_000;

/** Max texts per batch call. */
const MAX_BATCH_SIZE = 100;

/** Max concurrent in-flight provider calls. */
const CONCURRENCY = 5;

/** Delay on 429 before trying next provider (ms). */
const RATE_LIMIT_BACKOFF = 1_000;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TranslateOptions {
  companyId?: string;
  locale: string;
}

export interface BatchTranslateOptions extends TranslateOptions {
  texts: string[];
}

export type TranslationSource = "override" | "cache" | "provider" | "fallback";

export interface TranslationResult {
  sourceText: string;
  translatedText: string;
  source: TranslationSource;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Normalise a locale to its base language code.
 * "fr-FR" → "fr", "hi-IN" → "hi", "en" → "en"
 */
function baseLocale(locale: string): string {
  return locale.split("-")[0].toLowerCase();
}

// ── Core: translate() ─────────────────────────────────────────────────────────

export async function translate(
  prisma: PrismaClient,
  text: string,
  options: TranslateOptions,
): Promise<TranslationResult> {
  const { companyId } = options;
  const locale = baseLocale(options.locale);

  // Empty / English → short-circuit
  if (!text?.trim()) {
    return { sourceText: text, translatedText: text, source: "fallback" };
  }
  if (locale === "en") {
    return { sourceText: text, translatedText: text, source: "fallback" };
  }

  // 1️⃣ Admin override — company-specific wins over global
  const override = await prisma.translationOverride.findFirst({
    where: {
      locale,
      sourceText: text,
      OR: [{ companyId: companyId ?? null }, { companyId: null }],
    },
    orderBy: { companyId: "desc" },
  });
  if (override) {
    return {
      sourceText: text,
      translatedText: override.translatedText,
      source: "override",
    };
  }

  // 2️⃣ Translation cache
  const cached = await prisma.translationCache.findUnique({
    where: { sourceText_targetLang: { sourceText: text, targetLang: locale } },
  });
  if (cached) {
    return {
      sourceText: text,
      translatedText: cached.translatedText,
      source: "cache",
    };
  }

  // 3️⃣ Call translation provider → store in cache
  const translated = await callTranslationProvider(text, locale);
  if (translated) {
    await prisma.translationCache
      .upsert({
        where: {
          sourceText_targetLang: { sourceText: text, targetLang: locale },
        },
        create: {
          sourceText: text,
          sourceLang: "en",
          targetLang: locale,
          translatedText: translated,
        },
        update: { translatedText: translated },
      })
      .catch(() => {
        /* non-fatal — cache write failure must not break the response */
      });

    return {
      sourceText: text,
      translatedText: translated,
      source: "provider",
    };
  }

  // 4️⃣ English fallback
  return { sourceText: text, translatedText: text, source: "fallback" };
}

// ── Batch translation ─────────────────────────────────────────────────────────

export async function translateBatch(
  prisma: PrismaClient,
  options: BatchTranslateOptions,
): Promise<TranslationResult[]> {
  const { texts, locale, companyId } = options;
  if (!texts.length) return [];

  if (baseLocale(locale) === "en") {
    return texts.map((t) => ({
      sourceText: t,
      translatedText: t,
      source: "fallback" as const,
    }));
  }

  // Process with concurrency cap to avoid overwhelming free endpoints
  const results: TranslationResult[] = [];
  for (let i = 0; i < texts.length; i += CONCURRENCY) {
    const chunk = texts.slice(i, i + CONCURRENCY);
    const chunkResults = await Promise.all(
      chunk.map((text) => translate(prisma, text, { locale, companyId })),
    );
    results.push(...chunkResults);
  }
  return results;
}

// ── Admin override CRUD ───────────────────────────────────────────────────────

export async function listTranslationOverrides(
  prisma: PrismaClient,
  companyId: string,
  locale?: string,
) {
  return prisma.translationOverride.findMany({
    where: {
      OR: [{ companyId }, { companyId: null }],
      ...(locale ? { locale } : {}),
    },
    orderBy: [{ locale: "asc" }, { sourceText: "asc" }],
  });
}

export async function upsertTranslationOverride(
  prisma: PrismaClient,
  payload: {
    companyId?: string;
    locale: string;
    sourceText: string;
    translatedText: string;
  },
) {
  const { companyId = null, locale, sourceText, translatedText } = payload;
  return prisma.translationOverride.upsert({
    where: {
      locale_sourceText_companyId: {
        locale: baseLocale(locale),
        sourceText,
        companyId: companyId ?? "",
      },
    },
    create: {
      companyId,
      locale: baseLocale(locale),
      sourceText,
      translatedText,
    },
    update: { translatedText },
  });
}

export async function deleteTranslationOverride(
  prisma: PrismaClient,
  id: string,
) {
  return prisma.translationOverride.delete({ where: { id } });
}

// ── Translation providers ────────────────────────────────────────────────────

/**
 * Master translation function — tries providers in sequence until one succeeds.
 * Priority: custom self-hosted → MyMemory → Google Translate (unofficial)
 */
async function callTranslationProvider(
  text: string,
  target: string,
): Promise<string | null> {
  // 0️⃣ Optional self-hosted LibreTranslate / local instance
  if (CUSTOM_TRANSLATE_URL) {
    const result = await callLibreTranslate(text, "en", target);
    if (result) return result;
  }

  // 1️⃣ Google Translate unofficial API — highly reliable, no key needed
  const google = await callGoogleTranslate(text, target);
  if (google) return google;

  // 2️⃣ MyMemory API — fallback, free, no key, 5K chars/day per IP
  const myMemory = await callMyMemory(text, target);
  if (myMemory) return myMemory;

  return null;
}

/**
 * MyMemory free translation API.
 * Docs: https://mymemory.translated.net/doc/spec.php
 */
async function callMyMemory(
  text: string,
  target: string,
): Promise<string | null> {
  try {
    const encoded = encodeURIComponent(text);
    const url = `https://api.mymemory.translated.net/get?q=${encoded}&langpair=en|${target}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT),
    });

    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, RATE_LIMIT_BACKOFF));
      return null;
    }
    if (!res.ok) return null;

    const json = (await res.json()) as {
      responseData?: { translatedText?: string };
      responseStatus?: number;
    };

    const translated = json.responseData?.translatedText;
    // MyMemory returns the original text or an error string when it fails
    if (
      translated &&
      translated !== text &&
      !translated.startsWith("PLEASE SELECT") &&
      !translated.startsWith("NO QUERY")
    ) {
      return stripTranslationArtifacts(translated);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Google Translate unofficial API — uses the same endpoint as the browser.
 * No API key required. Not officially supported but highly reliable.
 */
async function callGoogleTranslate(
  text: string,
  target: string,
): Promise<string | null> {
  try {
    const encoded = encodeURIComponent(text);
    const url =
      `https://translate.googleapis.com/translate_a/single` +
      `?client=gtx&sl=en&tl=${target}&dt=t&q=${encoded}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT),
    });

    if (!res.ok) return null;

    // Response format: [ [ [translatedChunk, sourceChunk, ...], ... ], null, "en" ]
    const json = (await res.json()) as unknown;
    if (!Array.isArray(json) || !Array.isArray(json[0])) return null;

    // Concatenate all translated chunks
    const segments = json[0] as Array<[string, ...unknown[]]>;
    const translated = segments
      .map((seg) => (typeof seg[0] === "string" ? seg[0] : ""))
      .join("");
    return translated ? stripTranslationArtifacts(translated) : null;
  } catch {
    return null;
  }
}

/**
 * Self-hosted or custom LibreTranslate instance.
 * Only called when LIBRE_TRANSLATE_URL env var is set.
 */
async function callLibreTranslate(
  text: string,
  source: string,
  target: string,
): Promise<string | null> {
  const body: Record<string, string> = { q: text, source, target };
  if (CUSTOM_TRANSLATE_API_KEY) body.api_key = CUSTOM_TRANSLATE_API_KEY;

  try {
    const res = await fetch(CUSTOM_TRANSLATE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT),
    });

    if (!res.ok) return null;
    const json = (await res.json()) as { translatedText?: string };
    return json.translatedText ?? null;
  } catch {
    return null;
  }
}
