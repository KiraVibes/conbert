import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  ConversionError,
  DEMUXER,
  SUBTITLE_EXTRACT_OPTIONS,
  SUBTITLE_VIDEO_READ,
  SUBTITLE_VIDEO_WRITE,
  WHISPER_OPTIONS,
  abortError,
  getFormat,
  isAbortError,
  normalizeExt,
  resolveSubtitleSource,
  type ConvertRequest,
  type Engine,
  type FormatSupport,
} from '@conbert/core';
import { convertSubtitles } from '@conbert/core/subtitles';
import { ProcessError, runProcess } from '../lib/run-process';
import { FFMPEG, ffmpegVideoEngine } from './ffmpeg';
import { subtitleTracks, type SubtitleTrack as Track } from './ffmpeg/subtitle-tracks';
import { whisperEngine } from './whisper';

/**
 * Subtitles from videos. "Automatic" takes the subtitles built into the video
 * (a subtitle track, e.g. in MKV or MP4) and, if there are none, has Whisper
 * write them from the spoken words. Cutting a part out goes to Whisper alone
 * (this engine doesn't do trimming, so the router picks Whisper then).
 */

const TIMEOUT_MS = 30 * 60 * 1000;

function details(error: unknown): string {
  return error instanceof ProcessError
    ? `${error.result.stderr}\n${error.result.stdout}`.trim().slice(-2000) || error.message
    : error instanceof Error
      ? error.message
      : String(error);
}

function inputArgs(input: string, ext: string): string[] {
  const demuxer = DEMUXER[ext];
  return ['-protocol_whitelist', 'file', ...(demuxer ? ['-f', demuxer] : []), '-i', input];
}

/** Which track to take, or null for "recognise the speech". */
function chooseTrack(tracks: Track[], options: Record<string, unknown>): number | null {
  const { source, track } = resolveSubtitleSource(options);
  if (source === 'speech') return null;
  const wanted = tracks[track];
  if (source === 'track') {
    if (!wanted) {
      throw new ConversionError(
        'errors.subtitlesNoTrack',
        `${tracks.length} subtitle track(s), wanted #${track + 1}`,
      );
    }
    if (!wanted.text) throw new ConversionError('errors.subtitlesImageTrack', wanted.codec);
    return track;
  }
  // Automatic: the chosen track if it is text, else the first text track.
  if (wanted?.text) return track;
  const first = tracks.findIndex((t) => t.text);
  return first >= 0 ? first : null;
}

async function extractTrack(
  req: ConvertRequest & { input: string; workDir: string },
  track: Track & { index: number },
  to: string,
): Promise<string> {
  const from = normalizeExt(req.inputExt);
  // ASS tracks come out as ASS (ffmpeg would turn their drawings into text);
  // everything else as SRT. Conbert's own code does the rest.
  const asAss = track.codec === 'ass' || track.codec === 'ssa' || to === 'ass';
  const rawExt = asAss ? 'ass' : 'srt';
  const raw = path.join(req.workDir, `${randomUUID()}.${rawExt}`);
  try {
    await runProcess(
      FFMPEG,
      [
        '-hide_banner',
        '-nostdin',
        '-y',
        '-loglevel',
        'error',
        ...inputArgs(req.input, from),
        '-map',
        `0:s:${track.index}`,
        '-c:s',
        rawExt,
        '-f',
        rawExt,
        raw,
      ],
      { timeoutMs: TIMEOUT_MS, ...(req.signal && { signal: req.signal }) },
    );
  } catch (error) {
    if (req.signal?.aborted || isAbortError(error)) throw abortError();
    throw new ConversionError('errors.subtitlesExtractFailed', details(error));
  }
  // An ASS track to ASS keeps its whole look untouched.
  if (to === rawExt) return raw;
  const output = path.join(req.workDir, `${randomUUID()}.${to}`);
  await writeFile(output, convertSubtitles(new Uint8Array(await readFile(raw)), rawExt, to, {}));
  return output;
}

async function fromSpeech(
  req: ConvertRequest & { input: string; workDir: string },
  to: string,
): Promise<string> {
  // Whisper writes SRT, VTT and TXT; ASS is made from its SRT.
  const transcript = await whisperEngine.convert({ ...req, outputExt: to === 'ass' ? 'srt' : to });
  if (to !== 'ass') return String(transcript);
  const output = path.join(req.workDir, `${randomUUID()}.ass`);
  const srt = new Uint8Array(await readFile(String(transcript)));
  await writeFile(output, convertSubtitles(srt, 'srt', 'ass', {}));
  return output;
}

async function convert(req: ConvertRequest): Promise<string> {
  if (req.signal?.aborted) throw abortError();
  if (typeof req.input !== 'string' || !req.workDir) {
    throw new ConversionError('errors.convertFailed', 'subtitles need a file path and workDir');
  }
  const to = normalizeExt(req.outputExt);
  if (!SUBTITLE_VIDEO_WRITE.includes(to)) {
    throw new ConversionError('errors.formatUnavailable', `subtitles: can't write .${to}`);
  }
  const job = { ...req, input: req.input, workDir: req.workDir };
  await mkdir(req.workDir, { recursive: true });
  req.onProgress?.({ percent: 2, stage: 'reading' });
  let tracks: Track[];
  try {
    tracks = await subtitleTracks(req.input, normalizeExt(req.inputExt));
  } catch (error) {
    throw new ConversionError('errors.convertFailed', details(error));
  }
  const track = chooseTrack(tracks, req.options);
  const chosen = track === null ? undefined : tracks[track];
  const result = chosen
    ? await extractTrack(job, { ...chosen, index: track ?? 0 }, to)
    : await fromSpeech(job, to);
  req.onProgress?.({ percent: 100, stage: 'done' });
  return result;
}

export const subtitleExtractEngine: Engine = {
  id: 'subtitle-extract',
  name: 'Untertitel aus Videos',
  descriptionKey: 'engines.subtitleExtract.description',
  category: 'video',
  runtime: 'server',
  formats: [
    ...SUBTITLE_VIDEO_READ.map((ext): FormatSupport => ({
      ext,
      mime: getFormat(ext)?.mime ?? '',
      canRead: true,
      canWrite: false,
    })),
    ...SUBTITLE_VIDEO_WRITE.map((ext): FormatSupport => ({
      ext,
      mime: getFormat(ext)?.mime ?? '',
      canRead: false,
      canWrite: true,
    })),
  ],
  // Whisper's settings count when the speech is recognised.
  options: [...SUBTITLE_EXTRACT_OPTIONS, ...WHISPER_OPTIONS],
  supportsCompression: false,
  // Above Whisper (10): videos look for built-in subtitles first.
  priority: 12,
  init: () => ffmpegVideoEngine.init(),
  status: () => ffmpegVideoEngine.status(),
  convert,
};
