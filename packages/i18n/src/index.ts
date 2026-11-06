import de from './locales/de.json';
import en from './locales/en.json';
import { SUPPORTED_LANGUAGES, type Language } from './languages';

export * from './languages';

/** A nested message tree as stored in the locale JSON files. */
export interface Messages {
  [key: string]: string | Messages;
}

export const resources: Record<Language, { translation: Messages }> = {
  de: { translation: de },
  en: { translation: en },
};

/** Flattens a message tree into dot-separated keys: { a: { b: 'x' } } → { 'a.b': 'x' }. */
export function flattenMessages(messages: Messages, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(messages)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out[path] = value;
    else Object.assign(out, flattenMessages(value, path));
  }
  return out;
}

/** Looks up a dot-separated key. Returns undefined if missing or not a string. */
export function getMessage(language: Language, key: string): string | undefined {
  let node: string | Messages | undefined = resources[language].translation;
  for (const part of key.split('.')) {
    if (node === undefined || typeof node === 'string') return undefined;
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
}

export interface MissingKey {
  language: Language;
  key: string;
}

/**
 * Returns every key that is missing or empty in any supported language.
 * This is the help-text guard: every option, format and error must have a
 * German and an English text.
 */
export function findMissingKeys(keys: Iterable<string>): MissingKey[] {
  const missing: MissingKey[] = [];
  const present = (language: Language, key: string) => {
    const text = getMessage(language, key);
    return text !== undefined && text.trim() !== '';
  };
  for (const key of new Set(keys)) {
    for (const language of SUPPORTED_LANGUAGES) {
      // Plural keys (t('x', { count })) live as x_one / x_other.
      const ok =
        present(language, key) ||
        (present(language, `${key}_one`) && present(language, `${key}_other`));
      if (!ok) missing.push({ language, key });
    }
  }
  return missing;
}
