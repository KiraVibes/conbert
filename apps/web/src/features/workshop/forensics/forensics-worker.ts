import * as Comlink from 'comlink';
import type { ForensicsWorkerApi } from '@/workers/forensics.worker';

/** A forensics worker and a way to stop it (for pages that use it again and again). */
export function openForensics(): { api: Comlink.Remote<ForensicsWorkerApi>; stop: () => void } {
  const worker = new Worker(new URL('../../../workers/forensics.worker.ts', import.meta.url), {
    type: 'module',
    name: 'forensics',
  });
  const api = Comlink.wrap<ForensicsWorkerApi>(worker);
  return {
    api,
    stop: () => {
      api[Comlink.releaseProxy]();
      worker.terminate();
    },
  };
}

/**
 * Runs `job` in a fresh forensics worker and stops the worker afterwards –
 * these checks are rare and can hold a lot of memory.
 */
export async function withForensics<T>(
  job: (api: Comlink.Remote<ForensicsWorkerApi>) => Promise<T>,
): Promise<T> {
  const { api, stop } = openForensics();
  try {
    return await job(api);
  } finally {
    stop();
  }
}
