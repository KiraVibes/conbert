import { ConversionError } from '@conbert/core';

/** Asks the server whether it can be reached (the service worker never caches /api/). */
async function serverReachable(): Promise<boolean> {
  if (navigator.onLine === false) return false;
  try {
    const res = await fetch('/api/health', {
      cache: 'no-store',
      signal: AbortSignal.timeout(4000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * The error for an engine that couldn't load. Without a connection to the
 * server the cause is almost always that the engine was never stored for
 * offline use – that gets its own message telling how to fix it.
 */
export async function engineLoadError(error: unknown): Promise<ConversionError> {
  const key = (await serverReachable()) ? 'errors.engineLoadFailed' : 'errors.engineOffline';
  return new ConversionError(key, String(error));
}

/**
 * Rejects when the worker script itself fails to load (e.g. offline and not
 * stored): the worker never answers then, so waiting for it would hang.
 */
export function workerFailure(worker: Worker): Promise<never> {
  return new Promise((_, reject) => {
    worker.addEventListener(
      'error',
      (event) => {
        event.preventDefault();
        reject(new Error(event.message || 'the engine worker could not be started'));
      },
      { once: true },
    );
  });
}
