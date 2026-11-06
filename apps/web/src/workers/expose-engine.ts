import * as Comlink from 'comlink';
import { ConversionError } from '@conbert/core';

export interface InitResult {
  /** Formats that can't be handled right now (e.g. an optional module failed to load). */
  unavailableFormats: string[];
}

export type ConvertResult =
  { ok: true; data: Uint8Array } | { ok: false; messageKey: string; details?: string };

export type ProgressCallback = (percent: number, stage?: string) => void;

/** What a worker implements; `exposeEngine` adds error handling and transfers. */
export interface WorkerEngineImpl {
  init(): Promise<InitResult>;
  convert(
    input: Uint8Array,
    inputExt: string,
    outputExt: string,
    options: Record<string, unknown>,
    onProgress: ProgressCallback,
  ): Promise<Uint8Array> | Uint8Array;
}

/** The API the main thread sees (via Comlink). */
export interface WorkerEngineApi {
  init(): Promise<InitResult>;
  convert(
    input: Uint8Array,
    inputExt: string,
    outputExt: string,
    options: Record<string, unknown>,
    onProgress?: ProgressCallback,
  ): Promise<ConvertResult>;
}

/**
 * Exposes an engine implementation from a Web Worker. Errors are returned
 * as data so the i18n key survives the worker boundary; results are
 * transferred instead of copied.
 */
export function exposeEngine(impl: WorkerEngineImpl): void {
  const api: WorkerEngineApi = {
    init: () => impl.init(),
    async convert(input, inputExt, outputExt, options, onProgress) {
      try {
        const data = await impl.convert(input, inputExt, outputExt, options, (p, s) =>
          onProgress?.(p, s),
        );
        return Comlink.transfer({ ok: true, data }, [data.buffer]);
      } catch (error) {
        if (error instanceof ConversionError) {
          const result: ConvertResult = { ok: false, messageKey: error.messageKey };
          if (error.details) result.details = error.details;
          return result;
        }
        const message = error instanceof Error ? error.message : String(error);
        const memory =
          /out of memory|memory access out of bounds|Cannot enlarge memory|RangeError/i;
        return {
          ok: false,
          messageKey: memory.test(message) ? 'errors.outOfMemory' : 'errors.convertFailed',
          details: message,
        };
      }
    },
  };
  Comlink.expose(api);
}
