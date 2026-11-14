/**
 * Picture forensics: copied areas inside one picture (copy-move) and
 * filters that make edits visible (noise, edges, brightness bands).
 * Everything works on RGBA pixels.
 */

/** Brightness 0–255 of every pixel. */
export function luminance(rgba: Uint8ClampedArray, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let p = 0; p < w * h; p++) {
    const o = p * 4;
    out[p] = 0.299 * (rgba[o] ?? 0) + 0.587 * (rgba[o + 1] ?? 0) + 0.114 * (rgba[o + 2] ?? 0);
  }
  return out;
}

export interface CopyMoveRegion {
  dx: number;
  dy: number;
  /** Matching blocks with this shift. */
  blocks: number;
}

export interface CopyMoveResult {
  regions: CopyMoveRegion[];
  /** One byte per pixel: 1 = source, 2 = copy of a found region. */
  mask: Uint8Array;
}

/**
 * Finds areas copied within the same picture: every 8×8 block gets a
 * fingerprint (16 averages, rounded so slight JPEG changes don't matter).
 * Equal fingerprints at a distance are counted per shift – a shift that
 * many blocks share is a copied region. Flat blocks (sky, walls) are left
 * out, they would match everywhere.
 */
export function copyMove(
  gray: Float32Array,
  w: number,
  h: number,
  options: { block?: number; step?: number; minShift?: number; minBlocks?: number } = {},
): CopyMoveResult {
  const B = options.block ?? 8;
  const step = options.step ?? 2;
  const minShift = options.minShift ?? B * 2;
  const minBlocks = options.minBlocks ?? 10;
  const buckets = new Map<string, number[]>();
  const cell = B / 4;
  for (let y = 0; y + B <= h; y += step) {
    for (let x = 0; x + B <= w; x += step) {
      let sum = 0;
      let sq = 0;
      const means: number[] = [];
      for (let cy = 0; cy < 4; cy++)
        for (let cx = 0; cx < 4; cx++) {
          let m = 0;
          for (let yy = 0; yy < cell; yy++)
            for (let xx = 0; xx < cell; xx++) {
              const v = gray[(y + cy * cell + yy) * w + x + cx * cell + xx] ?? 0;
              m += v;
              sq += v * v;
            }
          sum += m;
          means.push(m / (cell * cell));
        }
      const n = B * B;
      const variance = sq / n - (sum / n) ** 2;
      if (variance < 40) continue;
      const key = means.map((m) => Math.round(m / 6)).join(',');
      const list = buckets.get(key);
      if (list) {
        if (list.length < 16) list.push(y * w + x);
      } else buckets.set(key, [y * w + x]);
    }
  }
  const shifts = new Map<string, [number, number][]>();
  for (const list of buckets.values()) {
    for (let a = 0; a < list.length; a++)
      for (let b = a + 1; b < list.length; b++) {
        const pa = list[a] ?? 0;
        const pb = list[b] ?? 0;
        let dx = (pb % w) - (pa % w);
        let dy = Math.floor(pb / w) - Math.floor(pa / w);
        if (Math.hypot(dx, dy) < minShift) continue;
        let from = pa;
        let to = pb;
        if (dx < 0 || (dx === 0 && dy < 0)) {
          dx = -dx;
          dy = -dy;
          from = pb;
          to = pa;
        }
        // Neighbouring shifts are the same copy (rounding of the step).
        const k = `${Math.round(dx / step)},${Math.round(dy / step)}`;
        const pairs = shifts.get(k) ?? [];
        pairs.push([from, to]);
        shifts.set(k, pairs);
      }
  }
  const mask = new Uint8Array(w * h);
  const regions: CopyMoveRegion[] = [];
  for (const [k, pairs] of shifts) {
    if (pairs.length < minBlocks) continue;
    const [sx, sy] = k.split(',').map((v) => Number(v) * step);
    regions.push({ dx: sx ?? 0, dy: sy ?? 0, blocks: pairs.length });
    for (const [from, to] of pairs)
      for (const [p, mark] of [
        [from, 1],
        [to, 2],
      ] as const)
        for (let yy = 0; yy < B; yy++)
          for (let xx = 0; xx < B; xx++) {
            const at = p + yy * w + xx;
            if (at < mask.length) mask[at] = Math.max(mask[at] ?? 0, mark);
          }
  }
  regions.sort((a, b) => b.blocks - a.blocks);
  return { regions: regions.slice(0, 20), mask };
}

export const FORENSIC_FILTERS = ['noise', 'edges', 'levels'] as const;
export type ForensicFilter = (typeof FORENSIC_FILTERS)[number];

const gray = (out: Uint8ClampedArray, p: number, v: number) => {
  const o = p * 4;
  const c = Math.max(0, Math.min(255, v));
  out[o] = c;
  out[o + 1] = c;
  out[o + 2] = c;
  out[o + 3] = 255;
};

/**
 * - noise: the fine grain (picture minus a smoothed copy), amplified. Pasted
 *   parts often have other grain than their surroundings.
 * - edges: how sharp the picture changes; cut-out edges stand out.
 * - levels: only a narrow brightness band, stretched – shows retouched
 *   patches in skies and skin that look even to the eye.
 */
export function forensicFilter(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  filter: ForensicFilter,
  amount: number,
): Uint8ClampedArray<ArrayBuffer> {
  const l = luminance(rgba, w, h);
  const out = new Uint8ClampedArray(w * h * 4);
  const at = (x: number, y: number) =>
    l[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))] ?? 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (filter === 'noise') {
        const n = [
          at(x - 1, y - 1),
          at(x, y - 1),
          at(x + 1, y - 1),
          at(x - 1, y),
          at(x, y),
          at(x + 1, y),
          at(x - 1, y + 1),
          at(x, y + 1),
          at(x + 1, y + 1),
        ].sort((a, b) => a - b);
        gray(out, p, Math.abs((l[p] ?? 0) - (n[4] ?? 0)) * amount);
      } else if (filter === 'edges') {
        const gx =
          at(x + 1, y - 1) +
          2 * at(x + 1, y) +
          at(x + 1, y + 1) -
          at(x - 1, y - 1) -
          2 * at(x - 1, y) -
          at(x - 1, y + 1);
        const gy =
          at(x - 1, y + 1) +
          2 * at(x, y + 1) +
          at(x + 1, y + 1) -
          at(x - 1, y - 1) -
          2 * at(x, y - 1) -
          at(x + 1, y - 1);
        gray(out, p, (Math.hypot(gx, gy) / 4) * (amount / 10));
      } else {
        // amount = centre brightness 0–255; the band is 24 levels wide.
        const v = l[p] ?? 0;
        gray(out, p, ((v - (amount - 12)) / 24) * 255);
      }
    }
  return out;
}
