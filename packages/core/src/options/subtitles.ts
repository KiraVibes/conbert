import type { EngineOption } from '../engine';

/**
 * Subtitles: converting between SRT, WebVTT and ASS (browser + server), and
 * taking them out of videos (server: built-in subtitle track or, if there is
 * none, recognising the speech with Whisper).
 */

/** Subtitle files that can be read (.ssa, the older form of ASS, counts as ASS). */
export const SUBTITLE_READ = ['srt', 'vtt', 'ass', 'lrc'];
/** What subtitles can become – TXT is only the words. */
export const SUBTITLE_WRITE = ['srt', 'vtt', 'ass', 'txt'];
/** Targets with times (TXT has none). */
const TIMED = ['srt', 'vtt', 'ass'];

/** Largest shift: five minutes either way. */
const MAX_SHIFT_SECONDS = 300;

export const SUBTITLE_OPTIONS: EngineOption[] = [
  {
    key: 'subtitleShift',
    labelKey: 'options.subtitleShift.label',
    helpKey: 'options.subtitleShift.help',
    effectKey: 'options.subtitleShift.effect',
    advanced: true,
    type: 'number',
    default: 0,
    min: -MAX_SHIFT_SECONDS,
    max: MAX_SHIFT_SECONDS,
    step: 0.1,
    appliesTo: TIMED,
  },
];

export function resolveSubtitleOptions(raw: Record<string, unknown>): { shiftMs: number } {
  const value = Number(raw['subtitleShift'] ?? 0);
  const seconds = Number.isFinite(value)
    ? Math.min(MAX_SHIFT_SECONDS, Math.max(-MAX_SHIFT_SECONDS, value))
    : 0;
  return { shiftMs: Math.round(seconds * 1000) };
}

// --- Subtitles from videos ---------------------------------------------------

export const SUBTITLE_SOURCES = ['auto', 'track', 'speech'] as const;
export type SubtitleSource = (typeof SUBTITLE_SOURCES)[number];

/** Videos the server can take subtitles from. */
export const SUBTITLE_VIDEO_READ = ['mkv', 'mp4', 'mov', 'webm', 'avi', 'wmv', 'mpg'];
export const SUBTITLE_VIDEO_WRITE = ['srt', 'vtt', 'ass', 'txt'];

export const SUBTITLE_EXTRACT_OPTIONS: EngineOption[] = [
  {
    key: 'subtitleSource',
    labelKey: 'options.subtitleSource.label',
    helpKey: 'options.subtitleSource.help',
    advanced: false,
    type: 'select',
    default: 'auto',
    choices: SUBTITLE_SOURCES.map((value) => ({
      value,
      labelKey: `options.subtitleSource.${value}`,
      helpKey: `options.subtitleSource.${value}Help`,
    })),
    appliesTo: SUBTITLE_VIDEO_WRITE,
  },
  {
    key: 'subtitleTrack',
    labelKey: 'options.subtitleTrack.label',
    helpKey: 'options.subtitleTrack.help',
    advanced: true,
    type: 'number',
    default: 1,
    min: 1,
    max: 50,
    step: 1,
    appliesTo: SUBTITLE_VIDEO_WRITE,
  },
];

export function resolveSubtitleSource(raw: Record<string, unknown>): {
  source: SubtitleSource;
  /** 0-based among the subtitle tracks. */
  track: number;
} {
  const source = SUBTITLE_SOURCES.find((s) => s === raw['subtitleSource']) ?? 'auto';
  const track = Math.round(Number(raw['subtitleTrack'] ?? 1));
  return { source, track: Number.isFinite(track) && track >= 1 ? Math.min(track, 50) - 1 : 0 };
}

/** ffprobe codec names of subtitles that are text (pictures like Blu-ray PGS are not). */
export const TEXT_SUBTITLE_CODECS = [
  'subrip',
  'srt',
  'ass',
  'ssa',
  'webvtt',
  'mov_text',
  'text',
  'microdvd',
  'subviewer',
  'subviewer1',
  'sami',
  'realtext',
  'stl',
  'jacosub',
  'mpl2',
  'pjs',
  'vplayer',
  'eia_608',
];

// --- Burning subtitles into the picture (server, ffmpeg + libass) -----------

/** Video targets the subtitles can be burnt into (same list as ffmpeg's video outputs). */
const BURN_TARGETS = ['mp4', 'webm', 'mkv', 'mov', 'avi', 'wmv', 'mpg'];

export const BURN_SUBTITLE_OPTIONS: EngineOption[] = [
  {
    key: 'burnSubtitles',
    labelKey: 'options.burnSubtitles.label',
    helpKey: 'options.burnSubtitles.help',
    effectKey: 'options.burnSubtitles.effect',
    advanced: true,
    type: 'boolean',
    default: false,
    appliesTo: BURN_TARGETS,
  },
  {
    key: 'burnSubtitleFile',
    labelKey: 'options.burnSubtitleFile.label',
    helpKey: 'options.burnSubtitleFile.help',
    advanced: true,
    type: 'file',
    default: null,
    accept: ['srt', 'vtt', 'ass'],
    appliesTo: BURN_TARGETS,
  },
  {
    key: 'burnSubtitleTrack',
    labelKey: 'options.burnSubtitleTrack.label',
    helpKey: 'options.burnSubtitleTrack.help',
    advanced: true,
    type: 'number',
    default: 1,
    min: 1,
    max: 50,
    step: 1,
    appliesTo: BURN_TARGETS,
  },
];

/** Which subtitle track to burn in (0-based), or null for none. */
export function resolveBurnSubtitles(raw: Record<string, unknown>): { track: number } | null {
  if (raw['burnSubtitles'] !== true) return null;
  const track = Math.round(Number(raw['burnSubtitleTrack'] ?? 1));
  return { track: Number.isFinite(track) && track >= 1 ? Math.min(track, 50) - 1 : 0 };
}
