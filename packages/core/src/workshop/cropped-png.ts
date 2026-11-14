import { inflateTail, type TailInflate } from './inflate-tail';

/**
 * "aCropalypse" (CVE-2023-21036, CVE-2023-28303): some cropping tools (older
 * Google Pixel Markup, the Windows Snipping Tool) wrote the cropped picture
 * over the old file without cutting it short. Behind the new file's end the
 * rest of the original stays – often enough to show its lower part again.
 */

export interface PngInfo {
  width: number;
  height: number;
  colorType: number;
  bitDepth: number;
  /** Bytes behind IEND (where the rest of the old file can be). */
  trailerAt: number;
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const u32 = (b: Uint8Array, i: number) =>
  (((b[i] ?? 0) << 24) | ((b[i + 1] ?? 0) << 16) | ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0)) >>> 0;
const type = (b: Uint8Array, i: number) =>
  String.fromCharCode(b[i] ?? 0, b[i + 1] ?? 0, b[i + 2] ?? 0, b[i + 3] ?? 0);

/** Reads a PNG's header and where its IEND ends; null when it isn't a PNG. */
export function readPngInfo(b: Uint8Array): PngInfo | null {
  if (!PNG_SIG.every((v, i) => b[i] === v)) return null;
  let i = 8;
  let info: Omit<PngInfo, 'trailerAt'> | null = null;
  while (i + 12 <= b.length) {
    const len = u32(b, i);
    const t = type(b, i + 4);
    if (t === 'IHDR') {
      info = {
        width: u32(b, i + 8),
        height: u32(b, i + 12),
        bitDepth: b[i + 16] ?? 0,
        colorType: b[i + 17] ?? 0,
      };
    }
    i += 12 + len;
    if (t === 'IEND') return info ? { ...info, trailerAt: Math.min(i, b.length) } : null;
  }
  return null;
}

/**
 * The picture data left in the trailer: the old file's IDAT chunks without
 * their headers and checksums. The first chunk was cut – its rest is taken
 * from after the first 12 bytes (which may still be a chunk border).
 */
export function trailerIdat(trailer: Uint8Array): Uint8Array | null {
  let next = -1;
  for (let i = 12; i + 4 <= trailer.length; i++) {
    if (type(trailer, i) === 'IDAT') {
      next = i;
      break;
    }
  }
  if (next < 0) {
    // The old picture had one big IDAT chunk: its rest runs up to the old IEND.
    let end = -1;
    for (let i = trailer.length - 8; i >= 12; i--) {
      if (type(trailer, i) === 'IEND') {
        end = i - 8; // CRC of the IDAT chunk + length of IEND
        break;
      }
    }
    return end > 12 ? trailer.slice(12, end) : null;
  }
  const parts: Uint8Array[] = [trailer.subarray(12, Math.max(12, next - 8))];
  let i = next - 4;
  while (i + 12 <= trailer.length) {
    const len = u32(trailer, i);
    if (type(trailer, i + 4) !== 'IDAT') break;
    parts.push(trailer.subarray(i + 8, Math.min(trailer.length, i + 8 + len)));
    i += 12 + len;
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/**
 * Finds the first place in `idat` where a DEFLATE block starts and runs to
 * the end. `accept` checks the result further (e.g. that it forms picture
 * rows) – a wrong start sometimes decodes to garbage that ends by chance.
 */
export function findTailStream(
  idat: Uint8Array,
  accept: (r: TailInflate) => boolean = () => true,
  onProgress?: (share: number) => void,
): TailInflate | null {
  const total = idat.length * 8;
  let best: TailInflate | null = null;
  let stopAt = total;
  // zlib writes dynamic blocks – try those first, they fail fast on a wrong start.
  for (const firstType of [2, undefined]) {
    for (let bit = 0; bit < Math.min(total, stopAt); bit++) {
      if (onProgress && bit % 65536 === 0) onProgress(bit / total / 2 + (firstType ? 0 : 0.5));
      const r = inflateTail(idat, bit, { firstType, maxOut: 512 * 1024 * 1024 });
      if (!r || r.bitsLeft < 0 || r.bitsLeft >= 48) continue;
      // Picture data barely gets smaller than its compressed size (noise grows a bit).
      if (r.data.length < (total - bit) / 8 / 1.1) continue;
      if (best && r.data.length <= best.data.length) continue;
      if (!accept(r)) continue;
      // A wrong start can decode to a short garbage end by chance – the real
      // first block gives the most data. Look one block length further.
      best = r;
      stopAt = Math.min(stopAt, bit + SEARCH_AFTER_HIT);
    }
    if (best) return best;
  }
  return null;
}

/** How far (in bits) to keep looking after a hit – zlib's blocks are smaller. */
const SEARCH_AFTER_HIT = 128 * 1024 * 8;

export interface RowLayout {
  width: number;
  /** Bytes per pixel: 3 (RGB) or 4 (RGBA). */
  channels: 3 | 4;
  rows: number;
  /** Where the first whole row starts in the decoded data. */
  start: number;
}

/**
 * Guesses the old picture's width: every row starts with a filter byte 0–4,
 * and the data ends exactly at a row end. The narrowest width where all rows
 * fit wins (wider multiples fit too, but check fewer rows).
 */
export function guessLayout(
  data: Uint8Array,
  hint?: { width: number; channels: number },
): RowLayout | null {
  const fits = (width: number, channels: 3 | 4): RowLayout | null => {
    const stride = 1 + width * channels;
    const rows = Math.floor(data.length / stride);
    if (rows < 8) return null;
    const start = data.length - rows * stride;
    for (let r = 0; r < rows; r++) if ((data[start + r * stride] ?? 255) > 4) return null;
    return { width, channels, rows, start };
  };
  const narrowest = (channels: 3 | 4): RowLayout | null => {
    for (let width = Math.max(16, hint?.width ?? 16); width <= 8192; width++) {
      const l = fits(width, channels);
      if (l) return l;
    }
    return null;
  };
  const rgb = narrowest(3);
  const rgba = narrowest(4);
  if (!rgb || !rgba) return rgb ?? rgba;
  // Different layouts can share a row length (900 RGB = 675 RGBA pixels).
  // Screenshots are opaque: real RGBA rows have an alpha that hardly changes.
  if (rgba.rows * (1 + rgba.width * 4) === rgb.rows * (1 + rgb.width * 3))
    return alphaIsSteady(data, rgba) ? rgba : rgb;
  return rgb.rows >= rgba.rows ? rgb : rgba;
}

/** Whether the 4th byte of each pixel is (almost) always the same – a real alpha channel. */
function alphaIsSteady(data: Uint8Array, layout: RowLayout): boolean {
  const { lines, lost } = unfilterRaw(
    { data, unknown: new Uint8Array(data.length), bitsLeft: 0 },
    layout,
  );
  const counts = new Uint32Array(256);
  let known = 0;
  for (let i = 3; i < lines.length; i += 4) {
    if (lost[i]) continue;
    counts[lines[i] ?? 0] = (counts[lines[i] ?? 0] ?? 0) + 1;
    known++;
  }
  return known > 0 && Math.max(...counts) / known > 0.9;
}

const paeth = (a: number, b: number, c: number) => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/**
 * For each row filter and colour channel the most common known byte – the
 * best guess for a lost byte there (backgrounds are flat, their deltas 0).
 */
function guessLostBytes(stream: TailInflate, layout: RowLayout): Uint8Array {
  const { width, channels, rows, start } = layout;
  const stride = width * channels;
  const counts = new Uint32Array(5 * channels * 256);
  for (let r = 0; r < rows; r++) {
    const at = start + r * (stride + 1);
    const filter = Math.min(stream.data[at] ?? 0, 4);
    for (let x = 0; x < stride; x++) {
      if (stream.unknown[at + 1 + x]) continue;
      const k = (filter * channels + (x % channels)) * 256 + (stream.data[at + 1 + x] ?? 0);
      counts[k] = (counts[k] ?? 0) + 1;
    }
  }
  const guess = new Uint8Array(5 * channels);
  for (let g = 0; g < guess.length; g++) {
    let best = 0;
    for (let v = 1; v < 256; v++)
      if ((counts[g * 256 + v] ?? 0) > (counts[g * 256 + best] ?? 0)) best = v;
    guess[g] = best;
  }
  return guess;
}

/** Undoes the PNG row filters; `lost` marks bytes that depend on lost data. */
export function unfilterRaw(
  stream: TailInflate,
  layout: RowLayout,
): { lines: Uint8Array; lost: Uint8Array } {
  const { width, channels, rows, start } = layout;
  const stride = width * channels;
  const guess = guessLostBytes(stream, layout);
  const lines = new Uint8Array(rows * stride);
  const lostAll = new Uint8Array(rows * stride);
  let prev = new Uint8Array(stride);
  // The first row has no known row above it.
  let prevLost = new Uint8Array(stride).fill(1);
  for (let r = 0; r < rows; r++) {
    const at = start + r * (stride + 1);
    const filter = stream.data[at] ?? 0;
    const line = lines.subarray(r * stride, (r + 1) * stride);
    const lost = lostAll.subarray(r * stride, (r + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const unknown = stream.unknown[at + 1 + x] ?? 0;
      // A lost byte gets the most common value of its kind (flat areas: right).
      const raw = unknown
        ? (guess[Math.min(filter, 4) * channels + (x % channels)] ?? 0)
        : (stream.data[at + 1 + x] ?? 0);
      const left = x >= channels;
      const a = left ? (line[x - channels] ?? 0) : 0;
      const b = prev[x] ?? 0;
      const c = left ? (prev[x - channels] ?? 0) : 0;
      const lostA = left ? (lost[x - channels] ?? 0) : 0;
      const lostB = prevLost[x] ?? 0;
      const lostC = left ? (prevLost[x - channels] ?? 0) : 0;
      let v = raw;
      let gone = unknown;
      if (filter === 1) {
        v = raw + a;
        gone |= lostA;
      } else if (filter === 2) {
        v = raw + b;
        gone |= lostB;
      } else if (filter === 3) {
        v = raw + ((a + b) >> 1);
        gone |= lostA | lostB;
      } else if (filter === 4) {
        v = raw + paeth(a, b, c);
        gone |= lostA | lostB | lostC;
      }
      line[x] = v & 255;
      lost[x] = gone;
    }
    prev = line;
    prevLost = lost;
  }
  return { lines, lost: lostAll };
}

/**
 * Turns the filtered rows back into RGBA pixels. Lost bytes are guessed; with
 * `markLost` the pixels that depend on one come out magenta instead.
 */
export function unfilterRows(
  stream: TailInflate,
  layout: RowLayout,
  markLost = true,
): Uint8ClampedArray<ArrayBuffer> {
  const { width, channels, rows } = layout;
  const { lines, lost } = unfilterRaw(stream, layout);
  const out = new Uint8ClampedArray(width * rows * 4);
  for (let p = 0; p < width * rows; p++) {
    const s = p * channels;
    const o = p * 4;
    const gone = markLost && (lost[s] || lost[s + 1] || lost[s + 2]);
    out[o] = gone ? 255 : (lines[s] ?? 0);
    out[o + 1] = gone ? 0 : (lines[s + 1] ?? 0);
    out[o + 2] = gone ? 255 : (lines[s + 2] ?? 0);
    out[o + 3] = 255;
  }
  return out;
}

export type CropRecovery =
  | { status: 'not-png' }
  | { status: 'clean' }
  | { status: 'trailer-only'; trailerBytes: number }
  | {
      status: 'recovered';
      trailerBytes: number;
      width: number;
      height: number;
      /** With guesses for lost bytes. */
      pixels: Uint8ClampedArray<ArrayBuffer>;
      /** Lost (and guessed) pixels in magenta. */
      marked: Uint8ClampedArray<ArrayBuffer>;
      /** Share of pixels that were guessed, 0–1. */
      guessed: number;
    };

/** Looks behind a PNG's end for the rest of an older, bigger picture and shows it again. */
export function recoverCroppedPng(
  bytes: Uint8Array,
  onProgress?: (share: number) => void,
): CropRecovery {
  const info = readPngInfo(bytes);
  if (!info) return { status: 'not-png' };
  const trailer = bytes.subarray(info.trailerAt);
  if (trailer.length < 64) return { status: 'clean' };
  const idat = trailerIdat(trailer);
  const hint = { width: info.width, channels: info.colorType === 6 ? 4 : 3 };
  const stream = idat
    ? findTailStream(idat, (r) => guessLayout(r.data, hint) !== null, onProgress)
    : null;
  const layout = stream ? guessLayout(stream.data, hint) : null;
  if (!stream || !layout) return { status: 'trailer-only', trailerBytes: trailer.length };
  const marked = unfilterRows(stream, layout, true);
  let lostPixels = 0;
  for (let i = 0; i < marked.length; i += 4)
    if (marked[i] === 255 && marked[i + 1] === 0 && marked[i + 2] === 255) lostPixels++;
  const guessed = lostPixels / (marked.length / 4);
  return {
    status: 'recovered',
    trailerBytes: trailer.length,
    width: layout.width,
    height: layout.rows,
    pixels: unfilterRows(stream, layout, false),
    marked,
    guessed,
  };
}
