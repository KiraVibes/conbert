/**
 * File map: a file's bytes as a picture. The bytes run along a Hilbert curve
 * (neighbours in the file stay neighbours in the picture), each pixel is
 * coloured by what kind of bytes it holds – text, zeros, packed data …
 */

export const FILE_MAP_MODES = ['kind', 'entropy'] as const;
export type FileMapMode = (typeof FILE_MAP_MODES)[number];

/** Byte kinds, each with its colour on the map. */
export const BYTE_KINDS = ['zero', 'full', 'text', 'control', 'high'] as const;
export type ByteKind = (typeof BYTE_KINDS)[number];

export const BYTE_KIND_COLORS: Record<ByteKind, [number, number, number]> = {
  zero: [0, 0, 0],
  full: [255, 255, 255],
  text: [55, 126, 230],
  control: [70, 190, 90],
  high: [225, 60, 60],
};

export function byteKind(b: number): ByteKind {
  if (b === 0) return 'zero';
  if (b === 0xff) return 'full';
  if ((b >= 0x20 && b < 0x7f) || b === 0x09 || b === 0x0a || b === 0x0d) return 'text';
  if (b < 0x20 || b === 0x7f) return 'control';
  return 'high';
}

/** Position d along a Hilbert curve that fills a side×side square (side = power of 2). */
export function hilbertPoint(side: number, d: number): { x: number; y: number } {
  let x = 0;
  let y = 0;
  let t = d;
  for (let s = 1; s < side; s *= 2) {
    const rx = 1 & (t / 2);
    const ry = 1 & (t ^ rx);
    if (ry === 0) {
      if (rx === 1) {
        x = s - 1 - x;
        y = s - 1 - y;
      }
      [x, y] = [y, x];
    }
    x += s * rx;
    y += s * ry;
    t = Math.floor(t / 4);
  }
  return { x, y };
}

/** The other way round: which step of the curve is at (x, y)? */
export function hilbertIndex(side: number, x0: number, y0: number): number {
  let x = x0;
  let y = y0;
  let d = 0;
  for (let s = side / 2; s >= 1; s = Math.floor(s / 2)) {
    const rx = (x & s) > 0 ? 1 : 0;
    const ry = (y & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) {
      if (rx === 1) {
        x = s - 1 - x;
        y = s - 1 - y;
      }
      [x, y] = [y, x];
    }
  }
  return d;
}

export interface FileMap {
  side: number;
  /** Bytes per pixel. */
  chunk: number;
  rgba: Uint8ClampedArray<ArrayBuffer>;
  /** Share of each byte kind in the whole file. */
  shares: Record<ByteKind, number>;
}

/** Colour scale for entropy: calm blue (repetitive) → yellow → red (packed/encrypted). */
function heat(v: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, v));
  if (t < 0.5) {
    const u = t / 0.5;
    return [Math.round(20 + 200 * u), Math.round(40 + 180 * u), Math.round(120 - 80 * u)];
  }
  const u = (t - 0.5) / 0.5;
  return [Math.round(220 + 30 * u), Math.round(220 - 180 * u), Math.round(40 - 20 * u)];
}

/** Shannon entropy of bytes[from, to) in bits per byte (0–8). */
function entropy(bytes: Uint8Array, from: number, to: number, counts: Uint32Array): number {
  counts.fill(0);
  for (let i = from; i < to; i++) {
    const b = bytes[i] ?? 0;
    counts[b] = (counts[b] ?? 0) + 1;
  }
  const n = to - from;
  if (n <= 0) return 0;
  let h = 0;
  for (const c of counts) {
    if (c === 0) continue;
    const p = c / n;
    h -= p * Math.log2(p);
  }
  return h;
}

/** The smallest square (power of 2, at most maxSide) that shows the file well. */
export function fileMapSide(size: number, maxSide = 512): number {
  let side = 16;
  while (side < maxSide && side * side < size) side *= 2;
  return side;
}

export function fileMap(bytes: Uint8Array, mode: FileMapMode, maxSide = 512): FileMap {
  const side = fileMapSide(bytes.length, maxSide);
  const chunk = Math.max(1, Math.ceil(bytes.length / (side * side)));
  const rgba = new Uint8ClampedArray(side * side * 4);
  const counts = new Uint32Array(256);
  const kindCount: Record<ByteKind, number> = { zero: 0, full: 0, text: 0, control: 0, high: 0 };
  // Entropy needs some bytes to mean anything: at least 256 around the pixel.
  const window = Math.max(chunk, 256);
  const pixels = Math.ceil(bytes.length / chunk);
  for (let p = 0; p < side * side; p++) {
    const { x, y } = hilbertPoint(side, p);
    const o = (y * side + x) * 4;
    if (p >= pixels) {
      // Past the end of the file: a faint checker so "empty" is visible.
      const v = (x >> 2) % 2 === (y >> 2) % 2 ? 236 : 246;
      rgba.set([v, v, v, 60], o);
      continue;
    }
    const from = p * chunk;
    const to = Math.min(bytes.length, from + chunk);
    let r = 0;
    let g = 0;
    let b = 0;
    for (let i = from; i < to; i++) {
      const k = byteKind(bytes[i] ?? 0);
      kindCount[k]++;
      if (mode === 'kind') {
        const c = BYTE_KIND_COLORS[k];
        r += c[0];
        g += c[1];
        b += c[2];
      }
    }
    if (mode === 'kind') {
      const n = to - from;
      rgba.set([r / n, g / n, b / n, 255], o);
    } else {
      const mid = (from + to) / 2;
      const a = Math.max(0, Math.floor(mid - window / 2));
      const e = entropy(bytes, a, Math.min(bytes.length, a + window), counts);
      // Few bytes can't reach 8 bits: scale to what is possible.
      const max = Math.min(8, Math.log2(Math.min(256, Math.min(bytes.length, window))));
      const [hr, hg, hb] = heat(max > 0 ? e / max : 0);
      rgba.set([hr, hg, hb, 255], o);
    }
  }
  const total = Math.max(1, bytes.length);
  const shares = Object.fromEntries(BYTE_KINDS.map((k) => [k, kindCount[k] / total])) as Record<
    ByteKind,
    number
  >;
  return { side, chunk, rgba, shares };
}

/** Which bytes does the pixel at (x, y) stand for? null past the end. */
export function fileMapOffset(
  map: Pick<FileMap, 'side' | 'chunk'>,
  size: number,
  x: number,
  y: number,
) {
  const p = hilbertIndex(map.side, x, y);
  const from = p * map.chunk;
  if (from >= size) return null;
  return { from, to: Math.min(size, from + map.chunk) };
}
