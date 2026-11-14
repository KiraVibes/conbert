import type { ChoiceFont } from '../engine';

/**
 * Colours and fonts for audio → video: named colours, own colours (#rrggbb),
 * colours taken from the cover, and the fonts the server has for lyrics.
 */

/** Named colours (wave and text). "cover" = taken from the cover picture. */
export const VISUALIZER_COLORS = [
  'violet',
  'white',
  'cyan',
  'orange',
  'green',
  'red',
  'pink',
  'yellow',
  'blue',
  'teal',
  'gold',
  'silver',
  'cover',
] as const;
export type VisualizerColor = (typeof VISUALIZER_COLORS)[number];

/** Text can also be black, or the same colour as the wave. */
export const LYRICS_COLORS = [
  'white',
  'black',
  'wave',
  ...VISUALIZER_COLORS.filter((c) => c !== 'white'),
] as const;
export type LyricsColor = (typeof LYRICS_COLORS)[number];

export const COLOR_HEX: Record<Exclude<VisualizerColor, 'cover'> | 'black', string> = {
  violet: '#a78bfa',
  white: '#ffffff',
  cyan: '#22d3ee',
  orange: '#fb923c',
  green: '#4ade80',
  red: '#f87171',
  pink: '#f472b6',
  yellow: '#fde047',
  blue: '#60a5fa',
  teal: '#2dd4bf',
  gold: '#e3b23c',
  silver: '#cbd5e1',
  black: '#111111',
};

/** Fonts for lyrics – all already in the server image (DejaVu, URW base 35, Nimbus). */
export const LYRICS_FONTS = [
  'sans',
  'serif',
  'elegant',
  'modern',
  'narrow',
  'classic',
  'typewriter',
  'script',
] as const;
export type LyricsFont = (typeof LYRICS_FONTS)[number];

export const FONT_FAMILY: Record<LyricsFont, { family: string; bold: boolean; css: string }> = {
  sans: { family: 'DejaVu Sans', bold: true, css: '"DejaVu Sans", Verdana, sans-serif' },
  serif: { family: 'DejaVu Serif', bold: true, css: '"DejaVu Serif", Georgia, serif' },
  elegant: { family: 'P052', bold: false, css: '"Palatino Linotype", Palatino, serif' },
  modern: { family: 'URW Gothic', bold: false, css: '"Century Gothic", "URW Gothic", sans-serif' },
  narrow: {
    family: 'Nimbus Sans Narrow',
    bold: true,
    css: '"Arial Narrow", "Nimbus Sans Narrow", sans-serif-condensed, sans-serif',
  },
  classic: { family: 'URW Bookman', bold: false, css: '"Bookman Old Style", "URW Bookman", serif' },
  typewriter: { family: 'DejaVu Sans Mono', bold: false, css: '"DejaVu Sans Mono", monospace' },
  script: { family: 'Z003', bold: false, css: '"Monotype Corsiva", "Z003", cursive' },
};

/** How a font choice shows itself: the server's font file, a device font as fallback. */
export function lyricsChoiceFont(font: LyricsFont): ChoiceFont {
  const f = FONT_FAMILY[font];
  return {
    name: `Conbert Lyrics ${font}`,
    fallback: f.css,
    url: `/api/fonts/lyrics/${font}`,
    bold: f.bold,
  };
}

export const LYRICS_SIZES = ['small', 'medium', 'large'] as const;
export type LyricsSize = (typeof LYRICS_SIZES)[number];
export const LYRICS_SIZE_FACTOR: Record<LyricsSize, number> = {
  small: 0.045,
  medium: 0.06,
  large: 0.078,
};

const HEX = /^#[0-9a-f]{6}$/i;

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX.test(value);
}

function toRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(r: number, g: number, b: number): string {
  const c = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

function hsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d + 6) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  return [h * 60, max === 0 ? 0 : d / max, max / 255];
}

/** Brightens a colour until it stands out on the dark background (keeps its hue). */
export function liftForDark(hex: string, minValue = 0.7): string {
  const [r, g, b] = toRgb(hex);
  const max = Math.max(r, g, b);
  if (max === 0) return '#b3b3b3';
  if (max / 255 >= minValue) return hex;
  const f = (minValue * 255) / max;
  return toHex(r * f, g * f, b * f);
}

/** Relative brightness 0–1 (for choosing a dark or light outline). */
export function brightness(hex: string): number {
  const [r, g, b] = toRgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/**
 * The strongest colours of a picture (RGB or RGBA, any size – small is
 * enough): pixels are grouped by hue, colourful and bright ones count more.
 * Returns up to `count` clearly different colours, the best first.
 */
export function coverPalette(
  pixels: Uint8Array | Uint8ClampedArray,
  channels: 3 | 4,
  count = 6,
): string[] {
  const BINS = 24;
  const weight = new Float64Array(BINS);
  const sum = Array.from({ length: BINS }, () => [0, 0, 0]);
  let greyWeight = 0;
  const grey = [0, 0, 0];
  for (let i = 0; i + 2 < pixels.length; i += channels) {
    const r = pixels[i] ?? 0;
    const g = pixels[i + 1] ?? 0;
    const b = pixels[i + 2] ?? 0;
    if (channels === 4 && (pixels[i + 3] ?? 255) < 128) continue;
    const [h, s, v] = hsv(r, g, b);
    if (s < 0.2 || v < 0.15) {
      if (v > 0.6) {
        greyWeight += v;
        grey[0] = (grey[0] ?? 0) + r * v;
        grey[1] = (grey[1] ?? 0) + g * v;
        grey[2] = (grey[2] ?? 0) + b * v;
      }
      continue;
    }
    const w = s * s * (0.3 + v);
    const bin = Math.floor(h / (360 / BINS)) % BINS;
    weight[bin] = (weight[bin] ?? 0) + w;
    const acc = sum[bin] ?? [0, 0, 0];
    acc[0] = (acc[0] ?? 0) + r * w;
    acc[1] = (acc[1] ?? 0) + g * w;
    acc[2] = (acc[2] ?? 0) + b * w;
  }
  const order = [...weight.keys()]
    .filter((b) => (weight[b] ?? 0) > 0)
    .sort((a, b) => (weight[b] ?? 0) - (weight[a] ?? 0));
  const chosen: number[] = [];
  for (const bin of order) {
    // Neighbouring hues look alike – keep the colours apart.
    if (chosen.some((c) => Math.min(Math.abs(c - bin), BINS - Math.abs(c - bin)) < 2)) continue;
    chosen.push(bin);
    if (chosen.length >= count) break;
  }
  const colours = chosen.map((bin) => {
    const w = weight[bin] ?? 1;
    const acc = sum[bin] ?? [0, 0, 0];
    return liftForDark(toHex((acc[0] ?? 0) / w, (acc[1] ?? 0) / w, (acc[2] ?? 0) / w));
  });
  // A light grey/white cover still gives a colour to pick.
  if (colours.length < count && greyWeight > 0) {
    colours.push(
      toHex((grey[0] ?? 0) / greyWeight, (grey[1] ?? 0) / greyWeight, (grey[2] ?? 0) / greyWeight),
    );
  }
  return colours;
}

/**
 * The colour to use for a choice: a named colour, an own colour (#rrggbb),
 * "cover" (first colour of the cover's palette, else violet) or – for text –
 * "wave" (the wave's colour).
 */
export function resolveColor(
  value: unknown,
  fallback: string,
  coverColor: string | null,
  waveColor?: string,
): string {
  if (isHexColor(value)) return value.toLowerCase();
  if (value === 'cover') return coverColor ?? COLOR_HEX.violet;
  if (value === 'wave' && waveColor) return waveColor;
  if (typeof value === 'string' && value in COLOR_HEX)
    return COLOR_HEX[value as keyof typeof COLOR_HEX];
  return fallback;
}

/** "#a78bfa" → "0xa78bfa" for ffmpeg filters. */
export function ffmpegColor(hex: string): string {
  return `0x${hex.slice(1)}`;
}

/** "#a78bfa" → "&H00FA8BA7" (ASS colours are alpha-blue-green-red). */
export function assColor(hex: string, alpha = 0): string {
  const [r, g, b] = toRgb(hex);
  const p = (n: number) => n.toString(16).toUpperCase().padStart(2, '0');
  return `&H${p(alpha)}${p(b)}${p(g)}${p(r)}`;
}
