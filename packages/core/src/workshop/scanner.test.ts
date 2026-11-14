import { describe, expect, it } from 'vitest';
import {
  detectDocument,
  enhanceScan,
  homography,
  otsuThreshold,
  outputSize,
  quadArea,
  rotate90,
  warpPerspective,
  type Quad,
} from './scanner';

/** A dark table with a bright sheet whose corners are `q` (in pixels), plus some "text". */
function photo(w: number, h: number, q: [number, number][]): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4);
  const inside = (x: number, y: number) => {
    let hit = false;
    for (let i = 0, j = 3; i < 4; j = i++) {
      const [xi, yi] = q[i] ?? [0, 0];
      const [xj, yj] = q[j] ?? [0, 0];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const paper = inside(x + 0.5, y + 0.5);
      const text = paper && y % 12 < 2 && x % 9 < 6;
      const v = paper ? (text ? 40 : 225) : 60;
      px[o] = v;
      px[o + 1] = v;
      px[o + 2] = paper ? v - 15 : v;
      px[o + 3] = 255;
    }
  }
  return px;
}

describe('document scanner', () => {
  it('splits dark from bright with Otsu', () => {
    const gray = new Uint8Array([...Array(50).fill(30), ...Array(50).fill(220)]);
    const t = otsuThreshold(gray);
    expect(t).toBeGreaterThanOrEqual(30);
    expect(t).toBeLessThan(220);
  });

  it('finds the corners of a tilted sheet', () => {
    const corners: [number, number][] = [
      [40, 20],
      [170, 35],
      [160, 140],
      [25, 125],
    ];
    const quad = detectDocument(photo(200, 160, corners), 200, 160);
    expect(quad).not.toBeNull();
    quad?.forEach((p, i) => {
      const [x, y] = corners[i] ?? [0, 0];
      expect(Math.abs(p.x * 200 - x)).toBeLessThan(4);
      expect(Math.abs(p.y * 160 - y)).toBeLessThan(4);
    });
  });

  it('gives up when there is no sheet', () => {
    const flat = new Uint8ClampedArray(100 * 100 * 4).fill(128);
    expect(detectDocument(flat, 100, 100)).toBeNull();
  });

  it('pulls an axis-aligned quad straight like a crop', () => {
    const w = 40;
    const h = 30;
    const src = new Uint8ClampedArray(w * h * 4);
    for (let p = 0; p < w * h; p++) {
      src[p * 4] = p % w;
      src[p * 4 + 1] = Math.floor(p / w);
      src[p * 4 + 3] = 255;
    }
    const q: Quad = [
      { x: 10 / w, y: 5 / h },
      { x: 30 / w, y: 5 / h },
      { x: 30 / w, y: 25 / h },
      { x: 10 / w, y: 25 / h },
    ];
    const out = warpPerspective(src, w, h, q, 20, 20);
    // Output pixel (0,0) samples photo pixel (10,5), (19,19) samples (29,24).
    expect([out[0], out[1]]).toEqual([10, 5]);
    const last = (19 * 20 + 19) * 4;
    expect([out[last], out[last + 1]]).toEqual([29, 24]);
  });

  it('refuses degenerate corners', () => {
    const p = { x: 0.5, y: 0.5 };
    expect(homography([p, p, p, p], 10, 10, 100, 100)).toBeNull();
    expect(quadArea([p, p, p, p])).toBe(0);
  });

  it('sizes the page after its edges and caps the long side', () => {
    const q: Quad = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    expect(outputSize(q, 1000, 1414)).toEqual({ width: 1000, height: 1414 });
    expect(outputSize(q, 4000, 5656, 2000)).toEqual({ width: 1414, height: 2000 });
  });

  it('makes pure black and white and white paper', () => {
    const corners: [number, number][] = [
      [0, 0],
      [60, 0],
      [60, 60],
      [0, 60],
    ];
    const px = photo(60, 60, corners);
    const bw = px.slice();
    enhanceScan(bw, 60, 60, 'bw');
    expect(new Set([...bw].filter((_, i) => i % 4 !== 3))).toEqual(new Set([0, 255]));
    const color = px.slice();
    enhanceScan(color, 60, 60, 'color');
    // A paper pixel (row 5) becomes (nearly) white in every channel.
    const o = (5 * 60 + 3) * 4;
    expect(color[o]).toBeGreaterThan(245);
    expect(color[o + 2]).toBeGreaterThan(245);
  });

  it('turns pictures by 90°', () => {
    const px = new Uint8ClampedArray([1, 0, 0, 255, 2, 0, 0, 255]); // 2×1
    const r = rotate90(px, 2, 1);
    expect([r.width, r.height]).toEqual([1, 2]);
    expect([r.pixels[0], r.pixels[4]]).toEqual([1, 2]);
  });
});
