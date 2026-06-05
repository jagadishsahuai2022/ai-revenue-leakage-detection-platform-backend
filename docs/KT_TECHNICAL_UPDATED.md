# KT_TECHNICAL_UPDATED — RevSecureCloud Enterprise Localization System

> Last updated: March 2026 | Stack: Vue 3 · Fastify · PostgreSQL · Prisma · LibreTranslate
> **Infrastructure cost: $0** (LibreTranslate free endpoints + Neon free PostgreSQL)

---

## Overview

RevSecureCloud implements an **enterprise localization system** supporting 49 languages
(27 global + 22 Indian languages) with **only `en.json` as the single static source of truth**.
All other languages are translated on demand via a backend translation chain,
cached in PostgreSQL, and served to the frontend where an in-memory Map provides
zero-latency repeat lookups.

**No static locale JSON files exist for non-English languages.** All translations
are dynamic, database-driven, and generated on demand via LibreTranslate.

### Supported Languages

| Category   | Languages                                                                                                                                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Global** | English, Spanish, French, German, Italian, Dutch, Portuguese, Polish, Swedish, Finnish, Danish, Czech, Slovak, Hungarian, Romanian, Greek, Turkish, Chinese, Japanese, Korean, Russian, Arabic, Hebrew, Thai, Vietnamese, Indonesian, Malay |
| **Indian** | Hindi, Bengali, Tamil, Telugu, Gujarati, Kannada, Malayalam, Marathi, Urdu, Punjabi, Odia, Assamese, Sindhi, Konkani, Manipuri, Sanskrit, Nepali, Bodo, Santali, Dogri, Maithili, Kashmiri                                                  |

### Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  Frontend (Vue 3 + Vue I18n)                                        │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │  useLocalization()  — src/composables/useLocalization.ts        ││
│  │  ├─ t(key)           Static i18n key → Vue I18n (sync)         ││
│  │  ├─ translate(text)  Dynamic string → backend chain (async)    ││
│  │  ├─ translateBatch() Batch dynamic strings (async)             ││
│  │  ├─ setLocale()      Switch lang + pre-translate all keys      ││
│  │  ├─ detectLocale()   User → Company → Browser → 'en'          ││
│  │  └─ clearCache()     Wipe in-memory Map                        ││
│  └─────────────────────────────────────────────────────────────────┘│
│              │ POST /api/v1/localization/translate-batch            │
│              ▼                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │  Backend (Fastify + Prisma)                                     ││
│  │  LocalizationService.ts — translation priority:                 ││
│  │  1. Admin Override (TranslationOverride table)                  ││
│  │  2. DB Cache (TranslationCache table)                           ││
│  │  3. LibreTranslate API (2 fallback endpoints)                   ││
│  │  4. English Fallback (return source text)                       ││
│  └─────────────────────────────────────────────────────────────────┘│
│              │                                                      │
│              ▼                                                      │
│  ┌────────────────┐  ┌────────────────────────────────────────────┐│
│  │ PostgreSQL      │  │ LibreTranslate (Free)                     ││
│  │ (Neon – free)   │  │ 1. translate.argosopentech.com            ││
│  │                 │  │ 2. libretranslate.de                      ││
│  │ translation_    │  └────────────────────────────────────────────┘│
│  │   overrides     │                                                │
│  │ translation_    │                                                │
│  │   cache         │                                                │
│  └────────────────┘                                                 │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Database Models

### `TranslationOverride`

```prisma
model TranslationOverride {
  id             String   @id @default(cuid())
  companyId      String?                        // null = global (SUPER_ADMIN)
  locale         String   @db.VarChar(10)
  sourceText     String
  translatedText String
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@unique([locale, sourceText, companyId])
  @@index([companyId])
  @@index([locale])
  @@map("translation_overrides")
}
```

- `companyId = null` means a global override (SUPER_ADMIN only)
- Company-specific overrides take precedence over global ones
- `@@unique` ensures one override per (locale, sourceText, companyId) triple

### `TranslationCache`

```prisma
model TranslationCache {
  id             String   @id @default(cuid())
  sourceText     String
  sourceLang     String   @db.VarChar(10)      // always "en"
  targetLang     String   @db.VarChar(10)
  translatedText String
  createdAt      DateTime @default(now())

  @@unique([sourceText, targetLang])
  @@index([targetLang])
  @@map("translation_cache")
}
```

---

## Backend Service

### Canonical: `src/services/LocalizationService.ts`

The single source of truth for all backend translation logic. The module at
`src/modules/localization/localization.service.ts` is a thin re-export.

**`translate(prisma, text, { locale, companyId })`**

The core single-string translation function. Implements the priority chain:

```typescript
// Empty / English → short-circuit with source: "fallback"
if (locale === "en") return { sourceText: text, translatedText: text, source: "fallback" };

// 1. Admin override (company-specific wins over global)
const override = await prisma.translationOverride.findFirst({
  where: { locale, sourceText: text, OR: [{ companyId }, { companyId: null }] },
  orderBy: { companyId: "desc" },
});
// → source: "override"

// 2. DB cache (persists across sessions, $0 cost)
const cached = await prisma.translationCache.findUnique({ ... });
// → source: "cache"

// 3. LibreTranslate (2 fallback endpoints, rate-limit handling)
const translated = await callLibreTranslate(text, "en", locale);
// → store in TranslationCache on success, source: "provider"

// 4. English fallback (return source text as-is)
// → source: "fallback"
```

**Locale variant support:** `baseLocale()` normalizes "fr-FR" → "fr", "hi-IN" → "hi" so translations are shared across variants.

**LibreTranslate fallback chain:**

1. `translate.argosopentech.com` (primary, configurable via `LIBRE_TRANSLATE_URL`)
2. `libretranslate.de` (fallback)

On HTTP 429 (rate limit), waits 2 seconds before trying the next endpoint.
Provider timeout: 8 seconds per request.

**`translateBatch(prisma, { texts, locale, companyId })`**

Processes arrays of up to 100 strings with concurrency capped at 10 parallel calls to avoid overloading the free LibreTranslate instance.

**Admin Override CRUD**

| Function                                               | Description                            |
| ------------------------------------------------------ | -------------------------------------- |
| `listTranslationOverrides(prisma, companyId, locale?)` | Fetch all overrides visible to company |
| `upsertTranslationOverride(prisma, payload)`           | Create or update a single override     |
| `deleteTranslationOverride(prisma, id)`                | Delete override by id                  |

**Translation source types:**

| Source       | Meaning                                              |
| ------------ | ---------------------------------------------------- |
| `"override"` | Admin translation override (company-specific/global) |
| `"cache"`    | Hit from TranslationCache table                      |
| `"provider"` | Fresh translation from LibreTranslate                |
| `"fallback"` | English source text returned as-is                   |

---

## Backend API Endpoints

All routes are prefixed with `/api/v1`.

| Method | Path                            | Auth          | Description                    |
| ------ | ------------------------------- | ------------- | ------------------------------ |
| POST   | `/localization/translate`       | authenticated | Translate a single string      |
| POST   | `/localization/translate-batch` | authenticated | Translate up to 100 strings    |
| GET    | `/localization/overrides`       | COMPANY_ADMIN | List all overrides for company |
| POST   | `/localization/overrides`       | COMPANY_ADMIN | Create / update override       |
| DELETE | `/localization/overrides/:id`   | COMPANY_ADMIN | Delete override                |

### POST `/localization/translate`

```json
// Request
{ "text": "Revenue dropped 12% in Q3", "locale": "de" }

// Response
{
  "sourceText": "Revenue dropped 12% in Q3",
  "translatedText": "Einnahmen sanken in Q3 um 12 %",
  "source": "provider"   // "override" | "cache" | "provider" | "fallback"
}
```

### POST `/localization/translate-batch`

```json
// Request
{ "texts": ["Insight 1", "Insight 2"], "locale": "fr" }

// Response — array of TranslationResult
[
  { "sourceText": "Insight 1", "translatedText": "Analyse 1", "source": "cache" },
  { "sourceText": "Insight 2", "translatedText": "Analyse 2", "source": "provider" }
]
```

---

## Frontend Architecture

### Static Master File

Only `en.json` exists. Located at `src/i18n/en.json` (232 lines).
**No other locale JSON files exist.** All translations are generated dynamically
via the backend and cached in PostgreSQL + frontend memory cache.

### i18n Setup (`src/i18n/index.ts`)

- **`createI18n({ legacy: false })`** — composition API mode
- English messages eagerly bundled as the single static source
- **`SUPPORTED_LOCALES`** — 49 languages (27 global + 22 Indian) with display names
- **`enMessages`** — export of raw en.json for the composable's batch pre-translation
- **`setLocaleMessages(locale, messages)`** — registers translated messages for a locale
- **`initLocaleWithEnglishBase(locale)`** — sets English text as base so `t()` never returns raw keys while translations load
- **`resolveBestLocale(userPref, companyDefault)`** — locale priority chain: user → company → browser → 'en'

### Universal Composable (`src/composables/useLocalization.ts`)

The **single entry point** for all localization. All 16 Vue components use this composable.

```typescript
const {
  t, // Static i18n key → Vue I18n (sync)
  translate, // Dynamic string → backend chain (async)
  translateBatch, // Batch translation (async)
  setLocale, // Switch language + pre-translate all keys
  detectLocale, // Auto-detect: User → Company → Browser → 'en'
  currentLocale, // Reactive locale ref
  isLoading, // Loading state during locale switch
  isRTL, // Computed: true for ar/ur/sd/he
  supportedLocales, // Full list of 49 languages
  clearCache, // Wipe in-memory translation cache
} = useLocalization();
```

**Key mechanisms:**

| Feature               | Implementation                                                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Memory cache**      | Module-level `Map<string, string>`, key: `${locale}::${text}`                                                                                                 |
| **Auto-batching**     | Microtask queue coalesces multiple `translate()` calls in the same tick into one `translate-batch` request                                                    |
| **Pre-translation**   | `setLocale()` calls `preTranslateStaticKeys()` which batch-translates all `en.json` values via backend (chunks of 50) and registers them as Vue I18n messages |
| **RTL support**       | `setLocale()` sets `document.documentElement.dir = 'rtl'` for Arabic, Urdu, Sindhi, Hebrew                                                                    |
| **Flatten/unflatten** | `flattenJSON()` / `unflattenJSON()` to convert nested i18n keys for batch API calls                                                                           |
| **Locale variants**   | `setLocale('fr-FR')` normalizes to base `'fr'` for translation lookup                                                                                         |

### Admin Views

| Component                       | Route                          | Description                                         |
| ------------------------------- | ------------------------------ | --------------------------------------------------- |
| `AdminLocalizationSettings.vue` | `/admin/localization`          | Language toggle, company default, link to overrides |
| `AdminTranslationOverrides.vue` | `/admin/translation-overrides` | Full CRUD for translation overrides                 |

### Router Guard

Both admin routes require `SUPER_ADMIN` or `COMPANY_ADMIN` role:

```typescript
meta: { requiresAuth: true, requiresRole: ["SUPER_ADMIN", "COMPANY_ADMIN"] }
```

---

## Translation Provider — LibreTranslate

- Primary endpoint: `https://translate.argosopentech.com/translate`
- Fallback endpoint: `https://libretranslate.de/translate`
- Free tier: no API key required (rate-limited)
- Timeout: 8 seconds per request
- Rate limit handling: 2s backoff on HTTP 429, then tries next endpoint
- Failure behaviour: silently falls back to English source text; no error surfaced to user
- Environment variables:
  - `LIBRE_TRANSLATE_URL` — override primary endpoint
  - `LIBRE_TRANSLATE_API_KEY` — optional API key for paid/self-hosted instances

---

## Performance Optimizations

| Optimization               | Where                      | Effect                                                    |
| -------------------------- | -------------------------- | --------------------------------------------------------- |
| English base fallback      | `i18n/index.ts`            | New locales get English text immediately (never raw keys) |
| Pre-translate static keys  | `useLocalization.ts`       | All en.json keys batch-translated on locale switch        |
| In-memory cache Map        | `useLocalization.ts`       | Zero-latency cache hits within session                    |
| Microtask auto-batching    | `useLocalization.ts`       | Multiple `translate()` calls → one HTTP request           |
| DB TranslationCache        | `LocalizationService.ts`   | LibreTranslate called once per unique text per locale     |
| 2 fallback endpoints       | `LocalizationService.ts`   | Automatic failover if primary endpoint is down            |
| Rate limit handling        | `LocalizationService.ts`   | 2s backoff on HTTP 429, then tries next endpoint          |
| Concurrency cap (10)       | `translateBatch()`         | Prevents thundering herd on free LibreTranslate           |
| Chunk size 50              | `preTranslateStaticKeys()` | Manageable batch sizes for the free endpoint              |
| `v-locale` directive guard | `main.ts`                  | Skips non-letter text nodes (punctuation, numbers)        |
| RTL auto-detection         | `useLocalization.ts`       | `dir="rtl"` set on `<html>` for ar/ur/sd/he locales       |

---

## Environment Variables

```env
# Translation provider (optional — defaults to free argosopentech endpoint)
# Two fallback endpoints are tried in order if primary fails:
#   1. translate.argosopentech.com (default)
#   2. libretranslate.de
LIBRE_TRANSLATE_URL=https://translate.argosopentech.com/translate
LIBRE_TRANSLATE_API_KEY=

# Infrastructure cost: $0 (all services are free tier)
#   - Translation: LibreTranslate free endpoints
#   - Database: Neon free tier (PostgreSQL)
#   - Frontend: Vercel free tier
#   - Backend: Render free tier
```

---

## Language Detection Priority

When a user accesses the application, the locale is determined by:

```
1. User preference  → stored in user profile (API)
2. Company default  → Company.defaultLanguage field
3. Browser locale   → navigator.language (exact match, then language-only)
4. 'en' fallback    → English is always available
```

This is implemented in both:

- **Frontend:** `useLocalization.detectLocale()` / `resolveBestLocale()`
- **Backend:** Can be queried via user/company API endpoints

---

## E2E Test Coverage

| Test File                            | Coverage                                                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `e2e/localization-universal.spec.ts` | Universal system: 49 languages, Indian languages, RTL, fallback chain, batch API, cache perf, admin overrides |

---

## File Inventory

### Backend

| File                                               | Purpose                                                                        |
| -------------------------------------------------- | ------------------------------------------------------------------------------ |
| `src/services/LocalizationService.ts`              | Canonical translation engine (translate, translateBatch, CRUD, LibreTranslate) |
| `src/modules/localization/localization.service.ts` | Thin re-export from canonical service                                          |
| `src/modules/localization/localization.routes.ts`  | Fastify API routes (prefix: `/localization`)                                   |
| `prisma/schema.prisma`                             | TranslationOverride + TranslationCache models                                  |

### Frontend

| File                                      | Purpose                                              |
| ----------------------------------------- | ---------------------------------------------------- |
| `src/i18n/en.json`                        | Single English master source (232 lines)             |
| `src/i18n/index.ts`                       | Vue I18n setup, SUPPORTED_LOCALES, helpers           |
| `src/composables/useLocalization.ts`      | Universal composable (t, translate, setLocale, etc.) |
| `src/views/AdminLocalizationSettings.vue` | Admin language settings page                         |
| `src/views/AdminTranslationOverrides.vue` | Admin override CRUD page                             |
| `e2e/localization-universal.spec.ts`      | Playwright E2E tests                                 |

---

## Database Migration

```bash
# Applied: 20260308124207_add_translation_override_cache
# Creates: translation_overrides, translation_cache tables
npx prisma migrate dev --name add_translation_override_cache
```
