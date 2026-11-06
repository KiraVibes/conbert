import * as Comlink from 'comlink';
import type { FunWorkerApi } from '@/workers/fun.worker';

let api: Comlink.Remote<FunWorkerApi> | null = null;

/** One shared worker for the picture fun (started on first use). */
export function funWorker(): Comlink.Remote<FunWorkerApi> {
  api ??= Comlink.wrap<FunWorkerApi>(
    new Worker(new URL('../../../workers/fun.worker.ts', import.meta.url), {
      type: 'module',
      name: 'workshop-fun',
    }),
  );
  return api;
}
