import { useCallback, useEffect, useState } from 'react';
import { clearOffline, getOfflineStatus, prepareOffline, type OfflineStatus } from './offline';

export interface OfflineStorage {
  /** undefined = still asking, null = no service worker here (no HTTPS, dev server). */
  status: OfflineStatus | null | undefined;
  /** Every file of the app is stored: everything works offline. */
  complete: boolean;
  /** Bytes still missing for offline use. */
  missingBytes: number;
  progress: { done: number; total: number } | null;
  error: string | null;
  prepare: () => Promise<void>;
  clear: () => Promise<void>;
}

/** How much of the app is stored for offline use, and downloading the rest. */
export function useOfflineStorage(): OfflineStorage {
  const [status, setStatus] = useState<OfflineStatus | null | undefined>(undefined);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getOfflineStatus()
      .then((s) => !cancelled && setStatus(s))
      .catch(() => !cancelled && setStatus(null));
    return () => {
      cancelled = true;
    };
  }, []);

  const complete =
    status?.available === true &&
    status.cachedFiles !== undefined &&
    status.cachedFiles === status.files;
  const missingBytes = Math.max(0, (status?.bytes ?? 0) - (status?.cachedBytes ?? 0));

  const prepare = useCallback(async () => {
    setError(null);
    setProgress({ done: status?.cachedBytes ?? 0, total: status?.bytes ?? 0 });
    try {
      setStatus(await prepareOffline((done, total) => setProgress({ done, total })));
    } catch (e) {
      setError(String(e));
    } finally {
      setProgress(null);
    }
  }, [status]);

  const clear = useCallback(async () => {
    setError(null);
    try {
      setStatus(await clearOffline());
    } catch (e) {
      setError(String(e));
    }
  }, []);

  return { status, complete, missingBytes, progress, error, prepare, clear };
}

/** Conbert runs as an installed app (home screen), not in a browser tab. */
export function isInstalledApp(): boolean {
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return standalone || window.matchMedia?.('(display-mode: standalone)').matches === true;
}
