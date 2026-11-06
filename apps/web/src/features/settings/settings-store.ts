import { z } from 'zod';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  DEFAULT_SLEEP_SECONDS,
  MAX_SLEEP_SECONDS,
  MIN_SLEEP_SECONDS,
  type ExecutionMode,
} from '@conbert/core';
import type { Language } from '@conbert/i18n/languages';

export type Theme = 'system' | 'light' | 'dark';

export interface SettingsState {
  theme: Theme;
  /** null = follow the browser language. */
  language: Language | null;
  /** Shows advanced options everywhere. */
  expertMode: boolean;
  /** Default for new files: on this device, on the server, or automatic. */
  defaultMode: ExecutionMode;
  /** Above this size (MB), "automatic" prefers the server. */
  autoServerThresholdMb: number;
  /** Sparkles and playful loading texts. Always off with prefers-reduced-motion. */
  magicEffects: boolean;
  /** Every finished result is also saved to this storage location (null = off). */
  autoSaveTargetId: string | null;
  /** Seconds between two requests to a site when downloading (protects accounts). */
  downloaderSleepSeconds: number;
  /** The onboarding tour was finished or skipped (shown once per account). */
  tourSeen: boolean;
  /** Shows the booru area (off by default – not everyone wants anime image boards). */
  booruEnabled: boolean;
}

export interface SettingsActions {
  setTheme: (theme: Theme) => void;
  setLanguage: (language: Language | null) => void;
  setExpertMode: (expertMode: boolean) => void;
  setDefaultMode: (mode: ExecutionMode) => void;
  setAutoServerThresholdMb: (mb: number) => void;
  setMagicEffects: (enabled: boolean) => void;
  setAutoSaveTargetId: (id: string | null) => void;
  setDownloaderSleepSeconds: (seconds: number) => void;
  setTourSeen: (seen: boolean) => void;
  setBooruEnabled: (enabled: boolean) => void;
  reset: () => void;
}

export const DEFAULT_SETTINGS: SettingsState = {
  theme: 'system',
  language: null,
  expertMode: false,
  defaultMode: 'auto',
  autoServerThresholdMb: 200,
  magicEffects: true,
  autoSaveTargetId: null,
  downloaderSleepSeconds: DEFAULT_SLEEP_SECONDS,
  tourSeen: false,
  booruEnabled: false,
};

export const SETTINGS_STORAGE_KEY = 'conbert-settings';

/** Only the data fields of the store (no actions). */
export function pickSettings(s: SettingsState): SettingsState {
  return {
    theme: s.theme,
    language: s.language,
    expertMode: s.expertMode,
    defaultMode: s.defaultMode,
    autoServerThresholdMb: s.autoServerThresholdMb,
    magicEffects: s.magicEffects,
    autoSaveTargetId: s.autoSaveTargetId,
    downloaderSleepSeconds: s.downloaderSleepSeconds,
    tourSeen: s.tourSeen,
    booruEnabled: s.booruEnabled,
  };
}

/** Validates settings that come from the server; unknown or invalid fields are dropped. */
const remoteSettingsSchema = z
  .object({
    theme: z.enum(['system', 'light', 'dark']),
    language: z.enum(['de', 'en']).nullable(),
    expertMode: z.boolean(),
    defaultMode: z.enum(['local', 'server', 'auto']),
    autoServerThresholdMb: z.number().int().min(1).max(10_000),
    magicEffects: z.boolean(),
    autoSaveTargetId: z.string().uuid().nullable(),
    downloaderSleepSeconds: z.number().min(MIN_SLEEP_SECONDS).max(MAX_SLEEP_SECONDS),
    tourSeen: z.boolean(),
    booruEnabled: z.boolean(),
  })
  .partial();

export function parseRemoteSettings(data: unknown): Partial<SettingsState> {
  if (typeof data !== 'object' || data === null) return {};
  const result: Partial<SettingsState> = {};
  const shape = remoteSettingsSchema.shape;
  for (const [key, schema] of Object.entries(shape)) {
    const parsed = schema.safeParse((data as Record<string, unknown>)[key]);
    if (parsed.success && parsed.data !== undefined) {
      (result as Record<string, unknown>)[key] = parsed.data;
    }
  }
  return result;
}

/** Storage that never throws (private windows, blocked site data …). */
const safeStorage = createJSONStorage<Partial<SettingsState>>(() => ({
  getItem: (name) => {
    try {
      return localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      localStorage.setItem(name, value);
    } catch {
      // Settings simply aren't remembered in this browser.
    }
  },
  removeItem: (name) => {
    try {
      localStorage.removeItem(name);
    } catch {
      // ignore
    }
  },
}));

export const useSettings = create<SettingsState & SettingsActions>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      setTheme: (theme) => set({ theme }),
      setLanguage: (language) => set({ language }),
      setExpertMode: (expertMode) => set({ expertMode }),
      setDefaultMode: (defaultMode) => set({ defaultMode }),
      setAutoServerThresholdMb: (mb) =>
        set({ autoServerThresholdMb: Math.min(10_000, Math.max(1, Math.round(mb))) }),
      setMagicEffects: (magicEffects) => set({ magicEffects }),
      setAutoSaveTargetId: (autoSaveTargetId) => set({ autoSaveTargetId }),
      setDownloaderSleepSeconds: (seconds) =>
        set({
          downloaderSleepSeconds: Math.min(
            MAX_SLEEP_SECONDS,
            Math.max(MIN_SLEEP_SECONDS, Math.round(seconds)),
          ),
        }),
      setTourSeen: (tourSeen) => set({ tourSeen }),
      setBooruEnabled: (booruEnabled) => set({ booruEnabled }),
      // Resetting the settings shouldn't bring the tour back.
      reset: () => set((s) => ({ ...DEFAULT_SETTINGS, tourSeen: s.tourSeen })),
    }),
    {
      name: SETTINGS_STORAGE_KEY,
      version: 1,
      storage: safeStorage,
      partialize: (s): Partial<SettingsState> => pickSettings(s),
    },
  ),
);
