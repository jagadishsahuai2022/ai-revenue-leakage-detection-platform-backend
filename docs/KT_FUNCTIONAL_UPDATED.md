# KT_FUNCTIONAL_UPDATED — RevSecureCloud Enterprise Localization

> Last updated: March 2026

---

## Overview

RevSecureCloud supports **enterprise-grade database-driven localization** across all application surfaces — from static UI labels to AI-generated insights and dynamic agent recommendations.

The system serves **49 languages** including 27 global languages and all 22 official Indian languages, with a **$0 infrastructure cost** translation pipeline. Only English (`en.json`) exists as a static file — all other translations are generated on demand and cached in PostgreSQL.

---

## Supported Languages

| Category   | Languages (49 total)                                                                                                                                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Global** | English, Spanish, French, German, Italian, Dutch, Portuguese, Polish, Swedish, Finnish, Danish, Czech, Slovak, Hungarian, Romanian, Greek, Turkish, Chinese, Japanese, Korean, Russian, Arabic, Hebrew, Thai, Vietnamese, Indonesian, Malay |
| **Indian** | Hindi, Bengali, Tamil, Telugu, Gujarati, Kannada, Malayalam, Marathi, Urdu, Punjabi, Odia, Assamese, Sindhi, Konkani, Manipuri, Sanskrit, Nepali, Bodo, Santali, Dogri, Maithili, Kashmiri                                                  |

All languages are translated on demand via LibreTranslate and cached in the database. No static translation files are maintained for non-English languages.

---

## Translation Priority Chain

Every string resolved by the system follows this chain — the **first match wins**:

```
1️⃣  Admin Translation Override  (database, per-tenant or global)
           ↓ if not found
2️⃣  Database Translation Cache  (persisted across sessions)
           ↓ if not found
3️⃣  LibreTranslate Provider     (free API, result stored in cache)
           ↓ if API fails
4️⃣  English Fallback            (source text returned as-is)
```

> **Why this order?** Admin overrides allow companies to rebrand or rephrase any string (e.g. "AI Insights" → "Revenue Intelligence") without code changes. The database cache delivers instant repeat lookups ($0 cost). The provider handles first-time translations. English fallback ensures the UI is never broken.

---

## User-Facing Features

### 1. Personal Language Preference

Every user can select their preferred language in **Settings → Language & Localization**. This is stored server-side and applied on every session — device-independent.

### 2. Company Default Language

COMPANY_ADMIN and SUPER_ADMIN users can set the **default language** for the entire organization. New users who have not set a personal preference will see this language.

### 3. Available Languages

Admins can restrict which languages are available to their users by enabling/disabling from the full list of 49 supported languages.

### 4. Translation Overrides Panel

`Settings → Language & Localization → Manage Translation Overrides`

Admins can:

- **Search** overrides by source text or translated text
- **Filter** by locale
- **Add** new overrides (company-scoped or global for SUPER_ADMIN)
- **Edit** existing overrides
- **Delete** overrides

**Example use case:**

| English Source | Override (French)    | Effect                                |
| -------------- | -------------------- | ------------------------------------- |
| `AI Insights`  | `Analyse de CA`      | Displayed everywhere in French locale |
| `Revenue`      | `Chiffre d'affaires` | Branding-specific terminology         |

Overrides apply to **all content types**:

- Static UI labels
- Dynamic AI insight summaries
- Agent proposal descriptions
- User-generated text passed through `translate()`

### 5. RTL Language Support

Arabic, Urdu, Sindhi, and Hebrew automatically set the document direction to right-to-left (`dir="rtl"`) when selected as the active language.

---

## Locale Resolution Priority

When the application boots, the effective locale is resolved in this order:

1. User's saved `preferredLanguage` (from the API)
2. Company's `defaultLanguage` (from the API)
3. Browser locale (`navigator.language`)
4. `en` (English fallback)

Locale variants (e.g. `fr-FR`, `hi-IN`, `en-US`) are normalized to their base language code for translation purposes.

---

## Dynamic Content Translation

AI-generated content (insight summaries, agent proposals, leakage descriptions) is translated **on demand** using the `translate()` function from `useLocalization`. This:

1. Checks memory cache — zero latency if already seen this session
2. Batches pending translations — auto-coalesces calls in the same tick
3. Calls `/api/v1/localization/translate-batch` in one network round-trip
4. Server applies the full priority chain and caches results in DB

---

## Localization Architecture Diagram

```
┌──────────────────────────────────────────────────┐
│                   Frontend (Vue 3)                │
│                                                  │
│  useLocalization()                               │
│  ┌──────────────┐   ┌───────────────────────┐   │
│  │  t(key)      │   │  translate(text)       │   │
│  │  Vue I18n    │   │  Memory Cache + Batch  │   │
│  └──────┬───────┘   └──────────┬────────────┘   │
│         │                      │                  │
│         │  en.json (only)      │ POST /translate  │
└─────────┼──────────────────────┼─────────────────┘
          │                      │
          ▼                      ▼
┌──────────────────────────────────────────────────┐
│                    Backend API                    │
│                                                  │
│  LocalizationService.translate()                 │
│  1. TranslationOverride table                    │
│  2. TranslationCache table                       │
│  3. LibreTranslate API (2 endpoints)             │
│  4. English fallback                             │
└──────────────────────────────────────────────────┘
```
