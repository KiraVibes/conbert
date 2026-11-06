import { DEMUXER, TEXT_SUBTITLE_CODECS } from '@conbert/core';
import { runProcess } from '../../lib/run-process';

const FFPROBE = process.env['CONBERT_FFPROBE_PATH'] ?? 'ffprobe';

export interface SubtitleTrack {
  codec: string;
  /** Text (SRT, ASS, WebVTT …) – false for pictures (DVD, Blu-ray). */
  text: boolean;
}

/** The subtitle tracks of a video, in order. */
export async function subtitleTracks(input: string, ext: string): Promise<SubtitleTrack[]> {
  const demuxer = DEMUXER[ext];
  const { stdout } = await runProcess(
    FFPROBE,
    [
      '-v',
      'error',
      '-protocol_whitelist',
      'file',
      ...(demuxer ? ['-f', demuxer] : []),
      '-select_streams',
      's',
      '-show_entries',
      'stream=codec_name',
      '-of',
      'json',
      input,
    ],
    { timeoutMs: 60_000 },
  );
  const streams = (JSON.parse(stdout || '{}') as { streams?: { codec_name?: string }[] }).streams;
  return (streams ?? []).map((s) => {
    const codec = s.codec_name ?? 'unknown';
    return { codec, text: TEXT_SUBTITLE_CODECS.includes(codec) };
  });
}
