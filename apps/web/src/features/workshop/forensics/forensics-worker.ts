import * as Comlink from 'comlink';
import type { ForensicsWorkerApi } from '@/workers/forensics.worker';

/**
 * Runs `job` in a fresh forensics worker and stops the worker afterwards –
 * these checks are rare and can hold a lot of memory.
 */
export async function withForensics<T>(
  job: (api: Comlink.Remote<ForensicsWorkerApi>) => Promise<T>,
): Promise<T> {
  const worker = new Worker(new URL('../../../workers/forensics.worker.ts', import.meta.url), {
    type: 'module',
    name: 'forensics',
  });
  const api = Comlink.wrap<ForensicsWorkerApi>(worker);
  try {
    return await job(api);
  } finally {
    api[Comlink.releaseProxy]();
    worker.terminate();
  }
}
