/**
 * Colour reduction for the GBA: 256 colours in BGR555 (5 bits per channel).
 * Index 0 is always black – the GBA shows it around the picture.
 */

export const PALETTE_SIZE = 256;

/** 8-bit RGB → 15-bit index (r | g << 5 | b << 10), the GBA's own colour layout. */
const to555 = (r: number, g: number, b: number) => (r >> 3) | ((g >> 3) << 5) | ((b >> 3) << 10);

export interface Palette {
  /** GBA colours (BGR555), PALETTE_SIZE entries. */
  colors: Uint16Array;
  /** RGB (0–255) of each entry, for distance calculations. */
  rgb: Uint8Array;
  /** Entries in use (the rest is black). */
  used: number;
}

interface Box {
  colors: number[];
  count: number;
}

function channel(c: number, ch: number): number {
  return (c >> (ch * 5)) & 31;
}

/**
 * Median cut over the 15-bit colour histogram of a group of frames (one
 * scene), so the palette fits what is actually on screen.
 */
export function buildPalette(frames: readonly Uint8Array[]): Palette {
  const hist = new Uint32Array(32768);
  for (const frame of frames) {
    for (let i = 0; i < frame.length; i += 3) {
      const c = to555(frame[i] ?? 0, frame[i + 1] ?? 0, frame[i + 2] ?? 0);
      hist[c] = (hist[c] ?? 0) + 1;
    }
  }
  const used: number[] = [];
  for (let c = 0; c < 32768; c++) if ((hist[c] ?? 0) > 0) used.push(c);

  const boxes: Box[] = [{ colors: used, count: used.reduce((s, c) => s + (hist[c] ?? 0), 0) }];
  const target = PALETTE_SIZE - 1; // index 0 is black
  while (boxes.length < target) {
    // Split the box with the widest colour range, weighted by how often it appears.
    let best = -1;
    let bestScore = 0;
    let bestChannel = 0;
    for (const [index, box] of boxes.entries()) {
      if (box.colors.length < 2) continue;
      for (let ch = 0; ch < 3; ch++) {
        let lo = 31;
        let hi = 0;
        for (const c of box.colors) {
          const v = channel(c, ch);
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
        const score = (hi - lo) * Math.sqrt(box.count);
        if (score > bestScore) {
          bestScore = score;
          best = index;
          bestChannel = ch;
        }
      }
    }
    const box = boxes[best];
    if (!box) break;
    box.colors.sort((a, b) => channel(a, bestChannel) - channel(b, bestChannel));
    let acc = 0;
    let cut = 1;
    for (let k = 0; k < box.colors.length - 1; k++) {
      acc += hist[box.colors[k] ?? 0] ?? 0;
      if (acc >= box.count / 2) {
        cut = k + 1;
        break;
      }
    }
    const left = box.colors.slice(0, cut);
    const right = box.colors.slice(cut);
    const sum = (list: number[]) => list.reduce((s, c) => s + (hist[c] ?? 0), 0);
    boxes.splice(best, 1, { colors: left, count: sum(left) }, { colors: right, count: sum(right) });
  }

  const colors = new Uint16Array(PALETTE_SIZE);
  const rgb = new Uint8Array(PALETTE_SIZE * 3);
  for (const [k, box] of boxes.entries()) {
    let r = 0;
    let g = 0;
    let b = 0;
    let weight = 0;
    for (const c of box.colors) {
      const w = hist[c] ?? 0;
      r += channel(c, 0) * w;
      g += channel(c, 1) * w;
      b += channel(c, 2) * w;
      weight += w;
    }
    if (weight === 0) continue;
    const r5 = Math.round(r / weight);
    const g5 = Math.round(g / weight);
    const b5 = Math.round(b / weight);
    const index = k + 1;
    colors[index] = r5 | (g5 << 5) | (b5 << 10);
    rgb[index * 3] = (r5 << 3) | (r5 >> 2);
    rgb[index * 3 + 1] = (g5 << 3) | (g5 >> 2);
    rgb[index * 3 + 2] = (b5 << 3) | (b5 >> 2);
  }
  // Unused entries stay black, like index 0.
  return { colors, rgb, used: boxes.length + 1 };
}

/** For every 15-bit colour the nearest palette index. */
export function buildLookup(palette: Palette): Uint8Array {
  const used = palette.used;
  const lut = new Uint8Array(32768);
  for (let c = 0; c < 32768; c++) {
    const r = (channel(c, 0) << 3) | 4;
    const g = (channel(c, 1) << 3) | 4;
    const b = (channel(c, 2) << 3) | 4;
    let best = 0;
    let bestDist = Infinity;
    for (let k = 0; k < used; k++) {
      const dr = r - (palette.rgb[k * 3] ?? 0);
      const dg = g - (palette.rgb[k * 3 + 1] ?? 0);
      const db = b - (palette.rgb[k * 3 + 2] ?? 0);
      // Eyes are most sensitive to green, least to blue.
      const dist = 3 * dr * dr + 4 * dg * dg + 2 * db * db;
      if (dist < bestDist) {
        bestDist = dist;
        best = k;
      }
    }
    lut[c] = best;
  }
  return lut;
}

/** 4 × 4 Bayer matrix: ordered dithering stays still between frames (no flicker). */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const DITHER_STRENGTH = 1.5;

/** RGB24 frame → palette indices. */
export function quantize(
  frame: Uint8Array,
  width: number,
  height: number,
  lut: Uint8Array,
): Uint8Array {
  const out = new Uint8Array(width * height);
  const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      const d = ((BAYER[((y & 3) << 2) | (x & 3)] ?? 0) - 7.5) * DITHER_STRENGTH;
      const r = clamp((frame[p * 3] ?? 0) + d);
      const g = clamp((frame[p * 3 + 1] ?? 0) + d);
      const b = clamp((frame[p * 3 + 2] ?? 0) + d);
      out[p] = lut[to555(r, g, b)] ?? 0;
    }
  }
  return out;
}
