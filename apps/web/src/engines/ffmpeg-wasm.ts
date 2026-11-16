import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';
import {
  ANIMATION_TARGETS,
  AUDIO_OPTIONS,
  AUDIO_TARGETS,
  ConversionError,
  VIDEO_OPTIONS,
  VIDEO_TARGETS,
  abortError,
  buildFfmpegArgs,
  needsSilenceScan,
  parseAudioChannels,
  parseTrailingSilence,
  probeArgs,
  resolveMediaOptions,
  silenceDetectArgs,
  getFormat,
  normalizeExt,
  type ConvertRequest,
  type Engine,
  type FormatSupport,
} from '@conbert/core';
import { useEngineStatus, type EngineStatusEntry } from './engine-status-store';
import { engineLoadError } from './load-error';

/**
 * ffmpeg.wasm: audio and video in the browser. The FFmpeg class runs the
 * WASM in its own Web Worker. Only the single-threaded core is used: the
 * multi-threaded core of 0.12 hangs on video encoding, and with one encoder
 * thread it brings no speed-up – the single-threaded one also works without
 * HTTPS. The core (~31 MB) is served by Conbert itself, loaded on first use.
 */
const READ = [
  'mp3',
  'wav',
  'flac',
  'ogg',
  'opus',
  'm4a',
  'aac',
  'aiff',
  'wma',
  'mp4',
  'webm',
  'mkv',
  'mov',
  'avi',
  'wmv',
  'mpg',
  'gif',
];
const WRITE = [...AUDIO_TARGETS, ...VIDEO_TARGETS, ...ANIMATION_TARGETS];

const ID = 'ffmpeg-wasm';
let ffmpeg: FFmpeg | null = null;
let loading: Promise<FFmpeg> | null = null;
let entry: EngineStatusEntry = { status: 'uninitialized' };
useEngineStatus.getState().set(ID, entry);

function report(next: EngineStatusEntry): void {
  entry = next;
  useEngineStatus.getState().set(ID, next);
}

async function load(): Promise<FFmpeg> {
  if (ffmpeg) return ffmpeg;
  loading ??= (async () => {
    report({ status: 'loading' });
    const instance = new FFmpeg();
    const base = new URL('/wasm/ffmpeg/', window.location.origin).href;
    // Blob URLs keep Vite and the worker's module loader out of the way.
    await instance.load({
      coreURL: await toBlobURL(`${base}ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${base}ffmpeg-core.wasm`, 'application/wasm'),
    });
    ffmpeg = instance;
    report({ status: 'ready' });
    return instance;
  })().catch(async (error: unknown) => {
    loading = null;
    const failure = await engineLoadError(error);
    report({ status: 'error', messageKey: failure.messageKey });
    throw failure;
  });
  return loading;
}

function reset(): void {
  ffmpeg?.terminate();
  ffmpeg = null;
  loading = null;
  report({ status: 'uninitialized' });
}

async function convert(req: ConvertRequest): Promise<Blob> {
  const { signal, onProgress } = req;
  if (signal?.aborted) throw abortError();
  if (typeof req.input === 'string') {
    throw new ConversionError('errors.convertFailed', 'browser engine needs a Blob input');
  }
  const from = normalizeExt(req.inputExt);
  const to = normalizeExt(req.outputExt);
  const inName = `input.${from}`;
  const outName = `output.${to}`;
  // Terminating the worker is the only way to stop a running ffmpeg.wasm.
  const onAbort = () => reset();
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    if (entry.status !== 'ready') onProgress?.({ percent: 3, stage: 'loadingEngine' });
    const instance = await load();
    if (signal?.aborted) throw abortError();
    onProgress?.({ percent: 8, stage: 'reading' });
    await instance.writeFile(inName, new Uint8Array(await req.input.arrayBuffer()));

    const onFfmpegProgress = ({ progress }: { progress: number }) => {
      const p = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
      onProgress?.({ percent: 10 + Math.round(p * 85), stage: 'converting' });
    };
    let log = '';
    const onLog = ({ message }: { message: string }) => {
      log = (log + message + '\n').slice(-4000);
    };
    const sound = await lookAtSound(instance, inName, from, to, req.options);
    if (signal?.aborted) throw abortError();
    instance.on('progress', onFfmpegProgress);
    instance.on('log', onLog);
    let code: number;
    try {
      code = await instance.exec(
        buildFfmpegArgs({
          trailingSilenceAt: sound.silenceAt,
          audioChannels: sound.channels,
          input: inName,
          inputExt: from,
          output: outName,
          outputExt: to,
          options: req.options,
          target: 'wasm',
        }),
      );
    } finally {
      instance.off('progress', onFfmpegProgress);
      instance.off('log', onLog);
    }
    if (signal?.aborted) throw abortError();
    if (code !== 0) {
      throw new ConversionError(
        /matches no streams|does not contain any stream/i.test(log)
          ? 'errors.noMatchingStream'
          : /out of memory|Cannot enlarge memory/i.test(log)
            ? 'errors.outOfMemory'
            : 'errors.convertFailed',
        log.trim().slice(-1500),
      );
    }
    const data = await instance.readFile(outName);
    await instance.deleteFile(inName).catch(() => undefined);
    await instance.deleteFile(outName).catch(() => undefined);
    if (typeof data === 'string')
      throw new ConversionError('errors.convertFailed', 'unexpected text output');
    onProgress?.({ percent: 100, stage: 'done' });
    return new Blob([data as Uint8Array<ArrayBuffer>], {
      type: getFormat(to)?.mime ?? 'application/octet-stream',
    });
  } catch (error) {
    if (signal?.aborted) throw abortError();
    if (error instanceof ConversionError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    // A crashed WASM instance can't be reused.
    reset();
    throw new ConversionError(
      /memory|OOM/i.test(message) ? 'errors.outOfMemory' : 'errors.convertFailed',
      message,
    );
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * A first look before cleaning up the sound: "remove silence" needs to know
 * where the silence at the end begins, loudnorm the number of channels.
 */
async function lookAtSound(
  instance: FFmpeg,
  inName: string,
  from: string,
  to: string,
  options: Record<string, unknown>,
): Promise<{ silenceAt: number | null; channels: number | null }> {
  const silence = needsSilenceScan(to, options);
  if (!silence && !resolveMediaOptions(options).loudness)
    return { silenceAt: null, channels: null };
  // Only the lines that matter – a long file can have many silent parts.
  let log = '';
  const onLog = ({ message }: { message: string }) => {
    if (/silence_|Duration:|Audio:/.test(message)) log += message + '\n';
  };
  instance.on('log', onLog);
  try {
    // Without an output file ffmpeg only describes the input (and exits with 1).
    await instance.exec(silence ? silenceDetectArgs(inName, from) : probeArgs(inName, from));
  } finally {
    instance.off('log', onLog);
  }
  const channels = parseAudioChannels(log);
  if (!silence) return { silenceAt: null, channels };
  const scan = parseTrailingSilence(log, null);
  if (scan.allSilent) throw new ConversionError('errors.allSilent', 'silencedetect: only silence');
  return { silenceAt: scan.trailingAt, channels };
}

/**
 * Runs ffmpeg with arguments of its own on one input file – for workshop
 * tricks that don't convert (e.g. only change a tag). `args` must read
 * `inName` and write `outName`.
 */
export async function runFfmpeg(
  input: Blob,
  inName: string,
  outName: string,
  args: string[],
): Promise<Blob> {
  const instance = await load();
  await instance.writeFile(inName, new Uint8Array(await input.arrayBuffer()));
  let log = '';
  const onLog = ({ message }: { message: string }) => {
    log = (log + message + '\n').slice(-4000);
  };
  instance.on('log', onLog);
  try {
    const code = await instance.exec(args);
    if (code !== 0) throw new ConversionError('errors.convertFailed', log.trim().slice(-1500));
    const data = await instance.readFile(outName);
    if (typeof data === 'string')
      throw new ConversionError('errors.convertFailed', 'unexpected text output');
    return new Blob([data as Uint8Array<ArrayBuffer>], { type: input.type });
  } finally {
    instance.off('log', onLog);
    await instance.deleteFile(inName).catch(() => undefined);
    await instance.deleteFile(outName).catch(() => undefined);
  }
}

export const ffmpegWasmEngine: Engine = {
  id: ID,
  name: 'FFmpeg (Browser)',
  descriptionKey: 'engines.ffmpegWasm.description',
  category: 'video',
  runtime: 'browser',
  formats: [...new Set([...READ, ...WRITE])].map((ext): FormatSupport => ({
    ext,
    mime: getFormat(ext)?.mime ?? '',
    canRead: READ.includes(ext),
    canWrite: WRITE.includes(ext),
  })),
  options: [...VIDEO_OPTIONS.filter((o) => o.key !== 'useGpu'), ...AUDIO_OPTIONS],
  supportsCompression: true,
  supportsTrim: true,
  // The fallback in the browser – mediabunny is much faster where it works.
  priority: 5,
  init: async () => {
    await load();
  },
  status: () => entry.status,
  convert,
};
