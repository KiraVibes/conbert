/**
 * The languages without their texts – for the web app, which loads only the
 * texts of the language in use (see apps/web/src/lib/i18n.ts).
 */
export const SUPPORTED_LANGUAGES = ['de', 'en'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];
/** Used when the browser language is not supported (e.g. French → English). */
export const FALLBACK_LANGUAGE: Language = 'en';

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}
