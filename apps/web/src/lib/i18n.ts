import i18n, { type BackendModule } from 'i18next';
import { initReactI18next } from 'react-i18next';
import {
  FALLBACK_LANGUAGE,
  SUPPORTED_LANGUAGES,
  isLanguage,
  type Language,
} from '@conbert/i18n/languages';
import { SETTINGS_STORAGE_KEY } from '@/features/settings/settings-store';

type Texts = Record<string, unknown>;
type TextModule = () => Promise<{ default: Texts }>;

/** Text areas loaded with their page (split off by scripts/locale-parts.ts). */
export type TextPart = 'workshop';

/**
 * Only the texts of the language in use are loaded, and of those only the
 * start part; the workshop texts (over 40 %) come when the workshop opens.
 */
const LOCALES: Record<Language, Record<'start' | TextPart, TextModule>> = {
  de: {
    start: () => import('virtual:conbert-locale/de/start'),
    workshop: () => import('virtual:conbert-locale/de/workshop'),
  },
  en: {
    start: () => import('virtual:conbert-locale/en/start'),
    workshop: () => import('virtual:conbert-locale/en/workshop'),
  },
};

/** Parts a page has asked for: a language switch loads them right away too. */
const wanted = new Set<TextPart>();

async function loadLanguage(language: Language): Promise<Texts> {
  const parts = await Promise.all(
    (['start', ...wanted] as const).map((part) => LOCALES[language][part]()),
  );
  return Object.assign({}, ...parts.map((m) => m.default)) as Texts;
}

const lazyLocales: BackendModule = {
  type: 'backend',
  init() {},
  read(language, _namespace, callback) {
    if (!isLanguage(language)) {
      callback(null, {});
      return;
    }
    loadLanguage(language).then(
      (texts) => callback(null, texts),
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

/**
 * Makes sure a page's texts are there (for every language already loaded);
 * the page waits for this before it shows.
 */
export async function loadTextPart(part: TextPart): Promise<void> {
  wanted.add(part);
  await i18nReady;
  await Promise.all(
    SUPPORTED_LANGUAGES.filter(
      (lng) =>
        i18n.hasResourceBundle(lng, 'translation') &&
        i18n.getResource(lng, 'translation', part) === undefined,
    ).map(async (lng) => {
      const { default: texts } = await LOCALES[lng][part]();
      i18n.addResourceBundle(lng, 'translation', texts, true, true);
    }),
  );
}
