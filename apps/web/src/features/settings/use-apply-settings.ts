import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FALLBACK_LANGUAGE, isLanguage } from '@conbert/i18n/languages';
import { useSettings, type Theme } from './settings-store';

function prefersDark(): boolean {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

export function resolveTheme(theme: Theme): 'light' | 'dark' {
  if (theme === 'system') return prefersDark() ? 'dark' : 'light';
  return theme;
}

/** Keeps the <html> class and the i18n language in sync with the settings. */
export function useApplySettings(): void {
  const theme = useSettings((s) => s.theme);
  const language = useSettings((s) => s.language);
  const { i18n } = useTranslation();

  useEffect(() => {
    const apply = () => {
      document.documentElement.classList.toggle('dark', resolveTheme(theme) === 'dark');
    };
    apply();
    if (theme !== 'system' || !window.matchMedia) return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);

  useEffect(() => {
    if (language) {
      void i18n.changeLanguage(language);
      return;
    }
    const browser = navigator.language.slice(0, 2);
    void i18n.changeLanguage(isLanguage(browser) ? browser : FALLBACK_LANGUAGE);
  }, [language, i18n]);
}

/** true if the user asked the OS for less motion. */
export function usePrefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}
