import { useEffect } from 'react';
import { create } from 'zustand';
import { settingsResponseSchema } from '@conbert/schemas';
import { apiGet, apiPut } from '@/lib/api';
import { parseRemoteSettings, pickSettings, useSettings } from './settings-store';

const SAVE_DELAY_MS = 600;

/** True once the signed-in user's settings came from the server (or that failed). */
export const useSettingsReady = create<{ ready: boolean }>()(() => ({ ready: false }));

/**
 * Keeps the settings of the signed-in user on the server, so they follow the
 * user to every device. localStorage stays as a fast local cache.
 */
export function useSettingsSync(userId: string | undefined): void {
  useEffect(() => {
    if (!userId) return;
    useSettingsReady.setState({ ready: false });
    let cancelled = false;
    let loaded = false;
    let applying = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    apiGet('/api/settings', settingsResponseSchema)
      .then(({ settings }) => {
        if (cancelled) return;
        const remote = parseRemoteSettings(settings);
        if (Object.keys(remote).length > 0) {
          applying = true;
          useSettings.setState(remote);
          applying = false;
        } else {
          // First sign-in: keep what this browser had and store it for the user.
          void apiPut('/api/settings', { settings: pickSettings(useSettings.getState()) }).catch(
            () => undefined,
          );
        }
      })
      .catch(() => undefined)
      .finally(() => {
        loaded = true;
        if (!cancelled) useSettingsReady.setState({ ready: true });
      });

    const unsubscribe = useSettings.subscribe((state) => {
      if (applying || !loaded) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        void apiPut('/api/settings', { settings: pickSettings(state) }).catch(() => undefined);
      }, SAVE_DELAY_MS);
    });

    return () => {
      cancelled = true;
      clearTimeout(timer);
      unsubscribe();
    };
  }, [userId]);
}
