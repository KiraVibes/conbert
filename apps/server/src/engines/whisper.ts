import { randomUUID } from 'node:crypto';
import { mkdir, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  ConversionError,
  DEMUXER,
  TRANSCRIPT_FORMATS,
  WHISPER_OPTIONS,
  abortError,
  getFormat,
  isAbortError,
  normalizeExt,
  parseWhisperProgress,
  readTrim,
  resolveWhisper,
  whisperArgs,
  type ConvertRequest,
  type Engine,
  type EngineStatus,
  type FormatSupport,
} from '@conbert/core';
import { ProcessError, runProcess } from '../lib/run-process';
import { whisperSetup } from '../whisper/setup';

/**
 * Speech to text with whisper.cpp: ffmpeg turns the sound (also of a video)
 * into 16 kHz mono WAV, whisper-cli writes subtitles (SRT/VTT) or plain text.
 * The model is downloaded on first use (see whisper/models.ts).
 */
const WHISPER = process.env['CONBERT_WHISPER_PATH'] ?? 'whisper-cli';
const FFMPEG = process.env['CONBERT_FFMPEG_PATH'] ?? 'ffmpeg';
/** Long recordings on a small CPU take a while. */
const TIMEOUT_MS = 4 * 60 * 60 * 1000;
const THREADS = Math.min(8, os.availableParallelism());

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
];

let status: EngineStatus = 'uninitialized';

function details(error: unknown): string {
  return error instanceof ProcessError
    ? `${error.result.stderr}\n${error.result.stdout}`.trim().slice(-2000) || error.message
    : error instanceof Error
      ? error.message
      : String(error);
}

/** Sound as 16 kHz mono WAV – the only input whisper.cpp takes. */
async function extractSound(req: ConvertRequest & { input: string }, wav: string) {
  const from = normalizeExt(req.inputExt);
  const demuxer = DEMUXER[from];
  const trim = readTrim(req.options);
  const args = ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error'];
  if (trim?.start) args.push('-ss', String(trim.start));
  args.push('-protocol_whitelist', 'file', ...(demuxer ? ['-f', demuxer] : []), '-i', req.input);
  if (trim?.end) args.push('-t', String(trim.end - trim.start));
  args.push('-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-f', 'wav', wav);
  try {
    await runProcess(FFMPEG, args, { timeoutMs: TIMEOUT_MS, signal: req.signal });
  } catch (error) {
    if (req.signal?.aborted || isAbortError(error)) throw abortError();
    const text = details(error);
    throw new ConversionError(
      /does not contain any stream|matches no streams|no audio/i.test(text)
        ? 'errors.noMatchingStream'
        : 'errors.convertFailed',
      text,
    );
  }
}

async function convert(req: ConvertRequest): Promise<string> {
  if (req.signal?.aborted) throw abortError();
  if (typeof req.input !== 'string' || !req.workDir) {
    throw new ConversionError('errors.whisperFailed', 'whisper needs a file path and workDir');
  }
  const to = normalizeExt(req.outputExt);
  const outputExt = TRANSCRIPT_FORMATS.find((f) => f === to);
  if (!outputExt)
    throw new ConversionError('errors.formatUnavailable', `whisper can't write .${to}`);
  const input = req.input;
  await mkdir(req.workDir, { recursive: true });
  const { models, defaultModel } = whisperSetup();

  // 1. The model (downloaded once, the first time anyone needs it).
  req.onProgress?.({ percent: 1, stage: 'downloadingModel' });
  const model = await models.ensure(
    defaultModel(),
    (received, total) =>
      req.onProgress?.({
        percent: Math.round((received / total) * 30),
        stage: 'downloadingModel',
      }),
    req.signal,
  );

  // 2. Sound as WAV.
  req.onProgress?.({ percent: 31, stage: 'reading' });
  const wav = path.join(req.workDir, `${randomUUID()}.wav`);
  await extractSound({ ...req, input }, wav);

  // 3. Listen and write.
  req.onProgress?.({ percent: 35, stage: 'transcribing' });
  const outputBase = path.join(req.workDir, randomUUID());
  const onOutput = (chunk: string) => {
    const percent = parseWhisperProgress(chunk);
    if (percent !== null) {
      req.onProgress?.({ percent: 35 + Math.round(percent * 0.64), stage: 'transcribing' });
    }
  };
  try {
    await runProcess(
      WHISPER,
      whisperArgs({
        model,
        input: wav,
        outputBase,
        outputExt,
        settings: resolveWhisper(req.options),
        threads: THREADS,
      }),
      { timeoutMs: TIMEOUT_MS, signal: req.signal, onStdout: onOutput, onStderr: onOutput },
    );
  } catch (error) {
    if (req.signal?.aborted || isAbortError(error)) throw abortError();
    throw new ConversionError('errors.whisperFailed', details(error));
  }
  const output = `${outputBase}.${outputExt}`;
  const size = await stat(output)
    .then((s) => s.size)
    .catch(() => 0);
  // Whisper marks silence and music as [BLANK_AUDIO], (Musik) … – that is no speech.
  const text =
    size > 0
      ? (await readFile(output, 'utf8'))
          .replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*|WEBVTT/g, '')
          .replace(/[\s\d:.,>-]/g, '')
      : '';
  if (!text) throw new ConversionError('errors.noSpeech');
  req.onProgress?.({ percent: 100, stage: 'done' });
  return output;
}

export const whisperEngine: Engine = {
  id: 'whisper',
  name: 'Whisper (whisper.cpp)',
  descriptionKey: 'engines.whisper.description',
  category: 'audio',
  runtime: 'server',
  formats: [
    ...READ.map((ext): FormatSupport => ({
      ext,
      mime: getFormat(ext)?.mime ?? '',
      canRead: true,
      canWrite: false,
    })),
    ...TRANSCRIPT_FORMATS.map((ext): FormatSupport => ({
      ext,
      mime: getFormat(ext)?.mime ?? '',
      canRead: false,
      canWrite: true,
    })),
  ],
  options: WHISPER_OPTIONS,
  supportsCompression: false,
  // Only a part of a long recording can be transcribed (trim.ts).
  supportsTrim: true,
  priority: 10,
  async init() {
    try {
      await runProcess(WHISPER, ['--help'], { timeoutMs: 20_000 });
      await runProcess(FFMPEG, ['-version'], { timeoutMs: 10_000 });
      status = 'ready';
    } catch {
      status = 'error';
    }
  },
  status: () => status,
  convert,
};
