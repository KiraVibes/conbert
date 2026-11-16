import * as Comlink from 'comlink';
import {
  ConversionError,
  abortError,
  getFormat,
  type ConvertRequest,
  type Engine,
  type EngineStatus,
} from '@conbert/core';
import type { WorkerEngineApi } from '@/workers/expose-engine';
import { useEngineStatus, type EngineStatusEntry } from './engine-status-store';
import { engineLoadError, workerFailure } from './load-error';

/** Multi-threaded WASM needs SharedArrayBuffer, which needs HTTPS or localhost. */
export function isolationAvailable(): boolean {
  return globalThis.crossOriginIsolated === true && typeof SharedArrayBuffer === 'function';
}

export interface WorkerEngineConfig {
  meta: Omit<Engine, 'init' | 'status' | 'convert'>;
  /** Creates the Web Worker (must use `new Worker(new URL(...), …)` for Vite). */
  createWorker: () => Worker;
  /** The engine uses threads and only works when cross-origin isolated. */
  needsIsolation: boolean;
}

/**
 * Turns a worker that uses `exposeEngine` into an Engine: lazy loading,
 * status reporting for the UI, cancelling (by terminating the worker) and
 * zero-copy transfer of the file data.
 */
export function createWorkerEngine(config: WorkerEngineConfig): Engine {
  const { meta } = config;
  let worker: Worker | null = null;
  let api: Comlink.Remote<WorkerEngineApi> | null = null;
  let initPromise: Promise<void> | null = null;
  // Known right away: without isolation a threaded engine can't start, so the
  // router can choose something else instead of failing later.
  let entry: EngineStatusEntry =
    config.needsIsolation && !isolationAvailable()
      ? { status: 'error', messageKey: 'errors.notIsolated' }
      : { status: 'uninitialized' };
  useEngineStatus.getState().set(meta.id, entry);

  const report = (next: EngineStatusEntry) => {
    entry = next;
    useEngineStatus.getState().set(meta.id, next);
  };

  const terminate = () => {
    api?.[Comlink.releaseProxy]();
    worker?.terminate();
    worker = null;
    api = null;
    initPromise = null;
  };

  const init = (): Promise<void> => {
    if (initPromise) return initPromise;
    if (config.needsIsolation && !isolationAvailable()) {
      report({ status: 'error', messageKey: 'errors.notIsolated' });
      return Promise.reject(new ConversionError('errors.notIsolated'));
    }
    report({ status: 'loading' });
    worker = config.createWorker();
    api = Comlink.wrap<WorkerEngineApi>(worker);
    initPromise = Promise.race([api.init(), workerFailure(worker)])
      .then(({ unavailableFormats }) => {
        report(
          unavailableFormats.length > 0
            ? { status: 'partial', unavailableFormats, messageKey: 'errors.formatUnavailable' }
            : { status: 'ready' },
        );
      })
      .catch(async (error: unknown) => {
        terminate();
        const failure = await engineLoadError(error);
        report({ status: 'error', messageKey: failure.messageKey });
        throw failure;
      });
    return initPromise;
  };

  const convert = async (req: ConvertRequest): Promise<Blob> => {
    const { signal, onProgress } = req;
    if (signal?.aborted) throw abortError();
    if (typeof req.input === 'string') {
      throw new ConversionError('errors.convertFailed', 'browser engine needs a Blob input');
    }
    const onAbort = () => {
      // Terminating the worker is the only way to stop a running WASM call.
      terminate();
      report({ status: 'uninitialized' });
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      if (entry.status !== 'ready' && entry.status !== 'partial') {
        onProgress?.({ percent: 5, stage: 'loadingEngine' });
      }
      await init();
      if (signal?.aborted) throw abortError();
      if (entry.unavailableFormats?.some((ext) => ext === req.inputExt || ext === req.outputExt)) {
        throw new ConversionError('errors.formatUnavailable');
      }

      onProgress?.({ percent: 15, stage: 'reading' });
      const input = new Uint8Array(await req.input.arrayBuffer());
      if (signal?.aborted) throw abortError();

      onProgress?.({ percent: 20, stage: 'converting' });
      const remote = api;
      if (!remote) throw abortError();
      const result = await remote.convert(
        Comlink.transfer(input, [input.buffer]),
        req.inputExt,
        req.outputExt,
        req.options,
        Comlink.proxy((percent: number, stage?: string) =>
          onProgress?.({ percent: 20 + Math.round(percent * 0.78), stage: stage ?? 'converting' }),
        ),
      );
      if (signal?.aborted) throw abortError();
      if (!result.ok) throw new ConversionError(result.messageKey, result.details);

      onProgress?.({ percent: 100, stage: 'done' });
      const mime = getFormat(req.outputExt)?.mime ?? 'application/octet-stream';
      return new Blob([result.data as Uint8Array<ArrayBuffer>], { type: mime });
    } catch (error) {
      // A terminated worker rejects pending calls – report that as a cancel.
      if (signal?.aborted) throw abortError();
      throw error;
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  };

  return {
    ...meta,
    formats: meta.formats.map((f) => ({ ...f, mime: f.mime ?? getFormat(f.ext)?.mime ?? '' })),
    options: [...meta.options],
    init,
    status: (): EngineStatus => entry.status,
    convert,
  };
}
