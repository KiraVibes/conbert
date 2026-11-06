import i18n, { type BackendModule } from 'i18next';
import { initReactI18next } from 'react-i18next';
import {
  FALLBACK_LANGUAGE,
  SUPPORTED_LANGUAGES,
  isLanguage,
  type Language,
} from '@conbert/i18n/languages';
import { SETTINGS_STORAGE_KEY } from '@/features/settings/settings-store';

/**
 * Only the texts of the language in use are loaded (each language is a few
 * hundred KB); the other one comes when someone switches.
 */
const LOCALES: Record<Language, () => Promise<{ default: object }>> = {
  de: () => import('@conbert/i18n/locales/de.json'),
  en: () => import('@conbert/i18n/locales/en.json'),
};

const lazyLocales: BackendModule = {
  type: 'backend',
  init() {},
  read(language, _namespace, callback) {
    if (!isLanguage(language)) {
      callback(null, {});
      return;
    }
    LOCALES[language]().then(
      (module) => callback(null, module.default as Record<string, unknown>),
      (error: unknown) => callback(error instanceof Error ? error : new Error(String(error)), null),
    );
  },
};

/**
 * The language to start with – the same choice useApplySettings makes, so the
 * page doesn't switch (and load the other texts) right after starting.
 */
export function initialLanguage(): Language {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? 'null') as {
      state?: { language?: unknown };
    } | null;
    if (isLanguage(saved?.state?.language)) return saved.state.language;
  } catch {
    // No (readable) settings in this browser.
  }
  const browser = navigator.language.slice(0, 2);
  return isLanguage(browser) ? browser : FALLBACK_LANGUAGE;
}

i18n.on('languageChanged', (lng) => {
  document.documentElement.lang = lng;
});

/** Resolves once the texts of the start language are there. */
export const i18nReady = i18n
  .use(lazyLocales)
  .use(initReactI18next)
  .init({
    lng: initialLanguage(),
    // Every text exists in both languages (checked by tests): no fallback
    // needed, which also keeps the second language from being loaded.
    fallbackLng: false,
    supportedLngs: [...SUPPORTED_LANGUAGES],
    load: 'languageOnly',
    interpolation: { escapeValue: false },
    returnNull: false,
  });

export { i18n };
