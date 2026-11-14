/**
 * Document scanner: a photo of a sheet of paper becomes a straight, clean
 * page. Find the sheet (its four corners), pull it straight (perspective
 * correction), then clean it up (contrast, greyscale or black & white).
 * Pure functions on RGBA pixels – no OpenCV needed.
 */

export interface Point {
  x: number;
  y: number;
}

/** Corners of the sheet as fractions (0–1) of the photo: top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Point, Point, Point, Point];

export const SCAN_FILTERS = ['color', 'gray', 'bw', 'original'] as const;
export type ScanFilter = (typeof SCAN_FILTERS)[number];

/** Corners a bit inside the photo – the start when no sheet was found. */
export const DEFAULT_QUAD: Quad = [
  { x: 0.05, y: 0.05 },
  { x: 0.95, y: 0.05 },
  { x: 0.95, y: 0.95 },
  { x: 0.05, y: 0.95 },
];

function luminance(px: Uint8ClampedArray | Uint8Array, i: number): number {
  return ((px[i] ?? 0) * 299 + (px[i + 1] ?? 0) * 587 + (px[i + 2] ?? 0) * 114) / 1000;
}

/** Otsu's method: the grey value that best splits dark from bright. */
export function otsuThreshold(gray: Uint8Array): number {
  const hist = new Float64Array(256);
  for (const g of gray) hist[g] = (hist[g] ?? 0) + 1;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * (hist[i] ?? 0);
  let sumB = 0;
  let weightB = 0;
  let best = 0;
  let threshold = 127;
  for (let t = 0; t < 256; t++) {
    weightB += hist[t] ?? 0;
    if (weightB === 0) continue;
    const weightF = total - weightB;
    if (weightF === 0) break;
    sumB += t * (hist[t] ?? 0);
    const meanB = sumB / weightB;
    const meanF = (sum - sumB) / weightF;
    const between = weightB * weightF * (meanB - meanF) ** 2;
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

/**
 * Finds the sheet of paper in a (small) photo: paper is usually brighter
 * than the table it lies on. Takes the largest bright area and its four
 * outermost points. Returns null when nothing sheet-like is found – then the
 * user sets the corners by hand.
 */
export function detectDocument(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): Quad | null {
  const n = width * height;
  if (n === 0) return null;
  // Grey picture, softened a little (3×3 box) so text and noise don't break the sheet apart.
  const raw = new Uint8Array(n);
  for (let p = 0; p < n; p++) raw[p] = luminance(rgba, p * 4);
  const gray = new Uint8Array(n);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let s = 0;
      let c = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
          s += raw[yy * width + xx] ?? 0;
          c++;
        }
      }
      gray[y * width + x] = s / c;
    }
  }
  const threshold = otsuThreshold(gray);
  const bright = new Uint8Array(n);
  for (let p = 0; p < n; p++) bright[p] = (gray[p] ?? 0) > threshold ? 1 : 0;

  // Largest connected bright area (4-neighbourhood, iterative flood fill).
  const label = new Int32Array(n).fill(-1);
  const stack = new Int32Array(n);
  let bestLabel = -1;
  let bestSize = 0;
  let next = 0;
  for (let start = 0; start < n; start++) {
    if (!bright[start] || label[start] !== -1) continue;
    let top = 0;
    stack[top++] = start;
    label[start] = next;
    let size = 0;
    while (top > 0) {
      const p = stack[--top] ?? 0;
      size++;
      const x = p % width;
      const neighbours = [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, p - width, p + width];
      for (const q of neighbours) {
        if (q < 0 || q >= n || !bright[q] || label[q] !== -1) continue;
        label[q] = next;
        stack[top++] = q;
      }
    }
    if (size > bestSize) {
      bestSize = size;
      bestLabel = next;
    }
    next++;
  }
  // Too small to be the sheet, or everything is bright (photo of the page only).
  if (bestLabel < 0 || bestSize < n * 0.12 || bestSize > n * 0.97) return null;

  let tl = { s: Infinity, x: 0, y: 0 };
  let br = { s: -Infinity, x: 0, y: 0 };
  let tr = { s: -Infinity, x: 0, y: 0 };
  let bl = { s: Infinity, x: 0, y: 0 };
  for (let p = 0; p < n; p++) {
    if (label[p] !== bestLabel) continue;
    const x = p % width;
    const y = (p - x) / width;
    if (x + y < tl.s) tl = { s: x + y, x, y };
    if (x + y > br.s) br = { s: x + y, x, y };
    if (x - y > tr.s) tr = { s: x - y, x, y };
    if (x - y < bl.s) bl = { s: x - y, x, y };
  }
  const f = (c: { x: number; y: number }): Point => ({
    x: (c.x + 0.5) / width,
    y: (c.y + 0.5) / height,
  });
  const quad: Quad = [f(tl), f(tr), f(br), f(bl)];
  return quadArea(quad) > 0.08 ? quad : null;
}

/** Area of the quad as a fraction of the photo (shoelace formula). */
export function quadArea(q: Quad): number {
  let a = 0;
  for (let i = 0; i < 4; i++) {
    const p = q[i] as Point;
    const r = q[(i + 1) % 4] as Point;
    a += p.x * r.y - r.x * p.y;
  }
  return Math.abs(a) / 2;
}

/**
 * Size of the straightened page in pixels: the average lengths of opposite
 * edges (in photo pixels), scaled so the long side is at most `maxSide`.
 */
export function outputSize(q: Quad, photoW: number, photoH: number, maxSide = 2400) {
  const d = (a: Point, b: Point) => Math.hypot((a.x - b.x) * photoW, (a.y - b.y) * photoH);
  const [tl, tr, br, bl] = q;
  const w = (d(tl, tr) + d(bl, br)) / 2;
  const h = (d(tl, bl) + d(tr, br)) / 2;
  const scale = Math.min(1, maxSide / Math.max(w, h, 1));
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

/** Solves A·x = b (8×8) with Gaussian elimination; null if the corners are degenerate. */
function solve(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i] ?? 0]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r]?.[col] ?? 0) > Math.abs(m[pivot]?.[col] ?? 0)) pivot = r;
    }
    const pr = m[pivot];
    if (!pr || Math.abs(pr[col] ?? 0) < 1e-12) return null;
    [m[col], m[pivot]] = [pr, m[col] ?? pr];
    const row = m[col] ?? pr;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const target = m[r];
      if (!target) continue;
      const factor = (target[col] ?? 0) / (row[col] ?? 1);
      for (let c = col; c <= n; c++) target[c] = (target[c] ?? 0) - factor * (row[c] ?? 0);
    }
  }
  return m.map((row, i) => (row[n] ?? 0) / (row[i] ?? 1));
}

/**
 * The perspective transform (homography) that maps the output rectangle
 * (0…w, 0…h) onto the quad in the photo – so every output pixel knows where
 * to look in the photo.
 */
export function homography(
  q: Quad,
  outW: number,
  outH: number,
  photoW: number,
  photoH: number,
): number[] | null {
  const src: [number, number][] = [
    [0, 0],
    [outW, 0],
    [outW, outH],
    [0, outH],
  ];
  const a: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i] ?? [0, 0];
    const u = (q[i]?.x ?? 0) * photoW;
    const v = (q[i]?.y ?? 0) * photoH;
    a.push([x, y, 1, 0, 0, 0, -x * u, -y * u]);
    b.push(u);
    a.push([0, 0, 0, x, y, 1, -x * v, -y * v]);
    b.push(v);
  }
  const h = solve(a, b);
  return h ? [...h, 1] : null;
}

/** Pulls the quad straight: a new RGBA picture of `outW`×`outH` (bilinear sampling). */
export function warpPerspective(
  src: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  q: Quad,
  outW: number,
  outH: number,
): Uint8ClampedArray<ArrayBuffer> {
  const h = homography(q, outW, outH, srcW, srcH);
  const out = new Uint8ClampedArray(outW * outH * 4);
  if (!h) return out;
  const [h0, h1, h2, h3, h4, h5, h6, h7, h8] = h as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const w = h6 * px + h7 * py + h8;
      const u = (h0 * px + h1 * py + h2) / w - 0.5;
      const v = (h3 * px + h4 * py + h5) / w - 0.5;
      const x0 = Math.max(0, Math.min(srcW - 1, Math.floor(u)));
      const y0 = Math.max(0, Math.min(srcH - 1, Math.floor(v)));
      const x1 = Math.min(srcW - 1, x0 + 1);
      const y1 = Math.min(srcH - 1, y0 + 1);
      const fx = Math.max(0, Math.min(1, u - x0));
      const fy = Math.max(0, Math.min(1, v - y0));
      const o = (y * outW + x) * 4;
      for (let c = 0; c < 3; c++) {
        const a = src[(y0 * srcW + x0) * 4 + c] ?? 0;
        const b = src[(y0 * srcW + x1) * 4 + c] ?? 0;
        const cc = src[(y1 * srcW + x0) * 4 + c] ?? 0;
        const d = src[(y1 * srcW + x1) * 4 + c] ?? 0;
        out[o + c] = (a * (1 - fx) + b * fx) * (1 - fy) + (cc * (1 - fx) + d * fx) * fy;
      }
      out[o + 3] = 255;
    }
  }
  return out;
}

/** Value below which `share` of the pixels lie (from a 256-step histogram). */
function percentile(hist: Float64Array, total: number, share: number): number {
  let seen = 0;
  for (let i = 0; i < 256; i++) {
    seen += hist[i] ?? 0;
    if (seen >= total * share) return i;
  }
  return 255;
}

/**
 * Cleans up a straightened page in place:
 * - color: stretches the contrast and makes the paper white (removes the yellow/grey cast)
 * - gray: the same in greyscale
 * - bw: black and white with a local threshold (copes with shadows across the page)
 * - original: unchanged
 */
export function enhanceScan(
  px: Uint8ClampedArray,
  width: number,
  height: number,
  filter: ScanFilter,
) {
  if (filter === 'original') return;
  const n = width * height;
  if (filter === 'bw') {
    const gray = new Float64Array(n);
    for (let p = 0; p < n; p++) gray[p] = luminance(px, p * 4);
    // Integral image → mean of the neighbourhood in constant time.
    const integral = new Float64Array((width + 1) * (height + 1));
    for (let y = 0; y < height; y++) {
      let row = 0;
      for (let x = 0; x < width; x++) {
        row += gray[y * width + x] ?? 0;
        integral[(y + 1) * (width + 1) + x + 1] = (integral[y * (width + 1) + x + 1] ?? 0) + row;
      }
    }
    const r = Math.max(4, Math.round(Math.max(width, height) / 40));
    for (let y = 0; y < height; y++) {
      const y0 = Math.max(0, y - r);
      const y1 = Math.min(height, y + r + 1);
      for (let x = 0; x < width; x++) {
        const x0 = Math.max(0, x - r);
        const x1 = Math.min(width, x + r + 1);
        const sum =
          (integral[y1 * (width + 1) + x1] ?? 0) -
          (integral[y0 * (width + 1) + x1] ?? 0) -
          (integral[y1 * (width + 1) + x0] ?? 0) +
          (integral[y0 * (width + 1) + x0] ?? 0);
        const mean = sum / ((x1 - x0) * (y1 - y0));
        const value = (gray[y * width + x] ?? 0) < mean * 0.86 ? 0 : 255;
        const o = (y * width + x) * 4;
        px[o] = px[o + 1] = px[o + 2] = value;
      }
    }
    return;
  }
  const hist = new Float64Array(256);
  for (let p = 0; p < n; p++) {
    const l = Math.round(luminance(px, p * 4));
    hist[l] = (hist[l] ?? 0) + 1;
  }
  const black = percentile(hist, n, 0.02);
  // The paper: most pixels of a document are background, so a high percentile is "white".
  const white = Math.max(black + 1, percentile(hist, n, 0.9));
  // Per-channel white point removes the colour cast of indoor light.
  const sums = [0, 0, 0];
  let count = 0;
  for (let p = 0; p < n; p++) {
    const o = p * 4;
    if (luminance(px, o) < white) continue;
    sums[0] = (sums[0] ?? 0) + (px[o] ?? 0);
    sums[1] = (sums[1] ?? 0) + (px[o + 1] ?? 0);
    sums[2] = (sums[2] ?? 0) + (px[o + 2] ?? 0);
    count++;
  }
  const paper = sums.map((s) => (count ? s / count : 255));
  for (let p = 0; p < n; p++) {
    const o = p * 4;
    if (filter === 'gray') {
      const l = luminance(px, o);
      const v = ((l - black) / (white - black)) * 255;
      px[o] = px[o + 1] = px[o + 2] = v;
    } else {
      for (let c = 0; c < 3; c++) {
        const top = Math.max(black + 1, paper[c] ?? 255);
        px[o + c] = (((px[o + c] ?? 0) - black) / (top - black)) * 255;
      }
    }
  }
}

/** Turns RGBA pixels by 90° clockwise. */
export function rotate90(px: Uint8ClampedArray, width: number, height: number) {
  const out = new Uint8ClampedArray(px.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const from = (y * width + x) * 4;
      const nx = height - 1 - y;
      const to = (x * height + nx) * 4;
      out[to] = px[from] ?? 0;
      out[to + 1] = px[from + 1] ?? 0;
      out[to + 2] = px[from + 2] ?? 0;
      out[to + 3] = px[from + 3] ?? 0;
    }
  }
  return { pixels: out, width: height, height: width };
}
