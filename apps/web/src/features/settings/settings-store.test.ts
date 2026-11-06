import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY, useSettings } from './settings-store';

describe('settings store', () => {
  beforeEach(() => {
    localStorage.clear();
    useSettings.getState().reset();
  });

  it('starts in simple mode with automatic execution', () => {
    const s = useSettings.getState();
    expect(s.expertMode).toBe(false);
    expect(s.defaultMode).toBe('auto');
    expect(s.autoServerThresholdMb).toBe(200);
    expect(s.theme).toBe('system');
    expect(s.language).toBeNull();
  });

  it('remembers changes in localStorage', () => {
    useSettings.getState().setExpertMode(true);
    useSettings.getState().setDefaultMode('local');
    const saved = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? '{}');
    expect(saved.state).toMatchObject({ expertMode: true, defaultMode: 'local' });
  });

  it('keeps the threshold within sensible limits', () => {
    useSettings.getState().setAutoServerThresholdMb(0);
    expect(useSettings.getState().autoServerThresholdMb).toBe(1);
    useSettings.getState().setAutoServerThresholdMb(99_999);
    expect(useSettings.getState().autoServerThresholdMb).toBe(10_000);
    useSettings.getState().setAutoServerThresholdMb(12.6);
    expect(useSettings.getState().autoServerThresholdMb).toBe(13);
  });

  it('resets to defaults', () => {
    useSettings.getState().setTheme('dark');
    useSettings.getState().reset();
    expect(useSettings.getState().theme).toBe(DEFAULT_SETTINGS.theme);
  });
});
