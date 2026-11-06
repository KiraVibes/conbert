import {
  ConversionError,
  abortError,
  getFormat,
  type ConvertRequest,
  type Engine,
  type EngineStatus,
} from '@conbert/core';
import { useEngineStatus } from './engine-status-store';

export interface MainThreadEngineConfig {
  meta: Omit<Engine, 'init' | 'status' | 'convert'>;
  /** Loads the library (lazily, once). */
  load: () => Promise<void>;
  /** Converts; heavy work must happen in the library's own worker. */
  run: (
    input: Blob,
    inputExt: string,
    outputExt: string,
    options: Record<string, unknown>,
    onProgress: (percent: number, stage?: string) => void,
  ) => Promise<Blob>;
}

/**
 * Engines whose library brings its own Web Worker (libarchive.js, pdf.js):
 * the control code runs here, the heavy lifting in the library's worker.
 */
export function createMainThreadEngine(config: MainThreadEngineConfig): Engine {
  const { meta } = config;
  let status: EngineStatus = 'uninitialized';
  let loading: Promise<void> | null = null;
  const report = (next: EngineStatus, messageKey?: string) => {
    status = next;
    useEngineStatus
      .getState()
      .set(meta.id, messageKey ? { status: next, messageKey } : { status: next });
  };
  report('uninitialized');

  const init = (): Promise<void> => {
    loading ??= (async () => {
      report('loading');
      try {
        await config.load();
        report('ready');
      } catch (error) {
        loading = null;
        report('error', 'errors.engineLoadFailed');
        throw new ConversionError('errors.engineLoadFailed', String(error));
      }
    })();
    return loading;
  };

  return {
    ...meta,
    formats: meta.formats.map((f) => ({ ...f, mime: f.mime ?? getFormat(f.ext)?.mime ?? '' })),
    options: [...meta.options],
    init,
    status: () => status,
    async convert(req: ConvertRequest): Promise<Blob> {
      if (req.signal?.aborted) throw abortError();
      if (typeof req.input === 'string') {
        throw new ConversionError('errors.convertFailed', 'browser engine needs a Blob input');
      }
      if (status !== 'ready') req.onProgress?.({ percent: 3, stage: 'loadingEngine' });
      await init();
      const result = await config.run(
        req.input,
        req.inputExt,
        req.outputExt,
        req.options,
        (percent, stage) => req.onProgress?.({ percent, stage: stage ?? 'converting' }),
      );
      if (req.signal?.aborted) throw abortError();
      req.onProgress?.({ percent: 100, stage: 'done' });
      return result;
    },
  };
}
