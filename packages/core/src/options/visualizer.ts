import type { EngineOption } from '../engine';
import { DEMUXER, filterPath } from '../ffmpeg-args';
import type { Cue } from '../subtitles/convert';
import { WHISPER_OPTIONS } from './whisper';

/**
 * Audio → video: a sound file becomes a video with a moving waveform,
 * frequency bars or a scrolling spectrum, optionally over a cover picture –
 * for uploading music, podcasts or voice messages to YouTube, Instagram & co.
 * (ffmpeg's showwaves / showfreqs / showspectrum filters, server only).
 */

export const VISUALIZER_STYLES = ['wave', 'bars', 'spectrum', 'still'] as const;
export type VisualizerStyle = (typeof VISUALIZER_STYLES)[number];

export const VISUALIZER_COLORS = ['violet', 'white', 'cyan', 'orange', 'green'] as const;
export type VisualizerColor = (typeof VISUALIZER_COLORS)[number];

export const VISUALIZER_SIZES = ['landscape720', 'landscape1080', 'square', 'portrait'] as const;
export type VisualizerSize = (typeof VISUALIZER_SIZES)[number];

const COLOR_HEX: Record<VisualizerColor, string> = {
  violet: '0xa78bfa',
  white: '0xffffff',
  cyan: '0x22d3ee',
  orange: '0xfb923c',
  green: '0x4ade80',
};

const SIZE_PX: Record<VisualizerSize, [number, number]> = {
  landscape720: [1280, 720],
  landscape1080: [1920, 1080],
  square: [1080, 1080],
  portrait: [1080, 1920],
};

export const VISUALIZER_INPUTS = ['mp3', 'wav', 'flac', 'ogg', 'opus', 'm4a', 'aac', 'aiff', 'wma'];
export const VISUALIZER_OUTPUTS = ['mp4', 'webm', 'mov', 'mkv'];
export const VISUALIZER_COVER_TYPES = ['jpg', 'jpeg', 'png', 'webp', 'bmp'];

/** Where the lyrics come from: none, a file with times (LRC, SRT …) or speech recognition. */
export const LYRICS_SOURCES = ['none', 'file', 'auto'] as const;
export type LyricsSource = (typeof LYRICS_SOURCES)[number];
export const LYRICS_FILE_TYPES = ['lrc', 'srt', 'vtt', 'ass'];

const speechLanguage = WHISPER_OPTIONS.find((o) => o.key === 'speechLanguage');

export const VISUALIZER_OPTIONS: EngineOption[] = [
  {
    key: 'vizStyle',
    labelKey: 'options.vizStyle.label',
    helpKey: 'options.vizStyle.help',
    advanced: false,
    type: 'select',
    default: 'wave',
    choices: VISUALIZER_STYLES.map((value) => ({
      value,
      labelKey: `options.vizStyle.choices.${value}`,
      helpKey: `options.vizStyle.choiceHelp.${value}`,
    })),
  },
  {
    key: 'vizCover',
    labelKey: 'options.vizCover.label',
    helpKey: 'options.vizCover.help',
    advanced: false,
    type: 'file',
    default: null,
    accept: VISUALIZER_COVER_TYPES,
  },
  {
    key: 'vizSize',
    labelKey: 'options.vizSize.label',
    helpKey: 'options.vizSize.help',
    advanced: false,
    type: 'select',
    default: 'landscape720',
    choices: VISUALIZER_SIZES.map((value) => ({
      value,
      labelKey: `options.vizSize.choices.${value}`,
    })),
  },
  {
    key: 'vizColor',
    labelKey: 'options.vizColor.label',
    helpKey: 'options.vizColor.help',
    advanced: false,
    type: 'select',
    default: 'violet',
    choices: VISUALIZER_COLORS.map((value) => ({
      value,
      labelKey: `options.vizColor.choices.${value}`,
    })),
  },
  {
    key: 'vizLyrics',
    labelKey: 'options.vizLyrics.label',
    helpKey: 'options.vizLyrics.help',
    advanced: false,
    type: 'select',
    default: 'none',
    choices: LYRICS_SOURCES.map((value) => ({
      value,
      labelKey: `options.vizLyrics.choices.${value}`,
      helpKey: `options.vizLyrics.choiceHelp.${value}`,
    })),
  },
  {
    key: 'vizLyricsFile',
    labelKey: 'options.vizLyricsFile.label',
    helpKey: 'options.vizLyricsFile.help',
    advanced: false,
    type: 'file',
    default: null,
    accept: LYRICS_FILE_TYPES,
  },
  // The language for "recognise automatically" (same choices as speech recognition).
  ...(speechLanguage ? [{ ...speechLanguage, advanced: true, appliesTo: undefined }] : []),
];

export interface VisualizerSettings {
  style: VisualizerStyle;
  color: VisualizerColor;
  size: VisualizerSize;
  lyrics: LyricsSource;
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

export function resolveVisualizer(raw: Record<string, unknown>): VisualizerSettings {
  return {
    style: pick(raw['vizStyle'], VISUALIZER_STYLES, 'wave'),
    color: pick(raw['vizColor'], VISUALIZER_COLORS, 'violet'),
    size: pick(raw['vizSize'], VISUALIZER_SIZES, 'landscape720'),
    lyrics: pick(raw['vizLyrics'], LYRICS_SOURCES, 'none'),
  };
}

export interface VisualizerLayout {
  /** Side of the box the sharp cover fits into, and its top edge. */
  art: number;
  artTop: number;
  /** Height and top edge of the waveform band. */
  bandH: number;
  bandY: number;
  /** Where the middle of a lyrics line sits (pixels from the top). */
  lyricsY: number;
  fontSize: number;
}

/**
 * Where everything goes. With lyrics the cover gets smaller and moves up, so
 * the text fits between cover and waveform.
 */
export function visualizerLayout(
  style: VisualizerStyle,
  w: number,
  h: number,
  hasCover: boolean,
  hasLyrics: boolean,
): VisualizerLayout {
  const short = Math.min(w, h);
  const fontSize = Math.round(short * 0.06);
  if (style === 'still') {
    const art = Math.round(short * (hasLyrics ? 0.6 : 0.8));
    const artTop = Math.round((h - art) / 2 - (hasLyrics ? h * 0.08 : 0));
    const lyricsY = hasCover ? Math.round((artTop + art + h) / 2) : Math.round(h / 2);
    return { art, artTop, bandH: 0, bandY: h, lyricsY, fontSize };
  }
  const bandH = Math.round((h * (style === 'spectrum' ? 0.3 : 0.25)) / 2) * 2;
  const bandY = h - bandH - Math.round(h * 0.06);
  const art = Math.round(short * (hasLyrics ? 0.42 : 0.55));
  const artTop = Math.round((h - art) / 2 - h * (hasLyrics ? 0.14 : 0.1));
  const lyricsY = hasCover ? Math.round((artTop + art + bandY) / 2) : Math.round(bandY / 2);
  return { art, artTop, bandH, bandY, lyricsY, fontSize };
}

function assTime(ms: number): string {
  const cs = Math.round(ms / 10);
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const sec = Math.floor((cs % 6000) / 100);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${h}:${p(m)}:${p(sec)}.${p(cs % 100)}`;
}

/**
 * The lyrics as an ASS file for this video: big white letters with a dark
 * outline, one line at a time, centred between cover and waveform.
 */
export function lyricsAss(
  cues: readonly Cue[],
  options: Record<string, unknown>,
  hasCover: boolean,
): string {
  const { style, size } = resolveVisualizer(options);
  const [w, h] = SIZE_PX[size];
  const layout = visualizerLayout(style, w, h, hasCover, true);
  const margin = Math.round(w * 0.06);
  const outline = Math.max(2, Math.round(layout.fontSize / 14));
  const header = [
    '[Script Info]',
    '; Lyrics made with Conbert',
    'ScriptType: v4.00+',
    `PlayResX: ${w}`,
    `PlayResY: ${h}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Lyrics,DejaVu Sans,${layout.fontSize},&H00FFFFFF,&H00FFFFFF,&H00101010,&H80000000,1,0,0,0,100,100,0,0,1,${outline},1,5,${margin},${margin},0,1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  const lines = cues.map((c) => {
    const text = c.text
      .replace(/<\/?[ibu]>/g, '')
      .replace(/[{}\\]/g, '')
      .replace(/\r?\n/g, '\\N');
    const pos = `{\\fad(150,150)\\pos(${Math.round(w / 2)},${layout.lyricsY})}`;
    return `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Lyrics,,0,0,0,,${pos}${text}`;
  });
  return `${header.join('\n')}\n${lines.join('\n')}\n`;
}

export interface VisualizerArgsRequest {
  input: string;
  inputExt: string;
  output: string;
  outputExt: string;
  options: Record<string, unknown>;
  /** Checked path of the cover picture, if one was chosen. */
  cover?: string | null;
  coverExt?: string | null;
  /** Length of the sound in seconds (stops the looped picture in time). */
  duration?: number | null;
  /** ASS file with the lyrics (see lyricsAss), burnt in with libass. */
  lyrics?: string | null;
}

const OUT_MUXER: Record<string, string> = { mp4: 'mp4', mov: 'mov', mkv: 'matroska', webm: 'webm' };

/** Builds the ffmpeg arguments (an argument list – never a shell string). */
export function buildVisualizerArgs(req: VisualizerArgsRequest): string[] {
  const { style, color, size } = resolveVisualizer(req.options);
  const demuxer = DEMUXER[req.inputExt];
  const muxer = OUT_MUXER[req.outputExt];
  if (!demuxer || !muxer) {
    throw new Error(`visualizer: .${req.inputExt} → .${req.outputExt} not supported`);
  }
  const [w, h] = SIZE_PX[size];
  const hex = COLOR_HEX[color];
  const hasLyrics = Boolean(req.lyrics);
  // A still picture needs only a few frames per second – much faster and smaller
  // (with lyrics a few more, so lines change on time).
  const fps = style === 'still' ? (hasLyrics ? 10 : 2) : 30;
  const args = ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', '-progress', 'pipe:1'];
  args.push('-nostats', '-protocol_whitelist', 'file', '-f', demuxer, '-i', req.input);
  const hasCover = Boolean(req.cover);
  if (req.cover) {
    args.push('-protocol_whitelist', 'file', '-f', 'image2', '-loop', '1');
    args.push('-framerate', String(fps), '-i', req.cover);
  }

  const filters: string[] = [];
  // Background: the cover blurred and darkened across the whole frame, the cover itself
  // sharp in the middle (above the waveform) – or a plain dark background.
  const { art, artTop, bandH, bandY } = visualizerLayout(style, w, h, hasCover, hasLyrics);
  if (hasCover) {
    filters.push(
      `[1:v]split=2[c1][c2]`,
      `[c1]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=24:2,eq=brightness=-0.3,setsar=1[bg]`,
      `[c2]scale=${art}:${art}:force_original_aspect_ratio=decrease,setsar=1[art]`,
      `[bg][art]overlay=(W-w)/2:${artTop}+(${art}-h)/2[base]`,
    );
  } else {
    filters.push(`color=c=0x15131f:s=${w}x${h}:r=${fps}[base]`);
  }

  if (style === 'wave') {
    filters.push(
      `[0:a]aformat=channel_layouts=mono,showwaves=s=${w}x${bandH}:mode=cline:draw=full:rate=${fps}:colors=${hex}:scale=sqrt,format=rgba[viz]`,
    );
  } else if (style === 'bars') {
    filters.push(
      `[0:a]aformat=channel_layouts=mono,showfreqs=s=${w}x${bandH}:mode=bar:ascale=sqrt:fscale=log:win_size=2048:colors=${hex},fps=${fps},format=rgba,colorkey=black:0.05:0[viz]`,
    );
  } else if (style === 'spectrum') {
    filters.push(
      // Drawn at a third of the width and stretched: it fills in a few seconds instead of a minute.
      `[0:a]showspectrum=s=${Math.round(w / 6) * 2}x${bandH}:slide=scroll:mode=combined:color=intensity:scale=log:fscale=log:overlap=0.875,fps=${fps},scale=${w}:${bandH},format=rgba,colorkey=black:0.08:0.05[viz]`,
    );
  }
  const words = req.lyrics ? `,subtitles=filename=${filterPath(req.lyrics)}` : '';
  if (style === 'still') {
    filters.push(`[base]fps=${fps}${words},format=yuv420p[v]`);
  } else {
    filters.push(`[base][viz]overlay=0:${bandY}:shortest=1${words},format=yuv420p[v]`);
  }
  args.push('-filter_complex', filters.join(';'), '-map', '[v]', '-map', '0:a');

  if (req.outputExt === 'webm') {
    args.push('-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1');
    args.push('-b:v', style === 'still' ? '300k' : '2M', '-c:a', 'libopus', '-b:a', '160k');
  } else {
    args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23');
    if (style === 'still') args.push('-tune', 'stillimage');
    args.push('-c:a', 'aac', '-b:a', '192k');
    if (req.outputExt !== 'mkv') args.push('-movflags', '+faststart');
  }
  args.push('-r', String(fps), '-shortest');
  if (req.duration && req.duration > 0) args.push('-t', req.duration.toFixed(3));
  args.push('-f', muxer, req.output);
  return args;
}
