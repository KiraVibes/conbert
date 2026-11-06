import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  ConversionError,
  DEMUXER,
  GBA_MAX_ROM_BYTES,
  GBA_OPTIONS,
  abortError,
  getFormat,
  isAbortError,
  normalizeExt,
  resolveGbaSettings,
  type ConvertRequest,
  type Engine,
  type EngineStatus,
  type GbaSettings,
} from '@conbert/core';
import { ProcessError, lowerPriority, runProcess } from '../../lib/run-process';
import { FFMPEG, ffmpegVideoEngine, probeDuration } from '../ffmpeg';
import { GbaVideoEncoder } from './codec';
import { GbaRomTooLargeError, buildRom, romSize } from './rom';

/** Built by apps/server/gba-player in the Docker image. */
const PLAYER = process.env['CONBERT_GBA_PLAYER'] ?? '/opt/conbert/gba/player.gba';
const TIMEOUT_MS = 2 * 60 * 60 * 1000;
/** New palette + keyframe at the latest every 8 seconds. */
const MAX_GROUP_SECONDS = 8;
const READ = ['mp4', 'webm', 'mkv', 'mov', 'avi', 'wmv', 'mpg', 'gif'];

/**
 * Rough bytes per frame (after compression) for typical videos – only used to
 * refuse clearly too long videos before spending minutes on them.
 */
const TYPICAL_FRAME_BYTES = { sharp: 9000, balanced: 4500, long: 2200 } as const;

let status: EngineStatus = 'uninitialized';
let initPromise: Promise<void> | null = null;

function init(): Promise<void> {
  initPromise ??= (async () => {
    status = 'loading';
    await ffmpegVideoEngine.init();
    try {
      await access(PLAYER);
      status = ffmpegVideoEngine.status() === 'ready' ? 'ready' : 'error';
    } catch {
      // Player not built (e.g. local development without devkitARM).
      status = 'error';
    }
  })();
  return initPromise;
}

const tooLong = (details: string) => new ConversionError('errors.gbaTooLong', details);

/** Typical module size for a video of this length – deliberately generous. */
export function estimateRomBytes(settings: GbaSettings, seconds: number): number {
  const video = seconds * settings.fps * TYPICAL_FRAME_BYTES[settings.quality];
  const audio = settings.withAudio ? seconds * settings.audioRate : 0;
  return video + audio;
}

function inputArgs(input: string, inputExt: string): string[] {
  const demuxer = DEMUXER[inputExt];
  return [
    '-hide_banner',
    '-nostdin',
    '-v',
    'error',
    '-protocol_whitelist',
    'file',
    ...(demuxer ? ['-f', demuxer] : []),
    '-i',
    input,
  ];
}

/** The sound as signed 8-bit mono, or null if the video has none. */
async function extractAudio(
  req: ConvertRequest & { input: string; workDir: string },
  inputExt: string,
  settings: GbaSettings,
): Promise<Uint8Array | null> {
  if (!settings.withAudio) return null;
  const output = path.join(req.workDir, `${randomUUID()}.s8`);
  try {
    await runProcess(
      FFMPEG,
      [
        ...inputArgs(req.input, inputExt),
        '-vn',
        '-ac',
        '1',
        '-ar',
        String(settings.audioRate),
        // A little louder: the GBA speaker is quiet and 8 bits are coarse.
        '-af',
        'dynaudnorm=f=150:g=15',
        '-f',
        's8',
        output,
      ],
      { timeoutMs: TIMEOUT_MS, signal: req.signal },
    );
    const data = new Uint8Array(await readFile(output));
    return data.length > 0 ? data : null;
  } catch (error) {
    if (req.signal?.aborted || isAbortError(error)) throw abortError();
    const stderr = error instanceof ProcessError ? error.result.stderr : '';
    // No sound track: a silent module.
    if (
      /does not contain any stream|matches no streams|Output file .* does not contain/i.test(stderr)
    ) {
      return null;
    }
    throw error;
  } finally {
    await rm(output, { force: true });
  }
}

/** Streams RGB24 frames from ffmpeg into the callback. */
function streamFrames(
  req: ConvertRequest & { input: string },
  inputExt: string,
  settings: GbaSettings,
  onFrame: (frame: Uint8Array) => void,
): Promise<void> {
  const { width, height, fps } = settings;
  const frameBytes = width * height * 3;
  const filter =
    `fps=${fps},scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=area,` +
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,format=rgb24`;
  const args = [
    ...inputArgs(req.input, inputExt),
    '-an',
    '-vf',
    filter,
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgb24',
    'pipe:1',
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG, args, {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    lowerPriority(child);
    let pending: Buffer = Buffer.alloc(0);
    let stderr = '';
    let failed: unknown = null;
    const fail = (error: unknown) => {
      if (failed) return;
      failed = error;
      child.kill('SIGKILL');
    };
    const timer = setTimeout(
      () => fail(new ConversionError('errors.convertFailed', 'timeout')),
      TIMEOUT_MS,
    );
    const onAbort = () => fail(abortError());
    req.signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout.on('data', (chunk: Buffer) => {
      if (failed) return;
      pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
      try {
        while (pending.length >= frameBytes) {
          onFrame(new Uint8Array(pending.subarray(0, frameBytes)));
          pending = pending.subarray(frameBytes);
        }
      } catch (error) {
        fail(error);
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-8000);
    });
    child.on('error', (error) => fail(error));
    child.on('close', (code) => {
      clearTimeout(timer);
      req.signal?.removeEventListener('abort', onAbort);
      if (failed) reject(failed);
      else if (code !== 0)
        reject(
          new ConversionError(
            'errors.convertFailed',
            stderr.trim() || `ffmpeg exited with ${code}`,
          ),
        );
      else resolve();
    });
  });
}

async function convert(req: ConvertRequest): Promise<string> {
  if (req.signal?.aborted) throw abortError();
  if (typeof req.input !== 'string' || !req.workDir) {
    throw new ConversionError('errors.convertFailed', 'gba needs a file path and workDir');
  }
  await init();
  if (status !== 'ready') {
    throw new ConversionError('errors.formatUnavailable', 'ffmpeg or the GBA player is missing');
  }
  const input = req.input;
  const workDir = req.workDir;
  const job = { ...req, input, workDir };
  const inputExt = normalizeExt(req.inputExt);
  const settings = resolveGbaSettings(req.options);
  await mkdir(workDir, { recursive: true });

  const duration = await probeDuration(input, inputExt);
  if (duration && estimateRomBytes(settings, duration) > GBA_MAX_ROM_BYTES * 1.5) {
    throw tooLong(
      `estimated ${Math.round(estimateRomBytes(settings, duration) / 1e6)} MB for ${Math.round(duration)} s`,
    );
  }

  try {
    req.onProgress?.({ percent: 2, stage: 'converting' });
    const [player, audio] = await Promise.all([
      readFile(PLAYER).then((b) => new Uint8Array(b)),
      extractAudio(job, inputExt, settings),
    ]);
    const audioBytes = audio?.length ?? 0;
    const encoder = new GbaVideoEncoder({
      width: settings.width,
      height: settings.height,
      blockThreshold: settings.blockThreshold,
      maxGroupFrames: settings.fps * MAX_GROUP_SECONDS,
    });
    const records: Uint8Array[] = [];
    let recordBytes = 0;
    let keyframes = 0;
    let frames = 0;
    const expectedFrames = duration ? Math.ceil(duration * settings.fps) : 0;
    const take = (list: Uint8Array[]) => {
      for (const r of list) {
        records.push(r);
        recordBytes += r.length;
        if (r[4] === 1) keyframes++;
      }
      const size = romSize(player.length, recordBytes, audioBytes, keyframes);
      if (size > GBA_MAX_ROM_BYTES)
        throw tooLong(`more than ${GBA_MAX_ROM_BYTES} bytes after ${frames} frames`);
    };

    await streamFrames(job, inputExt, settings, (frame) => {
      take(encoder.push(frame));
      frames++;
      if (expectedFrames > 0 && frames % 15 === 0) {
        req.onProgress?.({
          percent: 5 + Math.min(90, Math.round((frames / expectedFrames) * 90)),
          stage: 'converting',
        });
      }
    });
    take(encoder.finish());
    if (records.length === 0)
      throw new ConversionError('errors.noMatchingStream', 'no video frames');

    const title = typeof req.options['title'] === 'string' ? req.options['title'] : 'Conbert';
    const rom = buildRom({
      player,
      width: settings.width,
      height: settings.height,
      fps: settings.fps,
      audioRate: settings.audioRate,
      audioTimerSteps: settings.audioTimerSteps,
      audio,
      records,
      title,
      loop: settings.loop,
    });
    const output = path.join(workDir, `${randomUUID()}.gba`);
    await writeFile(output, rom);
    req.onProgress?.({ percent: 100, stage: 'done' });
    return output;
  } catch (error) {
    if (req.signal?.aborted || isAbortError(error)) throw abortError();
    if (error instanceof ConversionError) throw error;
    if (error instanceof GbaRomTooLargeError) throw tooLong(error.message);
    const details =
      error instanceof ProcessError
        ? error.result.stderr.trim().slice(-2000) || error.message
        : String(error);
    throw new ConversionError('errors.convertFailed', details);
  }
}

export const gbaVideoEngine: Engine = {
  id: 'gba-video',
  name: 'GBA-Video',
  descriptionKey: 'engines.gbaVideo.description',
  category: 'video',
  runtime: 'server',
  formats: [
    ...READ.map((ext) => ({
      ext,
      mime: getFormat(ext)?.mime ?? '',
      canRead: true,
      canWrite: false,
    })),
    { ext: 'gba', mime: getFormat('gba')?.mime ?? '', canRead: false, canWrite: true },
  ],
  options: GBA_OPTIONS,
  supportsCompression: false,
  priority: 10,
  init,
  status: () => status,
  convert,
};
