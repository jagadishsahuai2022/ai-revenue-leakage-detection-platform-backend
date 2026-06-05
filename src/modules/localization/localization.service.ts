/**
 * Module-level re-export of the canonical LocalizationService.
 *
 * All translation logic lives in src/services/LocalizationService.ts.
 * This file exists only so the route imports remain clean:
 *   import { translate, ... } from "./localization.service";
 */

export {
  translate,
  translateBatch,
  listTranslationOverrides,
  upsertTranslationOverride,
  deleteTranslationOverride,
} from "../../services/LocalizationService";

export type {
  TranslateOptions,
  BatchTranslateOptions,
  TranslationResult,
  TranslationSource,
} from "../../services/LocalizationService";
