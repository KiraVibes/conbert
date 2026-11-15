import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  parseRemoteSettings,
  SETTINGS_STORAGE_KEY,
  useSettings,
} from './settings-store';

describe('settings store', () => {
  beforeEach(() => {
    localStorage.clear();
    useSettings.getState().reset();
    useSettings.setState({ workshopFavorites: [] });
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

  it('pins and unpins workshop tools in the order they were added, and keeps them on reset', () => {
    const { toggleWorkshopFavorite } = useSettings.getState();
    toggleWorkshopFavorite('palette');
    toggleWorkshopFavorite('hex');
    toggleWorkshopFavorite('morse');
    toggleWorkshopFavorite('hex');
    expect(useSettings.getState().workshopFavorites).toEqual(['palette', 'morse']);
    useSettings.getState().reset();
    expect(useSettings.getState().workshopFavorites).toEqual(['palette', 'morse']);
  });

  it('accepts only sensible favourites from the server', () => {
    expect(parseRemoteSettings({ workshopFavorites: ['palette', 'morse'] })).toEqual({
      workshopFavorites: ['palette', 'morse'],
    });
    expect(parseRemoteSettings({ workshopFavorites: ['<script>'] })).toEqual({});
    expect(parseRemoteSettings({ workshopFavorites: 'palette' })).toEqual({});
  });
});
