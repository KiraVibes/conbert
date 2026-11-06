/**
 * Picture fun for the workshop: ASCII art, pixel art with retro palettes,
 * glitch art and "deep fry". Pure functions on RGBA pixels (like ImageData),
 * so they run in a worker and can be tested without a browser.
 */

export interface Pixels {
  width: number;
  height: number;
  /** RGBA, one byte per channel, rows top to bottom. */
  data: Uint8ClampedArray | Uint8Array;
}

/** A small, repeatable random number source (same seed → same picture). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Brightness 0–255 as eyes see it; see-through parts count as white paper. */
function lumaAt(data: Pixels['data'], i: number): number {
  const a = (data[i + 3] ?? 255) / 255;
  const y = 0.299 * (data[i] ?? 0) + 0.587 * (data[i + 1] ?? 0) + 0.114 * (data[i + 2] ?? 0);
  return y * a + 255 * (1 - a);
}

// --- ASCII art ---

/** Characters from light to dark (on a light background). */
export const ASCII_RAMPS = {
  classic: ' .:-=+*#%@',
  blocks: ' ░▒▓█',
  detailed: ' .\'`^",:;Il!i><~+_-?][}{1)(|tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$',
} as const;
export type AsciiRamp = keyof typeof ASCII_RAMPS;

export const ASCII_MIN_COLUMNS = 20;
export const ASCII_MAX_COLUMNS = 240;

export interface AsciiArt {
  columns: number;
  rows: number;
  /** One string per row. */
  lines: string[];
  /** The average colour of each cell, RGB, row by row. */
  colors: Uint8Array;
}

/**
 * Picture → characters. A character is about twice as tall as wide, so each
 * cell covers twice as many pixel rows as columns.
 */
export function asciiArt(
  img: Pixels,
  columns: number,
  ramp: AsciiRamp,
  /** Light characters on a dark background (terminal, dark mode). */
  darkBackground: boolean,
): AsciiArt {
  const cols = Math.max(1, Math.min(Math.round(columns), img.width));
  const cellW = img.width / cols;
  const rows = Math.max(1, Math.round(img.height / (cellW * 2)));
  const cellH = img.height / rows;
  const chars = [...ASCII_RAMPS[ramp]];
  const lines: string[] = [];
  const colors = new Uint8Array(cols * rows * 3);
  for (let r = 0; r < rows; r++) {
    let line = '';
    const y0 = Math.floor(r * cellH);
    const y1 = Math.max(y0 + 1, Math.floor((r + 1) * cellH));
    for (let c = 0; c < cols; c++) {
      const x0 = Math.floor(c * cellW);
      const x1 = Math.max(x0 + 1, Math.floor((c + 1) * cellW));
      let sum = 0;
      let red = 0;
      let green = 0;
      let blue = 0;
      let n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * img.width + x) * 4;
          sum += lumaAt(img.data, i);
          red += img.data[i] ?? 0;
          green += img.data[i + 1] ?? 0;
          blue += img.data[i + 2] ?? 0;
          n++;
        }
      }
      const light = sum / n / 255;
      // Light background: dark pixels get the "heaviest" characters.
      const ink = darkBackground ? light : 1 - light;
      line += chars[Math.min(chars.length - 1, Math.round(ink * (chars.length - 1)))];
      const k = (r * cols + c) * 3;
      colors[k] = Math.round(red / n);
      colors[k + 1] = Math.round(green / n);
      colors[k + 2] = Math.round(blue / n);
    }
    lines.push(line);
  }
  return { columns: cols, rows, lines, colors };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** A web page with the art – in colour, one span per run of the same colour. */
export function asciiHtml(art: AsciiArt, colored: boolean, darkBackground: boolean): string {
  const bg = darkBackground ? '#000' : '#fff';
  const fg = darkBackground ? '#fff' : '#000';
  const body = art.lines
    .map((line, r) => {
      if (!colored) return escapeHtml(line);
      let out = '';
      let run = '';
      let runColor = '';
      [...line].forEach((ch, c) => {
        const k = (r * art.columns + c) * 3;
        const color = `#${[0, 1, 2].map((o) => (art.colors[k + o] ?? 0).toString(16).padStart(2, '0')).join('')}`;
        if (color !== runColor && run) {
          out += `<span style="color:${runColor}">${escapeHtml(run)}</span>`;
          run = '';
        }
        runColor = color;
        run += ch;
      });
      if (run) out += `<span style="color:${runColor}">${escapeHtml(run)}</span>`;
      return out;
    })
    .join('\n');
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>ASCII art</title>
<style>body{margin:0;background:${bg}}pre{margin:0;padding:1em;color:${fg};font:10px/1 ui-monospace,Consolas,monospace;letter-spacing:0.1em}</style>
</head><body><pre>${body}</pre></body></html>
`;
}

// --- Pixel art ---

/** Colour sets of old consoles and computers (#rrggbb). */
export const RETRO_PALETTES = {
  gameboy: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'],
  nes: [
    '#000000',
    '#7c7c7c',
    '#0000fc',
    '#0000bc',
    '#4428bc',
    '#940084',
    '#a80020',
    '#a81000',
    '#881400',
    '#503000',
    '#007800',
    '#006800',
    '#005800',
    '#004058',
    '#bcbcbc',
    '#0078f8',
    '#0058f8',
    '#6844fc',
    '#d800cc',
    '#e40058',
    '#f83800',
    '#e45c10',
    '#ac7c00',
    '#00b800',
    '#00a800',
    '#00a844',
    '#008888',
    '#f8f8f8',
    '#3cbcfc',
    '#6888fc',
    '#9878f8',
    '#f878f8',
    '#f85898',
    '#f87858',
    '#fca044',
    '#f8b800',
    '#b8f818',
    '#58d854',
    '#58f898',
    '#00e8d8',
    '#787878',
    '#fcfcfc',
    '#a4e4fc',
    '#b8b8f8',
    '#d8b8f8',
    '#f8b8f8',
    '#f8a4c0',
    '#f0d0b0',
    '#fce0a8',
    '#f8d878',
    '#d8f878',
    '#b8f8b8',
    '#b8f8d8',
    '#00fcfc',
    '#f8d8f8',
  ],
  c64: [
    '#000000',
    '#ffffff',
    '#68372b',
    '#70a4b2',
    '#6f3d86',
    '#588d43',
    '#352879',
    '#b8c76f',
    '#6f4f25',
    '#433900',
    '#9a6759',
    '#444444',
    '#6c6c6c',
    '#9ad284',
    '#6c5eb5',
    '#959595',
  ],
  pico8: [
    '#000000',
    '#1d2b53',
    '#7e2553',
    '#008751',
    '#ab5236',
    '#5f574f',
    '#c2c3c7',
    '#fff1e8',
    '#ff004d',
    '#ffa300',
    '#ffec27',
    '#00e436',
    '#29adff',
    '#83769c',
    '#ff77a8',
    '#ffccaa',
  ],
  cga: ['#000000', '#55ffff', '#ff55ff', '#ffffff'],
  mono: ['#000000', '#ffffff'],
} as const;
export type RetroPalette = keyof typeof RETRO_PALETTES;
export const RETRO_PALETTE_IDS = Object.keys(RETRO_PALETTES) as RetroPalette[];

export const DITHERS = ['none', 'floyd', 'ordered'] as const;
export type Dither = (typeof DITHERS)[number];

export const PIXEL_MIN_WIDTH = 16;
export const PIXEL_MAX_WIDTH = 320;

function parseHex(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** The palette colour that looks closest ("redmean" – cheap, close to how eyes judge). */
export function nearestColor(
  palette: readonly (readonly [number, number, number])[],
  r: number,
  g: number,
  b: number,
): readonly [number, number, number] {
  let best = palette[0] ?? [0, 0, 0];
  let bestD = Infinity;
  for (const p of palette) {
    const rm = (r + p[0]) / 2;
    const dr = r - p[0];
    const dg = g - p[1];
    const db = b - p[2];
    const d = (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/**
 * Picture → a small picture in the palette's colours. `width` is the number of
 * big pixels across; the picture is first shrunk (average per block).
 */
export function pixelArt(
  img: Pixels,
  width: number,
  palette: RetroPalette,
  dither: Dither,
): Pixels {
  const w = Math.max(1, Math.min(Math.round(width), img.width));
  const h = Math.max(1, Math.round((img.height * w) / img.width));
  // Shrink: average colour per block (alpha against white).
  const small = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor((y * img.height) / h);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * img.height) / h));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor((x * img.width) / w);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * img.width) / w));
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * img.width + xx) * 4;
          const a = (img.data[i + 3] ?? 255) / 255;
          r += (img.data[i] ?? 0) * a + 255 * (1 - a);
          g += (img.data[i + 1] ?? 0) * a + 255 * (1 - a);
          b += (img.data[i + 2] ?? 0) * a + 255 * (1 - a);
          n++;
        }
      }
      const k = (y * w + x) * 3;
      small[k] = r / n;
      small[k + 1] = g / n;
      small[k + 2] = b / n;
    }
  }
  const colors = RETRO_PALETTES[palette].map(parseHex);
  const out = new Uint8ClampedArray(w * h * 4);
  const clamp = (v: number) => Math.max(0, Math.min(255, v));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = (y * w + x) * 3;
      let r = small[k] ?? 0;
      let g = small[k + 1] ?? 0;
      let b = small[k + 2] ?? 0;
      if (dither === 'ordered') {
        // A fixed 4×4 pattern nudges each pixel a little up or down.
        const t = ((BAYER4[(y % 4) * 4 + (x % 4)] ?? 0) / 16 - 0.5) * 64;
        r += t;
        g += t;
        b += t;
      }
      const [pr, pg, pb] = nearestColor(colors, clamp(r), clamp(g), clamp(b));
      if (dither === 'floyd') {
        // The error is passed on to the neighbours (Floyd–Steinberg).
        const er = r - pr;
        const eg = g - pg;
        const eb = b - pb;
        const spread = (dx: number, dy: number, f: number) => {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= w || ny >= h) return;
          const j = (ny * w + nx) * 3;
          small[j] = (small[j] ?? 0) + er * f;
          small[j + 1] = (small[j + 1] ?? 0) + eg * f;
          small[j + 2] = (small[j + 2] ?? 0) + eb * f;
        };
        spread(1, 0, 7 / 16);
        spread(-1, 1, 3 / 16);
        spread(0, 1, 5 / 16);
        spread(1, 1, 1 / 16);
      }
      const o = (y * w + x) * 4;
      out[o] = pr;
      out[o + 1] = pg;
      out[o + 2] = pb;
      out[o + 3] = 255;
    }
  }
  return { width: w, height: h, data: out };
}

/** Each small pixel becomes a `scale`×`scale` block (sharp edges, no blur). */
export function scaleNearest(img: Pixels, scale: number): Pixels {
  const s = Math.max(1, Math.round(scale));
  const w = img.width * s;
  const h = img.height * s;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = Math.floor(y / s);
    for (let x = 0; x < w; x++) {
      const i = (sy * img.width + Math.floor(x / s)) * 4;
      const o = (y * w + x) * 4;
      out[o] = img.data[i] ?? 0;
      out[o + 1] = img.data[i + 1] ?? 0;
      out[o + 2] = img.data[i + 2] ?? 0;
      out[o + 3] = img.data[i + 3] ?? 255;
    }
  }
  return { width: w, height: h, data: out };
}

// --- Glitch art ---

/** Where a JPEG's picture data starts and ends (after the SOS header, before EOI). */
export function jpegScanRange(bytes: Uint8Array): { start: number; end: number } | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 4 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1] ?? 0;
    const length = ((bytes[i + 2] ?? 0) << 8) | (bytes[i + 3] ?? 0);
    if (marker === 0xda) {
      const start = i + 2 + length;
      let end = bytes.length;
      // The last FFD9 (end of image).
      for (let j = bytes.length - 2; j > start; j--) {
        if (bytes[j] === 0xff && bytes[j + 1] === 0xd9) {
          end = j;
          break;
        }
      }
      return start < end ? { start, end } : null;
    }
    i += 2 + length;
  }
  return null;
}

/**
 * Datamoshing for JPEG: a few bytes of the compressed picture data get other
 * values. Headers stay untouched, and no byte becomes or follows 0xFF – so
 * the file stays a JPEG that opens, it just decodes "wrong".
 */
export function glitchJpeg(bytes: Uint8Array, amount: number, seed: number): Uint8Array | null {
  const range = jpegScanRange(bytes);
  if (!range) return null;
  const out = bytes.slice();
  const random = seededRandom(seed);
  // Skip the first bit of picture data: a damaged start ruins everything.
  const from = range.start + Math.floor((range.end - range.start) * 0.02);
  const span = range.end - 1 - from;
  if (span <= 0) return out;
  const changes = Math.max(1, Math.round(amount));
  for (let n = 0; n < changes; n++) {
    const at = from + Math.floor(random() * span);
    if (out[at] === 0xff || out[at - 1] === 0xff) continue;
    out[at] = Math.floor(random() * 0xff); // 0x00–0xFE, never 0xFF
  }
  return out;
}

/** RGB split: the red and blue channels slide apart (a classic glitch look). */
export function channelShift(img: Pixels, shift: number): Pixels {
  const out = new Uint8ClampedArray(img.data.length);
  const s = Math.round(shift);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const o = (y * img.width + x) * 4;
      const rx = Math.min(img.width - 1, Math.max(0, x - s));
      const bx = Math.min(img.width - 1, Math.max(0, x + s));
      out[o] = img.data[(y * img.width + rx) * 4] ?? 0;
      out[o + 1] = img.data[o + 1] ?? 0;
      out[o + 2] = img.data[(y * img.width + bx) * 4 + 2] ?? 0;
      out[o + 3] = img.data[o + 3] ?? 255;
    }
  }
  return { width: img.width, height: img.height, data: out };
}

// --- Deep fry ---

/**
 * "Deep fried" meme look: colours far too strong, hard contrast, a bit of
 * noise. `strength` 0–1. The JPEG crunch afterwards happens in the browser.
 */
export function deepFry(img: Pixels, strength: number, seed: number): Pixels {
  const s = Math.max(0, Math.min(1, strength));
  const saturation = 1 + 2.5 * s;
  const contrast = 1 + 1.5 * s;
  const noise = 40 * s;
  const random = seededRandom(seed);
  const out = new Uint8ClampedArray(img.data.length);
  for (let i = 0; i < img.data.length; i += 4) {
    let r = img.data[i] ?? 0;
    let g = img.data[i + 1] ?? 0;
    let b = img.data[i + 2] ?? 0;
    const grey = 0.299 * r + 0.587 * g + 0.114 * b;
    r = grey + (r - grey) * saturation;
    g = grey + (g - grey) * saturation;
    b = grey + (b - grey) * saturation;
    // Warm it up – fried pictures turn orange.
    r = (r - 128) * contrast + 128 + 25 * s;
    g = (g - 128) * contrast + 128 + 5 * s;
    b = (b - 128) * contrast + 128 - 25 * s;
    const n = (random() - 0.5) * noise;
    out[i] = r + n;
    out[i + 1] = g + n;
    out[i + 2] = b + n;
    out[i + 3] = img.data[i + 3] ?? 255;
  }
  return { width: img.width, height: img.height, data: out };
}
