import type { EngineOption } from '../engine';
import { DEMUXER } from '../ffmpeg-args';

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
];

export interface VisualizerSettings {
  style: VisualizerStyle;
  color: VisualizerColor;
  size: VisualizerSize;
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

export function resolveVisualizer(raw: Record<string, unknown>): VisualizerSettings {
  return {
    style: pick(raw['vizStyle'], VISUALIZER_STYLES, 'wave'),
    color: pick(raw['vizColor'], VISUALIZER_COLORS, 'violet'),
    size: pick(raw['vizSize'], VISUALIZER_SIZES, 'landscape720'),
  };
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
  // A still picture needs only a few frames per second – much faster and smaller.
  const fps = style === 'still' ? 2 : 30;
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
  const art = Math.round(Math.min(w, h) * (style === 'still' ? 0.8 : 0.55));
  if (hasCover) {
    filters.push(
      `[1:v]split=2[c1][c2]`,
      `[c1]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=24:2,eq=brightness=-0.3,setsar=1[bg]`,
      `[c2]scale=${art}:${art}:force_original_aspect_ratio=decrease,setsar=1[art]`,
      `[bg][art]overlay=(W-w)/2:(H-h)/2${style === 'still' ? '' : '-H*0.1'}[base]`,
    );
  } else {
    filters.push(`color=c=0x15131f:s=${w}x${h}:r=${fps}[base]`);
  }

  const bandH = Math.round((h * (style === 'spectrum' ? 0.3 : 0.25)) / 2) * 2;
  const bandY = h - bandH - Math.round(h * 0.06);
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
  if (style === 'still') {
    filters.push(`[base]fps=${fps},format=yuv420p[v]`);
  } else {
    filters.push(`[base][viz]overlay=0:${bandY}:shortest=1,format=yuv420p[v]`);
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
