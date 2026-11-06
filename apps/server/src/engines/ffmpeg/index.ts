import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  ANIMATION_TARGETS,
  AUDIO_OPTIONS,
  BURN_SUBTITLE_OPTIONS,
  ConversionError,
  VIDEO_OPTIONS,
  abortError,
  getFormat,
  isAbortError,
  normalizeExt,
  resolveBurnSubtitles,
  trimmedLength,
  type ConvertRequest,
  type Engine,
  type EngineStatus,
  type FormatSupport,
} from '@conbert/core';
import { ProcessError, runProcess } from '../../lib/run-process';
import {
  AUDIO_OUTPUTS,
  DEMUXER,
  VIDEO_OUTPUTS,
  buildFfmpegArgs,
  needsSilenceScan,
  parseProgressSeconds,
  parseTrailingSilence,
  silenceDetectArgs,
  type GpuKind,
} from '@conbert/core';
import { convertSubtitles, decodeSubtitleText, subtitleFormatOf } from '@conbert/core/subtitles';
import { detectHardware, type HardwareInfo } from './hardware';
import { subtitleTracks } from './subtitle-tracks';

export const FFMPEG = process.env['CONBERT_FFMPEG_PATH'] ?? 'ffmpeg';
const FFPROBE = process.env['CONBERT_FFPROBE_PATH'] ?? 'ffprobe';
/** Long videos take time; this only stops runaway processes. */
const TIMEOUT_MS = 6 * 60 * 60 * 1000;

const AUDIO_IN = ['mp3', 'wav', 'flac', 'ogg', 'opus', 'm4a', 'aac', 'aiff', 'wma'];
const VIDEO_IN = ['mp4', 'webm', 'mkv', 'mov', 'avi', 'wmv', 'mpg', 'gif'];

function support(read: string[], write: string[]): FormatSupport[] {
  return [...new Set([...read, ...write])].map((ext) => ({
    ext,
    mime: getFormat(ext)?.mime ?? '',
    canRead: read.includes(ext),
    canWrite: write.includes(ext),
  }));
}

let status: EngineStatus = 'uninitialized';
let hardware: HardwareInfo = { gpu: null, compiled: [] };
let initPromise: Promise<void> | null = null;

/** GPU and encoder info for the settings page and the router. */
export function getHardwareInfo(): HardwareInfo {
  return hardware;
}

function init(): Promise<void> {
  initPromise ??= (async () => {
    status = 'loading';
    try {
      await runProcess(FFMPEG, ['-hide_banner', '-version'], { timeoutMs: 10_000 });
      await runProcess(FFPROBE, ['-hide_banner', '-version'], { timeoutMs: 10_000 });
      hardware = await detectHardware();
      status = 'ready';
    } catch {
      // Not installed (e.g. local development on Windows).
      status = 'error';
    }
  })();
  return initPromise;
}

/** Duration in seconds, or null if ffprobe can't tell (then progress is stage-based). */
export async function probeDuration(input: string, inputExt: string): Promise<number | null> {
  const demuxer = DEMUXER[inputExt];
  if (!demuxer) return null;
  try {
    const { stdout } = await runProcess(
      FFPROBE,
      [
        '-v',
        'error',
        '-protocol_whitelist',
        'file',
        '-f',
        demuxer,
        '-show_entries',
        'format=duration',
        '-of',
        'default=nw=1:nk=1',
        input,
      ],
      { timeoutMs: 30_000 },
    );
    const seconds = Number(stdout.trim());
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  } catch {
    return null;
  }
}

/**
 * What to burn into the picture: a chosen subtitle file (made into clean
 * UTF-8 ASS first, so old SRTs keep their umlauts) or a track of the video.
 */
async function burnChoice(
  req: ConvertRequest & { input: string; workDir: string },
  inputExt: string,
  outputExt: string,
): Promise<{ track: number; picture: boolean } | { file: string } | null> {
  if (!VIDEO_OUTPUTS.has(outputExt)) return null;
  const file = req.attachments?.['burnSubtitleFile'];
  if (file) {
    const bytes = new Uint8Array(await readFile(file));
    const ass = path.join(req.workDir, `${randomUUID()}.ass`);
    const from = subtitleFormatOf(decodeSubtitleText(bytes));
    await writeFile(ass, convertSubtitles(bytes, from, 'ass', {}));
    return { file: ass };
  }
  const burn = resolveBurnSubtitles(req.options);
  if (!burn) return null;
  const tracks = await subtitleTracks(req.input, inputExt).catch(() => []);
  const track = tracks[burn.track];
  if (!track) {
    throw new ConversionError(
      'errors.subtitlesNoTrack',
      `${tracks.length} subtitle track(s), wanted #${burn.track + 1}`,
    );
  }
  return { track: burn.track, picture: !track.text };
}

/** "Remove silence": a first pass finds where the silence at the end begins. */
async function trailingSilence(
  req: ConvertRequest & { input: string },
  inputExt: string,
  duration: number | null,
): Promise<number | null> {
  const { stderr } = await runProcess(FFMPEG, silenceDetectArgs(req.input, inputExt), {
    timeoutMs: TIMEOUT_MS,
    signal: req.signal,
  });
  const scan = parseTrailingSilence(stderr, duration);
  if (scan.allSilent) throw new ConversionError('errors.allSilent', 'silencedetect: only silence');
  return scan.trailingAt;
}

async function runFfmpeg(
  req: ConvertRequest,
  gpu: GpuKind | null,
  duration: number | null,
): Promise<string> {
  if (typeof req.input !== 'string' || !req.workDir) {
    throw new ConversionError('errors.convertFailed', 'ffmpeg needs a file path and workDir');
  }
  const inputExt = normalizeExt(req.inputExt);
  const outputExt = normalizeExt(req.outputExt);
  await mkdir(req.workDir, { recursive: true });
  const output = path.join(req.workDir, `${randomUUID()}.${outputExt}`);
  const silenceAt = needsSilenceScan(outputExt, req.options)
    ? await trailingSilence({ ...req, input: req.input }, inputExt, duration)
    : null;
  const args = buildFfmpegArgs({
    trailingSilenceAt: silenceAt,
    input: req.input,
    inputExt,
    output,
    outputExt,
    // Target sizes need the length of the input.
    options: duration ? { durationSeconds: duration, ...req.options } : req.options,
    gpu,
    burnSubtitles: await burnChoice(
      { ...req, input: req.input, workDir: req.workDir },
      inputExt,
      outputExt,
    ),
  });
  // Cutting: progress counts against the length of the part.
  const length = trimmedLength(duration, req.options);
  await runProcess(FFMPEG, args, {
    timeoutMs: TIMEOUT_MS,
    signal: req.signal,
    onStdout: (chunk) => {
      const seconds = parseProgressSeconds(chunk);
      if (seconds !== null && length) {
        req.onProgress?.({
          percent: Math.min(99, Math.round((seconds / length) * 100)),
          stage: 'converting',
        });
      }
    },
  });
  return output;
}

async function convert(req: ConvertRequest): Promise<string> {
  if (req.signal?.aborted) throw abortError();
  await init();
  if (status !== 'ready')
    throw new ConversionError('errors.formatUnavailable', 'ffmpeg is not installed');
  const inputExt = normalizeExt(req.inputExt);
  const outputExt = normalizeExt(req.outputExt);
  req.onProgress?.({ percent: 1, stage: 'converting' });
  const duration = typeof req.input === 'string' ? await probeDuration(req.input, inputExt) : null;
  const gpu = VIDEO_OUTPUTS.has(outputExt) ? hardware.gpu : null;

  try {
    const output = await runFfmpeg(req, gpu, duration);
    req.onProgress?.({ percent: 100, stage: 'done' });
    return output;
  } catch (error) {
    if (req.signal?.aborted || isAbortError(error)) throw abortError();
    if (gpu && error instanceof ProcessError && error.reason === 'exit') {
      // The GPU refused this file (unusual size, pixel format …) – do it in software.
      const output = await runFfmpeg(req, null, duration).catch((retryError: unknown) => {
        throw toConversionError(retryError, req);
      });
      req.onProgress?.({ percent: 100, stage: 'done' });
      return output;
    }
    throw toConversionError(error, req);
  }
}

function toConversionError(error: unknown, req: ConvertRequest): Error {
  if (req.signal?.aborted || isAbortError(error)) return abortError();
  if (error instanceof ConversionError) return error;
  if (error instanceof ProcessError) {
    const details = error.result.stderr.trim().slice(-2000) || error.message;
    if (error.reason === 'timeout')
      return new ConversionError('errors.convertFailed', `timeout: ${details}`);
    if (/Cannot allocate memory|Out of memory/i.test(details)) {
      return new ConversionError('errors.outOfMemory', details);
    }
    if (
      /does not contain any stream|Output file .* does not contain|matches no streams/i.test(
        details,
      )
    ) {
      return new ConversionError('errors.noMatchingStream', details);
    }
    return new ConversionError('errors.convertFailed', details);
  }
  return new ConversionError('errors.convertFailed', String(error));
}

const audioWrite = [...AUDIO_OUTPUTS];

export const ffmpegAudioEngine: Engine = {
  id: 'ffmpeg-audio',
  name: 'FFmpeg (Audio)',
  descriptionKey: 'engines.ffmpegAudio.description',
  category: 'audio',
  runtime: 'server',
  formats: support(AUDIO_IN, audioWrite),
  options: AUDIO_OPTIONS,
  supportsCompression: true,
  supportsTrim: true,
  priority: 10,
  init,
  status: () => status,
  convert,
};

export const ffmpegVideoEngine: Engine = {
  id: 'ffmpeg-video',
  name: 'FFmpeg (Video)',
  descriptionKey: 'engines.ffmpegVideo.description',
  category: 'video',
  runtime: 'server',
  // Reads videos, writes videos, GIF/WebP animations and the sound alone.
  formats: support(VIDEO_IN, [...VIDEO_OUTPUTS, ...ANIMATION_TARGETS, ...audioWrite]),
  // Burning in subtitles needs libass – only here, not in the browser.
  options: [...VIDEO_OPTIONS, ...BURN_SUBTITLE_OPTIONS, ...AUDIO_OPTIONS],
  supportsCompression: true,
  supportsTrim: true,
  priority: 10,
  init,
  status: () => status,
  convert,
};
