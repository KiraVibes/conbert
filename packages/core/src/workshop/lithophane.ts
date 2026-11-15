/**
 * Picture → 3D print. A lithophane is a thin plate whose thickness follows the
 * picture: held against the light, thick parts are dark and thin parts bright.
 * A relief raises a logo or drawing from a base plate.
 */

export const RELIEF_MODES = ['lithophane', 'relief'] as const;
export type ReliefMode = (typeof RELIEF_MODES)[number];

export interface ReliefOptions {
  mode: ReliefMode;
  /** Width of the plate (without frame) in mm. */
  widthMm: number;
  /** Lithophane: thinnest (brightest) and thickest (darkest) spot in mm. */
  minMm: number;
  maxMm: number;
  /** Relief: base plate and how far the shape stands out, in mm. */
  baseMm: number;
  raiseMm: number;
  /** Frame around the plate in mm (0 = none), as thick as the thickest spot. */
  frameMm: number;
  /** Swap dark and light. */
  invert: boolean;
}

export const DEFAULT_RELIEF: ReliefOptions = {
  mode: 'lithophane',
  widthMm: 100,
  minMm: 0.8,
  maxMm: 3,
  baseMm: 1.5,
  raiseMm: 2,
  frameMm: 3,
  invert: false,
};

/** How finely the picture is sampled: one height per this many mm. */
export const RELIEF_STEP_MM = 0.25;
/** Longest side in samples (keeps the STL at a few MB). */
export const RELIEF_MAX_SAMPLES = 500;

/** Grid size for a picture of w×h pixels at the chosen width. */
export function reliefGrid(w: number, h: number, widthMm: number) {
  const cols = Math.max(2, Math.min(RELIEF_MAX_SAMPLES, Math.round(widthMm / RELIEF_STEP_MM)));
  const scale = cols / w;
  let rows = Math.max(2, Math.round(h * scale));
  let c = cols;
  if (rows > RELIEF_MAX_SAMPLES) {
    c = Math.max(2, Math.round((cols * RELIEF_MAX_SAMPLES) / rows));
    rows = RELIEF_MAX_SAMPLES;
  }
  return { cols: c, rows };
}

/**
 * Heights in mm for each sample, from greyscale values (0 = black … 255 =
 * white, row by row) and an alpha mask (transparent counts as background).
 */
export function reliefHeights(
  gray: Uint8Array,
  alpha: Uint8Array | null,
  cols: number,
  rows: number,
  o: ReliefOptions,
): Float32Array {
  const out = new Float32Array(cols * rows);
  // Relief: dark (or opaque) parts are the shape. Split at the middle grey.
  for (let i = 0; i < out.length; i++) {
    let v = (gray[i] ?? 255) / 255;
    if (alpha && (alpha[i] ?? 255) < 128) v = 1;
    if (o.invert) v = 1 - v;
    out[i] =
      o.mode === 'lithophane'
        ? o.minMm + (1 - v) * (o.maxMm - o.minMm)
        : o.baseMm + (v < 0.5 ? o.raiseMm : 0);
  }
  return out;
}

/** Adds a frame: a border of `cells` samples at height `h` around the grid. */
export function addFrame(
  heights: Float32Array,
  cols: number,
  rows: number,
  cells: number,
  h: number,
) {
  if (cells <= 0) return { heights, cols, rows };
  const c2 = cols + 2 * cells;
  const r2 = rows + 2 * cells;
  const out = new Float32Array(c2 * r2).fill(h);
  for (let y = 0; y < rows; y++)
    out.set(heights.subarray(y * cols, (y + 1) * cols), (y + cells) * c2 + cells);
  return { heights: out, cols: c2, rows: r2 };
}

/**
 * A closed (watertight) binary STL: the height field on top, a flat bottom
 * and walls around. `step` is mm between samples. Picture row 0 is at the back.
 */
export function heightfieldStl(
  heights: Float32Array,
  cols: number,
  rows: number,
  step: number,
): Uint8Array {
  const top = 2 * (cols - 1) * (rows - 1);
  const ring = 2 * (cols - 1) + 2 * (rows - 1);
  const triangles = top + 2 * ring + ring;
  const out = new Uint8Array(84 + triangles * 50);
  const view = new DataView(out.buffer);
  const header = 'Conbert relief';
  for (let i = 0; i < header.length; i++) out[i] = header.charCodeAt(i);
  view.setUint32(80, triangles, true);
  let p = 84;
  const X = (c: number) => c * step;
  // Picture top = far side (larger y), as seen from above.
  const Y = (r: number) => (rows - 1 - r) * step;
  const Z = (c: number, r: number) => heights[r * cols + c] ?? 0;
  type V = [number, number, number];
  const tri = (a: V, b: V, c: V) => {
    // Normal from the corners (slicers recompute it anyway).
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    for (const v of [nx, ny, nz, ...a, ...b, ...c]) {
      view.setFloat32(p, v, true);
      p += 4;
    }
    p += 2;
  };
  const T = (c: number, r: number): V => [X(c), Y(r), Z(c, r)];
  const B = (c: number, r: number): V => [X(c), Y(r), 0];
  // Top: counter-clockwise seen from above (normals up).
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      tri(T(c, r + 1), T(c + 1, r + 1), T(c + 1, r));
      tri(T(c, r + 1), T(c + 1, r), T(c, r));
    }
  }
  // The outline, clockwise seen from above when walked in this order.
  const outline: [number, number][] = [];
  for (let c = 0; c < cols - 1; c++) outline.push([c, 0]);
  for (let r = 0; r < rows - 1; r++) outline.push([cols - 1, r]);
  for (let c = cols - 1; c > 0; c--) outline.push([c, rows - 1]);
  for (let r = rows - 1; r > 0; r--) outline.push([0, r]);
  const center: V = [X((cols - 1) / 2), Y((rows - 1) / 2), 0];
  for (let i = 0; i < outline.length; i++) {
    const [c0, r0] = outline[i] ?? [0, 0];
    const [c1, r1] = outline[(i + 1) % outline.length] ?? [0, 0];
    // Wall (normal outwards) and the bottom fan (normal down).
    tri(T(c0, r0), B(c1, r1), B(c0, r0));
    tri(T(c0, r0), T(c1, r1), B(c1, r1));
    tri(center, B(c0, r0), B(c1, r1));
  }
  return out;
}

/**
 * How a lithophane looks against light: light passing through gets weaker
 * the thicker the plate is. Returns brightness 0–255 per sample.
 */
export function backlitPreview(heights: Float32Array, minMm: number, maxMm: number): Uint8Array {
  const out = new Uint8Array(heights.length);
  // White PLA lets through roughly half the light per mm.
  const k = Math.log(2);
  const brightest = Math.exp(-k * minMm);
  const darkest = Math.exp(-k * maxMm);
  for (let i = 0; i < heights.length; i++) {
    const t = Math.exp(-k * (heights[i] ?? 0));
    out[i] = Math.round(Math.max(0, Math.min(1, (t - darkest) / (brightest - darkest || 1))) * 255);
  }
  return out;
}
