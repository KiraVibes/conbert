import {
  ConversionError,
  compressionOptions,
  decideRoute,
  defaultOptions,
  readTrim,
  compressToSize,
  getFormat,
  hasMetadataEdits,
  isAbortError,
  metadataWritable,
  outputFileName,
  type EngineDescriptor,
  type Route,
  type RouteStep,
  type RoutingContext,
} from '@conbert/core';
import { getBrowserEngine } from '@/engines/registry';
import { convertOnServer } from '@/engines/server-convert';
import { recordResult } from '@/features/archive/history-store';
import { recordJob } from '@/features/archive/job-log';
import { autoSaveResult } from '@/features/storage/auto-save';
import { writeMetadataEdits } from '@/features/metadata/metadata-engine';
import { mediaDuration } from '@/lib/media-duration';
import { useFiles, type FileItem } from './files-store';
import { imageAiDecision, wantsImageAi } from './image-ai';

/** Sizes in the compress tab are in MB as Conbert shows them everywhere (1 MB = 1024 × 1024 bytes). */
const MB = 1024 * 1024;

/** Errors after which another engine might still succeed. */
const RETRYABLE = new Set([
  'errors.formatUnavailable',
  'errors.engineLoadFailed',
  'errors.engineOffline',
  'errors.notIsolated',
]);

/** Running conversions, so they can be cancelled. */
const controllers = new Map<string, AbortController>();

/** Options as the history keeps them: chosen files (e.g. subtitles) stay out. */
export function rememberedOptions(options: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(options).filter(([, value]) => !(value instanceof Blob)),
  );
}

export function cancelConversion(id: string): void {
  controllers.get(id)?.abort();
}

export function isConverting(id: string): boolean {
  return controllers.has(id);
}

/** Runs a browser route step by step; only the last step gets the given options. */
export async function runBrowserSteps(
  input: Blob,
  steps: readonly RouteStep[],
  userOptions: Record<string, unknown>,
  signal: AbortSignal,
  onProgress: (percent: number, stage?: string) => void,
): Promise<Blob> {
  let current: Blob = input;
  for (const [index, step] of steps.entries()) {
    const engine = getBrowserEngine(step.engineId);
    if (!engine) throw new ConversionError('errors.noRoute', `browser:${step.engineId}`);
    const isLast = index === steps.length - 1;
    const options = isLast
      ? {
          ...defaultOptions(engine.options, step.to),
          // Engines may use it as a name inside the file (e.g. an e-book's title).
          ...(input instanceof File && { title: input.name.replace(/\.[^.]+$/, '') }),
          ...userOptions,
        }
      : defaultOptions(engine.options, step.to);
    const output = await engine.convert({
      input: current,
      inputExt: step.from,
      outputExt: step.to,
      options,
      signal,
      onProgress: ({ percent, stage }) =>
        onProgress(((index + percent / 100) / steps.length) * 100, stage),
    });
    if (typeof output === 'string') {
      throw new ConversionError('errors.convertFailed', 'unexpected path result in browser');
    }
    current = output;
  }
  return current;
}

/**
 * Converts one file along the route the router picks. Chains run step by
 * step; only the last step gets the user's options, intermediate steps use
 * the engine defaults.
 */
export async function runConversion(
  item: FileItem,
  engines: readonly EngineDescriptor[],
  ctx: Omit<RoutingContext, 'mode' | 'fileSize'>,
): Promise<void> {
  const store = useFiles.getState();
  if (!item.targetExt || controllers.has(item.id)) return;

  const compress = item.task === 'compress';
  const decision =
    !compress && wantsImageAi(item.options)
      ? // AI work on pictures runs on the server; it builds the route itself.
        imageAiDecision(engines, item.ext, item.targetExt, ctx.serverAvailable)
      : decideRoute(engines, item.ext, item.targetExt, {
          ...ctx,
          mode: item.mode,
          fileSize: item.file.size,
          compress,
          trim: !compress && readTrim(item.options) !== null,
        });
  const startedAt = Date.now();
  if (!decision.route) {
    store.update(item.id, {
      status: 'error',
      error: { messageKey: 'errors.noRoute', details: decision.reason },
    });
    recordJob(item, {
      options: rememberedOptions(item.options),
      startedAt,
      error: 'errors.noRoute',
    });
    return;
  }

  const controller = new AbortController();
  controllers.set(item.id, controller);
  store.update(item.id, {
    status: 'converting',
    progress: 0,
    stage: undefined,
    error: undefined,
    autoSave: undefined,
  });

  const onProgress = (percent: number, stage?: string) =>
    useFiles.getState().update(item.id, { progress: Math.round(percent), stage });
  const targetExt = item.targetExt;
  const category = getFormat(targetExt)?.category;
  const targetBytes =
    compress && item.compress.level === 'target' && item.compress.targetMb
      ? Math.round(item.compress.targetMb * MB)
      : undefined;
  const media = category === 'video' || category === 'audio';
  let options = item.options;
  // The route that ran (or ran last), for the history.
  let usedRoute: Route = decision.route;
  const outcome = (extra: { error?: string; resultSize?: number; keptOriginal?: boolean }) => ({
    runtime: usedRoute.runtime,
    engineIds: usedRoute.steps.map((s) => s.engineId),
    // The person's own choices; compress presets come back from item.compress.
    options: rememberedOptions(item.options),
    startedAt,
    ...extra,
  });
  const runRoute = (route: Route) =>
    route.runtime === 'server'
      ? // The server picks its engines and runs chains itself.
        convertOnServer({
          file: item.file,
          fileName: item.file.name,
          outputExt: targetExt,
          options,
          mode: compress ? 'compress' : 'convert',
          signal: controller.signal,
          onProgress: ({ percent, stage }) => onProgress(percent, stage),
        })
      : targetBytes
        ? // Compressing to a size: try settings until the result fits.
          compressToSize({
            outputExt: targetExt,
            targetBytes,
            encode: (overrides) =>
              runBrowserSteps(
                item.file,
                route.steps,
                { ...options, ...overrides },
                controller.signal,
                // Video and sound report their own progress per try.
                media ? onProgress : () => undefined,
              ),
            sizeOf: (blob) => blob.size,
            onTry: media
              ? undefined
              : (attempt, total) => onProgress((attempt / total) * 100, 'converting'),
          })
        : runBrowserSteps(item.file, route.steps, options, controller.signal, onProgress);
  try {
    if (compress) {
      const preset = compressionOptions(targetExt, {
        level: item.compress.level,
        ...(targetBytes && { targetBytes }),
        stripMetadata: item.compress.stripMetadata,
      });
      // Bitrates for a target size need the length of the video or song.
      const duration =
        targetBytes && (category === 'video' || category === 'audio')
          ? await mediaDuration(item.file)
          : null;
      // Expert settings from the options panel win over the preset.
      options = { ...preset, ...(duration && { durationSeconds: duration }), ...item.options };
    }
    // If an engine can't handle the file right now (module missing, engine
    // didn't load), quietly try the next possible route.
    const routes = [decision.route, ...decision.alternatives];
    // Already small enough in the same format: nothing to do, keep it.
    const alreadyFits =
      targetBytes !== undefined && targetExt === item.ext && item.file.size <= targetBytes;
    let current: Blob | undefined = alreadyFits ? item.file : undefined;
    for (const [index, route] of alreadyFits ? [] : routes.entries()) {
      try {
        usedRoute = route;
        current = await runRoute(route);
        break;
      } catch (error) {
        const last = index === routes.length - 1;
        if (last || !(error instanceof ConversionError) || !RETRYABLE.has(error.messageKey)) {
          throw error;
        }
      }
    }
    if (!current) throw new ConversionError('errors.noRoute');

    // Compressing must never make things worse: keep the original then.
    const keep = compress && current.size >= item.file.size;
    const ext = keep ? item.ext : item.targetExt;
    let result: Blob = keep ? item.file : current;
    // Metadata changes (expert mode) go into the finished file, on this device.
    // If that fails, the converted file is kept and the card says why.
    let metadataOutcome: FileItem['metadataOutcome'];
    if (hasMetadataEdits(item.metadata) && metadataWritable(ext)) {
      onProgress(99, 'metadata');
      try {
        result = await writeMetadataEdits(result, ext, item.metadata);
        metadataOutcome = { state: 'written' };
      } catch (error) {
        metadataOutcome = {
          state: 'error',
          error:
            error instanceof ConversionError
              ? { messageKey: error.messageKey, ...(error.details && { details: error.details }) }
              : { messageKey: 'errors.metadataWriteFailed', details: String(error) },
        };
      }
    }
    useFiles.getState().setResult(item.id, {
      blob: result,
      url: URL.createObjectURL(result),
      ext,
      fileName: outputFileName(item.name, ext),
      ...(keep && { keptOriginal: true }),
    });
    if (metadataOutcome) useFiles.getState().update(item.id, { metadataOutcome });
    // Every finished file also goes into the archive.
    const finished = useFiles.getState().files.find((f) => f.id === item.id);
    if (finished) {
      recordResult(finished);
      recordJob(finished, outcome({ resultSize: result.size, keptOriginal: keep }));
      // Setting "save every conversion automatically": runs in the background.
      void autoSaveResult(finished);
    }
  } catch (error) {
    if (isAbortError(error)) {
      useFiles.getState().update(item.id, { status: 'idle', progress: 0, stage: undefined });
    } else if (error instanceof ConversionError) {
      const fileError: { messageKey: string; details?: string } = { messageKey: error.messageKey };
      if (error.details) fileError.details = error.details;
      useFiles.getState().update(item.id, { status: 'error', error: fileError });
      recordJob(item, outcome({ error: error.messageKey }));
    } else {
      console.error('conversion failed', error);
      useFiles.getState().update(item.id, {
        status: 'error',
        error: { messageKey: 'errors.convertFailed', details: String(error) },
      });
      recordJob(item, outcome({ error: 'errors.convertFailed' }));
    }
  } finally {
    controllers.delete(item.id);
  }
}

/** Converts files one after another (WASM engines share the browser's memory). */
export async function runAll(
  items: readonly FileItem[],
  engines: readonly EngineDescriptor[],
  ctx: Omit<RoutingContext, 'mode' | 'fileSize'>,
): Promise<void> {
  for (const item of items) {
    const fresh = useFiles.getState().files.find((f) => f.id === item.id);
    if (fresh && fresh.targetExt && fresh.status !== 'done' && fresh.status !== 'converting') {
      await runConversion(fresh, engines, ctx);
    }
  }
}
