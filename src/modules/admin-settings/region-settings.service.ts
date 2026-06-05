/**
 * region-settings.service.ts — CRUD for per-company region/formatting settings.
 *
 * Provides sensible defaults (USD / UTC / MM/DD/YYYY / en-US) when no
 * record exists.  The frontend reads these on login and caches them in the
 * Pinia regionStore.
 */

import { PrismaClient } from "@prisma/client";

// ── Defaults ──────────────────────────────────────────────────────────────────

export const REGION_DEFAULTS = {
  currency: "USD",
  timezone: "UTC",
  dateFormat: "MM/DD/YYYY",
  numberFormat: "en-US",
} as const;

/** Map language codes to their default full-locale + region. */
export const LANGUAGE_REGION_MAP: Record<
  string,
  { locale: string; currency: string; timezone: string; dateFormat: string }
> = {
  en: {
    locale: "en-US",
    currency: "USD",
    timezone: "America/New_York",
    dateFormat: "MM/DD/YYYY",
  },
  fr: {
    locale: "fr-FR",
    currency: "EUR",
    timezone: "Europe/Paris",
    dateFormat: "DD/MM/YYYY",
  },
  de: {
    locale: "de-DE",
    currency: "EUR",
    timezone: "Europe/Berlin",
    dateFormat: "DD.MM.YYYY",
  },
  es: {
    locale: "es-ES",
    currency: "EUR",
    timezone: "Europe/Madrid",
    dateFormat: "DD/MM/YYYY",
  },
  hi: {
    locale: "hi-IN",
    currency: "INR",
    timezone: "Asia/Kolkata",
    dateFormat: "DD/MM/YYYY",
  },
  ja: {
    locale: "ja-JP",
    currency: "JPY",
    timezone: "Asia/Tokyo",
    dateFormat: "YYYY/MM/DD",
  },
  zh: {
    locale: "zh-CN",
    currency: "CNY",
    timezone: "Asia/Shanghai",
    dateFormat: "YYYY-MM-DD",
  },
  ko: {
    locale: "ko-KR",
    currency: "KRW",
    timezone: "Asia/Seoul",
    dateFormat: "YYYY.MM.DD",
  },
  pt: {
    locale: "pt-BR",
    currency: "BRL",
    timezone: "America/Sao_Paulo",
    dateFormat: "DD/MM/YYYY",
  },
  ru: {
    locale: "ru-RU",
    currency: "RUB",
    timezone: "Europe/Moscow",
    dateFormat: "DD.MM.YYYY",
  },
  ar: {
    locale: "ar-SA",
    currency: "SAR",
    timezone: "Asia/Riyadh",
    dateFormat: "DD/MM/YYYY",
  },
  it: {
    locale: "it-IT",
    currency: "EUR",
    timezone: "Europe/Rome",
    dateFormat: "DD/MM/YYYY",
  },
  nl: {
    locale: "nl-NL",
    currency: "EUR",
    timezone: "Europe/Amsterdam",
    dateFormat: "DD-MM-YYYY",
  },
  tr: {
    locale: "tr-TR",
    currency: "TRY",
    timezone: "Europe/Istanbul",
    dateFormat: "DD.MM.YYYY",
  },
  ta: {
    locale: "ta-IN",
    currency: "INR",
    timezone: "Asia/Kolkata",
    dateFormat: "DD/MM/YYYY",
  },
  bn: {
    locale: "bn-IN",
    currency: "INR",
    timezone: "Asia/Kolkata",
    dateFormat: "DD/MM/YYYY",
  },
  te: {
    locale: "te-IN",
    currency: "INR",
    timezone: "Asia/Kolkata",
    dateFormat: "DD/MM/YYYY",
  },
  gu: {
    locale: "gu-IN",
    currency: "INR",
    timezone: "Asia/Kolkata",
    dateFormat: "DD/MM/YYYY",
  },
  kn: {
    locale: "kn-IN",
    currency: "INR",
    timezone: "Asia/Kolkata",
    dateFormat: "DD/MM/YYYY",
  },
  ml: {
    locale: "ml-IN",
    currency: "INR",
    timezone: "Asia/Kolkata",
    dateFormat: "DD/MM/YYYY",
  },
  mr: {
    locale: "mr-IN",
    currency: "INR",
    timezone: "Asia/Kolkata",
    dateFormat: "DD/MM/YYYY",
  },
};

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RegionSettingsData {
  currency: string;
  timezone: string;
  dateFormat: string;
  numberFormat: string;
}

// ── Service ───────────────────────────────────────────────────────────────────

export async function getRegionSettings(
  prisma: PrismaClient,
  companyId: string,
): Promise<RegionSettingsData> {
  const row = await prisma.regionSettings.findUnique({
    where: { companyId },
  });

  if (!row) {
    return { ...REGION_DEFAULTS };
  }

  return {
    currency: row.currency,
    timezone: row.timezone,
    dateFormat: row.dateFormat,
    numberFormat: row.numberFormat,
  };
}

export async function updateRegionSettings(
  prisma: PrismaClient,
  companyId: string,
  data: Partial<RegionSettingsData>,
): Promise<RegionSettingsData> {
  const row = await prisma.regionSettings.upsert({
    where: { companyId },
    create: {
      companyId,
      currency: data.currency ?? REGION_DEFAULTS.currency,
      timezone: data.timezone ?? REGION_DEFAULTS.timezone,
      dateFormat: data.dateFormat ?? REGION_DEFAULTS.dateFormat,
      numberFormat: data.numberFormat ?? REGION_DEFAULTS.numberFormat,
    },
    update: {
      ...(data.currency !== undefined ? { currency: data.currency } : {}),
      ...(data.timezone !== undefined ? { timezone: data.timezone } : {}),
      ...(data.dateFormat !== undefined ? { dateFormat: data.dateFormat } : {}),
      ...(data.numberFormat !== undefined
        ? { numberFormat: data.numberFormat }
        : {}),
    },
  });

  return {
    currency: row.currency,
    timezone: row.timezone,
    dateFormat: row.dateFormat,
    numberFormat: row.numberFormat,
  };
}
