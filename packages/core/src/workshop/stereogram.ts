/**
 * Magic Eye (autostereogram): a picture of dots or a pattern that hides a 3D
 * shape. Look "through" the picture and the shape floats out. Every pixel
 * is tied to a partner pixel to its right; the nearer the hidden surface,
 * the closer the partners – both eyes then meet at that depth.
 * Algorithm after Thimbleby, Inglis & Witten (1994).
 */

export const STEREO_PATTERNS = ['color', 'mono', 'image'] as const;
export type StereoPattern = (typeof STEREO_PATTERNS)[number];

export interface StereoOptions {
  /** Distance of the partners for the far background, in pixels (≈ eye distance at screen size / 2). */
  eyeSep: number;
  /** How far the shape comes out (0.1–0.5; more = deeper, harder to see). */
  depth: number;
  pattern: StereoPattern;
  /** For 'image': its pixels (RGBA) and size; it is repeated. */
  tile?: { rgba: Uint8ClampedArray; width: number; height: number } | null;
  seed?: number;
}

function rng(seed: number) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The stereogram (RGBA) for a depth map (0 = far … 1 = near, row by row).
 */
export function stereogram(
  depthMap: Float32Array,
  width: number,
  height: number,
  o: StereoOptions,
): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(width * height * 4);
  const random = rng(o.seed ?? 7);
  const E = Math.max(8, Math.round(o.eyeSep));
  const mu = Math.max(0.05, Math.min(0.6, o.depth));
  const same = new Int32Array(width);
  // A row of random colours, varied per row (dots), so no stripes appear.
  const dot = new Uint8ClampedArray(width * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) same[x] = x;
    for (let x = 0; x < width; x++) {
      const z = Math.max(0, Math.min(1, depthMap[y * width + x] ?? 0));
      const s = Math.round(((1 - mu * z) * E) / (2 - mu * z));
      let left = x - (s >> 1);
      let right = left + s;
      if (left < 0 || right >= width) continue;
      // Hidden-surface check: is this point visible to both eyes?
      let visible = true;
      for (let t = 1; visible; t++) {
        const zt = z + (2 * (2 - mu * z) * t) / (mu * E);
        if (zt > 1) break;
        const a = depthMap[y * width + x - t] ?? 0;
        const b = depthMap[y * width + x + t] ?? 0;
        if ((x - t >= 0 && a >= zt) || (x + t < width && b >= zt)) visible = false;
      }
      if (!visible) continue;
      let l = same[left] ?? left;
      while (l !== left && l !== right) {
        if (l < right) {
          left = l;
          l = same[left] ?? left;
        } else {
          same[left] = right;
          left = right;
          l = same[left] ?? left;
          right = l;
        }
      }
      same[left] = right;
    }
    if (o.pattern !== 'image')
      for (let x = 0; x < width; x++) {
        if (o.pattern === 'mono') {
          const v = random() < 0.5 ? 20 : 235;
          dot.set([v, v, v], x * 3);
        } else {
          // Bright, varied colours: easier for the eyes to lock on.
          const hue = random() * 6;
          const k = (m: number) => {
            const v = Math.max(0, Math.min(1, Math.abs(((hue + m) % 6) - 3) - 1));
            return Math.round(60 + v * 180 * (0.6 + 0.4 * random()));
          };
          dot.set([k(0), k(4), k(2)], x * 3);
        }
      }
    for (let x = width - 1; x >= 0; x--) {
      const o4 = (y * width + x) * 4;
      const partner = same[x] ?? x;
      if (partner === x) {
        if (o.pattern === 'image' && o.tile) {
          const t = o.tile;
          const ti = ((y % t.height) * t.width + (x % t.width)) * 4;
          out[o4] = t.rgba[ti] ?? 0;
          out[o4 + 1] = t.rgba[ti + 1] ?? 0;
          out[o4 + 2] = t.rgba[ti + 2] ?? 0;
        } else {
          out[o4] = dot[x * 3] ?? 0;
          out[o4 + 1] = dot[x * 3 + 1] ?? 0;
          out[o4 + 2] = dot[x * 3 + 2] ?? 0;
        }
      } else {
        const p4 = (y * width + partner) * 4;
        out[o4] = out[p4] ?? 0;
        out[o4 + 1] = out[p4 + 1] ?? 0;
        out[o4 + 2] = out[p4 + 2] ?? 0;
      }
      out[o4 + 3] = 255;
    }
  }
  return out;
}

/** Distance of the two help dots: the partner distance of the background. */
export function guideDotDistance(eyeSep: number): number {
  return Math.round(eyeSep / 2);
}

/** A depth map from greyscale (0–255): bright is near unless inverted; softened edges. */
export function depthFromGray(
  gray: Uint8Array,
  width: number,
  height: number,
  invert: boolean,
): Float32Array {
  const raw = new Float32Array(width * height);
  for (let i = 0; i < raw.length; i++) {
    const v = (gray[i] ?? 0) / 255;
    raw[i] = invert ? 1 - v : v;
  }
  // A small box blur: hard steps look torn in a stereogram.
  const out = new Float32Array(raw.length);
  const r = 2;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let s = 0;
      let c = 0;
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
          s += raw[yy * width + xx] ?? 0;
          c++;
        }
      out[y * width + x] = s / c;
    }
  return out;
}
