import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, open, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  ConversionError,
  VISUALIZER_INPUTS,
  VISUALIZER_OPTIONS,
  VISUALIZER_OUTPUTS,
  abortError,
  buildVisualizerArgs,
  lyricsAss,
  resolveVisualizer,
  getFormat,
  isAbortError,
  normalizeExt,
  parseProgressSeconds,
  type ConvertRequest,
  type Engine,
  type EngineStatus,
} from '@conbert/core';
import { decodeSubtitleText, parseSubtitles, subtitleFormatOf } from '@conbert/core/subtitles';
import { ProcessError, runProcess } from '../lib/run-process';
import { FFMPEG, probeDuration } from './ffmpeg';
import { whisperEngine } from './whisper';

/**
 * Audio → video (server, ffmpeg): music, podcasts or voice messages become a
 * video with a moving waveform and optionally a cover picture, so they can be
 * uploaded where only videos are allowed (YouTube, Instagram, TikTok …).
 */
const TIMEOUT_MS = 3 * 60 * 60 * 1000;

let status: EngineStatus = 'uninitialized';

/** The cover's real type from its first bytes – uploads are stored without an ending. */
async function coverType(file: string): Promise<string | null> {
  const handle = await open(file, 'r');
  try {
    const head = Buffer.alloc(16);
    await handle.read(head, 0, 16, 0);
    if (head[0] === 0x89 && head.toString('latin1', 1, 4) === 'PNG') return 'png';
    if (head[0] === 0xff && head[1] === 0xd8) return 'jpg';
    if (head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WEBP')
      return 'webp';
    if (head.toString('latin1', 0, 2) === 'BM') return 'bmp';
    return null;
  } finally {
    await handle.close();
  }
}

/**
 * The lyrics as an ASS file in the job folder: from the chosen file (LRC,
 * SRT, VTT, ASS – the type is read from the content) or recognised with
 * Whisper. Null when no lyrics are wanted.
 */
async function lyricsFile(
  req: ConvertRequest & { input: string; workDir: string },
  hasCover: boolean,
): Promise<string | null> {
  const { lyrics } = resolveVisualizer(req.options);
  if (lyrics === 'none') return null;
  let text: string;
  if (lyrics === 'file') {
    const chosen = req.attachments?.['vizLyricsFile'];
    if (!chosen) throw new ConversionError('errors.lyricsMissing', 'no lyrics file chosen');
    text = decodeSubtitleText(new Uint8Array(await readFile(chosen)));
  } else {
    await whisperEngine.init();
    if (whisperEngine.status() === 'error') {
      throw new ConversionError('errors.lyricsNoSpeech', 'whisper is not available');
    }
    // Speech recognition is the slow part: it gets the first half of the progress bar.
    const srt = await whisperEngine.convert({
      input: req.input,
      inputExt: req.inputExt,
      outputExt: 'srt',
      options: { speechLanguage: req.options['speechLanguage'] ?? 'auto' },
      workDir: req.workDir,
      ...(req.signal && { signal: req.signal }),
      onProgress: ({ percent }) =>
        req.onProgress?.({ percent: Math.round(percent / 2), stage: 'recognizing' }),
    });
    text = await readFile(String(srt), 'utf8');
  }
  const cues = parseSubtitles(text, subtitleFormatOf(text));
  if (cues.length === 0) throw new ConversionError('errors.lyricsEmpty', 'no timed lines found');
  const file = path.join(req.workDir, `${randomUUID()}.ass`);
  await writeFile(file, lyricsAss(cues, req.options, hasCover));
  return file;
}

async function convert(req: ConvertRequest): Promise<string> {
  if (req.signal?.aborted) throw abortError();
  if (typeof req.input !== 'string' || !req.workDir) {
    throw new ConversionError('errors.convertFailed', 'audio-video needs a file path and workDir');
  }
  const inputExt = normalizeExt(req.inputExt);
  const outputExt = normalizeExt(req.outputExt);
  await mkdir(req.workDir, { recursive: true });
  const output = path.join(req.workDir, `${randomUUID()}.${outputExt}`);

  // ffmpeg's picture reader goes by the file ending: give the cover a copy with the right one.
  let cover: string | null = null;
  const chosen = req.attachments?.['vizCover'];
  if (chosen) {
    const type = await coverType(chosen);
    if (!type) throw new ConversionError('errors.coverInvalid', 'cover is no PNG/JPEG/WebP/BMP');
    cover = path.join(req.workDir, `${randomUUID()}.${type}`);
    await copyFile(chosen, cover);
  }

  req.onProgress?.({ percent: 1, stage: 'converting' });
  const lyrics = await lyricsFile(
    { ...req, input: req.input, workDir: req.workDir },
    cover !== null,
  );
  // With recognised lyrics the video is the second half of the progress bar.
  const base = lyrics && resolveVisualizer(req.options).lyrics === 'auto' ? 50 : 0;
  const duration = await probeDuration(req.input, inputExt);
  const args = buildVisualizerArgs({
    input: req.input,
    inputExt,
    output,
    outputExt,
    options: req.options,
    cover,
    duration,
    lyrics,
  });
  try {
    await runProcess(FFMPEG, args, {
      timeoutMs: TIMEOUT_MS,
      signal: req.signal,
      onStdout: (chunk) => {
        const seconds = parseProgressSeconds(chunk);
        if (seconds !== null && duration) {
          req.onProgress?.({
            percent: Math.min(99, base + Math.round((seconds / duration) * (100 - base))),
            stage: 'converting',
          });
        }
      },
    });
  } catch (error) {
    if (req.signal?.aborted || isAbortError(error)) throw abortError();
    const details =
      error instanceof ProcessError
        ? error.result.stderr.trim().slice(-2000) || error.message
        : String(error);
    throw new ConversionError('errors.convertFailed', details);
  }
  req.onProgress?.({ percent: 100, stage: 'done' });
  return output;
}

export const audioVideoEngine: Engine = {
  id: 'audio-video',
  name: 'FFmpeg (Audio → Video)',
  descriptionKey: 'engines.audioVideo.description',
  category: 'audio',
  runtime: 'server',
  formats: [...new Set([...VISUALIZER_INPUTS, ...VISUALIZER_OUTPUTS])].map((ext) => ({
    ext,
    mime: getFormat(ext)?.mime ?? '',
    canRead: VISUALIZER_INPUTS.includes(ext),
    canWrite: VISUALIZER_OUTPUTS.includes(ext),
  })),
  options: VISUALIZER_OPTIONS,
  supportsCompression: false,
  // Audio → video is normally refused (it would be a video without picture); here it has one.
  extraTargets: [{ from: 'audio', to: 'video' }],
  priority: 5,
  async init() {
    try {
      await runProcess(FFMPEG, ['-hide_banner', '-version'], { timeoutMs: 10_000 });
      status = 'ready';
    } catch {
      status = 'error';
    }
  },
  status: () => status,
  convert,
};
