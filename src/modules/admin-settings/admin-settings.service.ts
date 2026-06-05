import { PrismaClient } from "@prisma/client";

// ── Supported Languages ──────────────────────────────────────────────────────
// supported languages mirror the frontend list – includes major global
// languages plus all 22 official Indian languages.  Keep in sync with
// front-end constants to avoid mismatch during validation.
export const SUPPORTED_LANGUAGES = [
  { code: "en", name: "English" },
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "it", name: "Italian" },
  { code: "nl", name: "Dutch" },
  { code: "pt", name: "Portuguese" },
  { code: "pl", name: "Polish" },
  { code: "sv", name: "Swedish" },
  { code: "zh", name: "中文" },
  { code: "ja", name: "日本語" },
  { code: "ko", name: "한국어" },
  { code: "ru", name: "Русский" },
  { code: "ar", name: "العربية" },
  { code: "hi", name: "हिन्दी" },
  { code: "bn", name: "বাংলা" },
  { code: "ta", name: "தமிழ்" },
  { code: "te", name: "తెలుగు" },
  { code: "gu", name: "ગુજરાતી" },
  { code: "kn", name: "ಕನ್ನಡ" },
  { code: "ml", name: "മലയാളം" },
  { code: "mr", name: "मराठी" },
  { code: "ur", name: "اردو" },
  { code: "pa", name: "ਪੰਜਾਬੀ" },
  { code: "or", name: "ଓଡ଼ିଆ" },
  { code: "as", name: "অসমীয়া" },
  { code: "sd", name: "سنڌي" },
  { code: "kok", name: "कोंकणी" },
  { code: "mni", name: "মণিপুরী" },
  { code: "sa", name: "संस्कृतम्" },
  { code: "ne", name: "नेपाली" },
  { code: "brx", name: "बड़ो" },
  { code: "sat", name: "संताली" },
  { code: "doi", name: "डोगरी" },
  { code: "mai", name: "मैथिली" },
] as const;

export const LANGUAGE_CODES = SUPPORTED_LANGUAGES.map((l) => l.code);

// ── Typography defaults ──────────────────────────────────────────────────────
export const TYPOGRAPHY_DEFAULTS = {
  headingFont: "Inter",
  headingFontSize: "24px",
  gridHeaderFont: "Inter",
  gridHeaderFontSize: "14px",
  gridRowFont: "Inter",
  gridRowFontSize: "13px",
  menuFont: "Inter",
  menuFontSize: "14px",
  navigationFont: "Inter",
  navigationFontSize: "15px",
  labelFont: "Inter",
  labelFontSize: "13px",
};

// ── Localization Settings ─────────────────────────────────────────────────────

export interface LocalizationSettings {
  defaultLanguage: string;
  availableLanguages: string[];
}

export async function getLocalizationSettings(
  prisma: PrismaClient,
  companyId: string,
): Promise<LocalizationSettings> {
  const company = await prisma.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { defaultLanguage: true, settings: true } as any,
  });

  const settings = (company.settings ?? {}) as unknown as Record<
    string,
    unknown
  >;
  const availableLanguages = Array.isArray(settings.availableLanguages)
    ? (settings.availableLanguages as string[]).filter((l) =>
        (LANGUAGE_CODES as readonly string[]).includes(l),
      )
    : LANGUAGE_CODES.slice(); // default: all

  return {
    defaultLanguage: (company as any).defaultLanguage ?? "en",
    availableLanguages,
  };
}

export async function updateLocalizationSettings(
  prisma: PrismaClient,
  companyId: string,
  data: Partial<LocalizationSettings>,
): Promise<LocalizationSettings> {
  const company = await prisma.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { settings: true },
  });

  const currentSettings = (company.settings ?? {}) as unknown as Record<
    string,
    unknown
  >;

  // Build the payload for the update.  We consult the Prisma DMMF
  // at runtime to avoid sending fields that the generated client doesn't
  // actually know about.  This handles cases where the database was
  // migrated but the client wasn't regenerated yet.
  // guard in case the generated client lacks _dmmf (e.g. running in
  // certain test setups); just skip the filtering when unavailable
  const companyFields =
    prisma &&
    (prisma as any)._dmmf &&
    (prisma as any)._dmmf.modelMap?.Company?.fields
      ? (prisma as any)._dmmf.modelMap.Company.fields.map((f: any) => f.name)
      : [];
  const updatePayload: Record<string, unknown> = {};

  if (data.defaultLanguage !== undefined) {
    if (!(LANGUAGE_CODES as readonly string[]).includes(data.defaultLanguage)) {
      throw new Error(`Unsupported language: ${data.defaultLanguage}`);
    }
    if (companyFields.includes("defaultLanguage")) {
      updatePayload.defaultLanguage = data.defaultLanguage;
    }
  }

  if (data.availableLanguages !== undefined) {
    const valid = data.availableLanguages.filter((l) =>
      (LANGUAGE_CODES as readonly string[]).includes(l),
    );
    currentSettings.availableLanguages = valid;
    updatePayload.settings = currentSettings;
  }

  // perform update with whatever fields are permitted
  await prisma.company.update({
    where: { id: companyId },
    data: updatePayload as any,
  });

  return getLocalizationSettings(prisma, companyId);
}

// ── User Language Preference ──────────────────────────────────────────────────

export interface UserLanguagePayload {
  preferredLanguage: string | null;
  companyDefault: string | null;
}

export async function getUserLanguage(
  prisma: PrismaClient,
  userId: string,
): Promise<UserLanguagePayload> {
  // fetch the user and their company id so we can pull the company default
  const user = (await prisma.user.findUnique({
    where: { id: userId },
    select: { preferredLanguage: true, companyId: true } as any,
  })) as any;
  let companyDefault: string | null = null;
  if (user?.companyId) {
    const company = await prisma.company.findUnique({
      where: { id: user.companyId },
      select: { defaultLanguage: true } as any,
    });
    if (company) {
      companyDefault = (company as any).defaultLanguage ?? null;
    }
  }

  return {
    preferredLanguage: user?.preferredLanguage ?? null,
    companyDefault,
  };
}

export async function updateUserLanguage(
  prisma: PrismaClient,
  userId: string,
  language: string,
): Promise<string> {
  if (!(LANGUAGE_CODES as readonly string[]).includes(language)) {
    throw new Error(`Unsupported language: ${language}`);
  }
  const user = (await prisma.user.update({
    where: { id: userId },
    data: { preferredLanguage: language } as any,
  })) as any;
  return (user.preferredLanguage ?? "en") as string;
}

// ── Typography Settings ─────────────────────────────────────────────────────

export interface TypographyConfig {
  headingFont: string | null;
  headingFontSize: string | null;
  gridHeaderFont: string | null;
  gridHeaderFontSize: string | null;
  gridRowFont: string | null;
  gridRowFontSize: string | null;
  menuFont: string | null;
  menuFontSize: string | null;
  navigationFont: string | null;
  navigationFontSize: string | null;
  labelFont: string | null;
  labelFontSize: string | null;
}

export async function getTypographyConfig(
  prisma: PrismaClient,
  companyId: string,
): Promise<TypographyConfig> {
  const config = await prisma.uiTypographyConfig.findUnique({
    where: { companyId },
  });

  if (!config) {
    return {
      headingFont: null,
      headingFontSize: null,
      gridHeaderFont: null,
      gridHeaderFontSize: null,
      gridRowFont: null,
      gridRowFontSize: null,
      menuFont: null,
      menuFontSize: null,
      navigationFont: null,
      navigationFontSize: null,
      labelFont: null,
      labelFontSize: null,
    };
  }

  return {
    headingFont: config.headingFont,
    headingFontSize: config.headingFontSize,
    gridHeaderFont: config.gridHeaderFont,
    gridHeaderFontSize: config.gridHeaderFontSize,
    gridRowFont: config.gridRowFont,
    gridRowFontSize: config.gridRowFontSize,
    menuFont: config.menuFont,
    menuFontSize: config.menuFontSize,
    navigationFont: config.navigationFont,
    navigationFontSize: config.navigationFontSize,
    labelFont: config.labelFont,
    labelFontSize: config.labelFontSize,
  };
}

export async function updateTypographyConfig(
  prisma: PrismaClient,
  companyId: string,
  data: Partial<TypographyConfig>,
): Promise<TypographyConfig> {
  await prisma.uiTypographyConfig.upsert({
    where: { companyId },
    create: { companyId, ...data },
    update: data,
  });

  return getTypographyConfig(prisma, companyId);
}
