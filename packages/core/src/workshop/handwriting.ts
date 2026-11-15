/**
 * Your handwriting as a font. A printable sheet has one box per character and
 * four black squares in the corners. A photo or scan of the filled sheet is
 * pulled straight on those squares; each box's ink becomes smooth outlines.
 * The font file itself is written in the browser (opentype.js).
 */
import type { Point } from './scanner';

/** The characters on the sheet, in order. */
export const HANDWRITING_CHARS = [
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  ...'abcdefghijklmnopqrstuvwxyz',
  ...'0123456789',
  ...'ÄÖÜäöüß',
  ...'.,;:!?-\'"()&+=/@€#%*_<>',
] as const;

/* Sheet layout in mm (A4, origin top-left). */
export const SHEET = {
  width: 210,
  height: 297,
  /** Corner squares: top-left corners and side. */
  marker: 9,
  markers: [
    [10, 10],
    [191, 10],
    [191, 278],
    [10, 278],
  ] as [number, number][],
  cols: 8,
  rows: 12,
  gridX: 15,
  gridY: 30,
  cellW: 22.5,
  cellH: 20.2,
  /** Top strip of each box with the printed character (not part of the writing). */
  label: 4,
  /** Gap kept free inside the box border. */
  inset: 1.2,
  /** Baseline: share of the writing area's height from its top. */
  baseline: 0.68,
  /** x-height guide (where small letters end), share from the top. */
  xHeight: 0.36,
};

/** Marker centres in mm. */
export function markerCenters(): [number, number][] {
  return SHEET.markers.map(([x, y]) => [x + SHEET.marker / 2, y + SHEET.marker / 2]);
}

/** The writing area of box i in mm (inside the border, below the label). */
export function cellWritingArea(i: number) {
  const col = i % SHEET.cols;
  const row = Math.floor(i / SHEET.cols);
  const x = SHEET.gridX + col * SHEET.cellW + SHEET.inset;
  const y = SHEET.gridY + row * SHEET.cellH + SHEET.label;
  return { x, y, w: SHEET.cellW - 2 * SHEET.inset, h: SHEET.cellH - SHEET.label - SHEET.inset };
}

/** Box i (whole box incl. label) in mm. */
export function cellBox(i: number) {
  const col = i % SHEET.cols;
  const row = Math.floor(i / SHEET.cols);
  return {
    x: SHEET.gridX + col * SHEET.cellW,
    y: SHEET.gridY + row * SHEET.cellH,
    w: SHEET.cellW,
    h: SHEET.cellH,
  };
}

/* ------------------------------------------------------- finding the sheet */

/**
 * The four corner squares in a greyscale picture (top-left, top-right,
 * bottom-right, bottom-left) as pixel centres, or null if they aren't all there.
 */
export function findCornerMarkers(gray: Uint8Array, w: number, h: number): Point[] | null {
  // Dark = clearly darker than the paper around it (global split is enough
  // for big solid squares; shadows only make the paper darker, not black).
  const sorted = Uint8Array.from(gray).sort();
  const paper = sorted[Math.floor(sorted.length * 0.9)] ?? 255;
  const limit = paper * 0.5;
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  const found: { x: number; y: number; size: number }[] = [];
  const minSide = Math.min(w, h) * 0.015;
  const maxSide = Math.min(w, h) * 0.12;
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || (gray[start] ?? 255) > limit) continue;
    let area = 0;
    let x0 = w;
    let y0 = h;
    let x1 = 0;
    let y1 = 0;
    let sx = 0;
    let sy = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const p = stack.pop() ?? 0;
      const x = p % w;
      const y = (p - x) / w;
      area++;
      sx += x;
      sy += y;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (const q of [p - 1, p + 1, p - w, p + w]) {
        if (q < 0 || q >= w * h || seen[q]) continue;
        if ((q === p - 1 && x === 0) || (q === p + 1 && x === w - 1)) continue;
        if ((gray[q] ?? 255) > limit) continue;
        seen[q] = 1;
        stack.push(q);
      }
    }
    const bw = x1 - x0 + 1;
    const bh = y1 - y0 + 1;
    // A filled square seen at an angle: about square, mostly filled.
    if (bw < minSide || bh < minSide || bw > maxSide || bh > maxSide) continue;
    if (bw / bh > 1.6 || bh / bw > 1.6) continue;
    if (area / (bw * bh) < 0.6) continue;
    found.push({ x: sx / area, y: sy / area, size: Math.sqrt(area) });
  }
  if (found.length < 4) return null;
  const corners: Point[] = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
  const picked = corners.map((c) => {
    let best = found[0];
    let d0 = Infinity;
    for (const f of found) {
      const d = Math.hypot(f.x - c.x, f.y - c.y);
      if (d < d0) {
        d0 = d;
        best = f;
      }
    }
    return best;
  });
  if (new Set(picked).size < 4) return null;
  // The squares are all printed the same size.
  const sizes = picked.map((p) => p?.size ?? 0);
  if (Math.max(...sizes) > Math.min(...sizes) * 2.5) return null;
  return picked.map((p) => ({ x: p?.x ?? 0, y: p?.y ?? 0 }));
}

/* ------------------------------------------------------------ ink → outline */

export type GlyphCommand =
  | { type: 'M'; x: number; y: number }
  | { type: 'Q'; x1: number; y1: number; x: number; y: number }
  | { type: 'Z' };

export interface Glyph {
  /** Outline in font units (y up, baseline 0). */
  commands: GlyphCommand[];
  /** Horizontal advance in font units. */
  advance: number;
  /** The ink reaches the edge of the writing area – part of it may be cut off. */
  clipped: boolean;
}

export const UNITS_PER_EM = 1000;

/** Font units per mm: the space from baseline to the top of the box is 800 units. */
export function unitsPerMm(): number {
  const area = cellWritingArea(0);
  return 800 / (area.h * SHEET.baseline);
}

/**
 * Removes specks: groups of ink pixels smaller than `min` (dust, scanner noise).
 */
function dropSpecks(mask: Uint8Array, w: number, h: number, min: number) {
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  const group: number[] = [];
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || seen[s]) continue;
    group.length = 0;
    stack.push(s);
    seen[s] = 1;
    while (stack.length) {
      const p = stack.pop() ?? 0;
      group.push(p);
      const x = p % w;
      for (const q of [p - 1, p + 1, p - w, p + w]) {
        if (q < 0 || q >= w * h || seen[q] || !mask[q]) continue;
        if ((q === p - 1 && x === 0) || (q === p + 1 && x === w - 1)) continue;
        seen[q] = 1;
        stack.push(q);
      }
    }
    if (group.length < min) for (const p of group) mask[p] = 0;
  }
}

/** Douglas–Peucker: fewer points, same shape (within eps). */
function simplify(points: Point[], eps: number): Point[] {
  if (points.length < 4) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop() ?? [0, 0];
    const pa = points[a] ?? { x: 0, y: 0 };
    const pb = points[b] ?? { x: 0, y: 0 };
    const dx = pb.x - pa.x;
    const dy = pb.y - pa.y;
    const len = Math.hypot(dx, dy) || 1;
    let far = -1;
    let d0 = eps;
    for (let i = a + 1; i < b; i++) {
      const p = points[i] ?? { x: 0, y: 0 };
      const d = Math.abs(dy * (p.x - pa.x) - dx * (p.y - pa.y)) / len;
      if (d > d0) {
        d0 = d;
        far = i;
      }
    }
    if (far > 0) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Simplifies a closed loop: split at the point farthest from the start, both halves on their own. */
function simplifyLoop(loop: Point[], eps: number): Point[] {
  const p0 = loop[0];
  if (!p0 || loop.length < 4) return loop;
  let far = 0;
  let d0 = -1;
  loop.forEach((p, i) => {
    const d = Math.hypot(p.x - p0.x, p.y - p0.y);
    if (d > d0) {
      d0 = d;
      far = i;
    }
  });
  const a = simplify(loop.slice(0, far + 1), eps);
  const b = simplify([...loop.slice(far), p0], eps);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

/**
 * Outlines of the ink (marching squares on a softened mask), each a closed
 * loop of points in pixel coordinates. Outer loops and holes run opposite ways.
 */
export function traceOutlines(mask: Uint8Array, w: number, h: number): Point[][] {
  // Soften (3×3 average) with a free border, so loops close and edges are smooth.
  const W = w + 2;
  const H = h + 2;
  const f = new Float32Array(W * H);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < w && yy < h) s += mask[yy * w + xx] ?? 0;
        }
      f[(y + 1) * W + x + 1] = s / 9;
    }
  const v = (x: number, y: number) => f[y * W + x] ?? 0;
  const iso = 0.5;
  const at = (a: number, b: number) => (iso - a) / (b - a || 1e-9);
  const points = new Map<string, Point>();
  const next = new Map<string, string>();
  const pt = (key: string, p: Point) => {
    if (!points.has(key)) points.set(key, p);
    return key;
  };
  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W - 1; x++) {
      const tl = v(x, y);
      const tr = v(x + 1, y);
      const br = v(x + 1, y + 1);
      const bl = v(x, y + 1);
      const c =
        (tl >= iso ? 8 : 0) | (tr >= iso ? 4 : 0) | (br >= iso ? 2 : 0) | (bl >= iso ? 1 : 0);
      if (c === 0 || c === 15) continue;
      const T = () => pt(`h${y},${x}`, { x: x + at(tl, tr), y });
      const B = () => pt(`h${y + 1},${x}`, { x: x + at(bl, br), y: y + 1 });
      const L = () => pt(`v${y},${x}`, { x, y: y + at(tl, bl) });
      const R = () => pt(`v${y},${x + 1}`, { x: x + 1, y: y + at(tr, br) });
      // Segments with the ink on the left (picture coordinates, y down).
      const seg = (a: string, b: string) => next.set(a, b);
      switch (c) {
        case 8:
          seg(L(), T());
          break;
        case 4:
          seg(T(), R());
          break;
        case 2:
          seg(R(), B());
          break;
        case 1:
          seg(B(), L());
          break;
        case 7:
          seg(T(), L());
          break;
        case 11:
          seg(R(), T());
          break;
        case 13:
          seg(B(), R());
          break;
        case 14:
          seg(L(), B());
          break;
        case 12:
          seg(L(), R());
          break;
        case 6:
          seg(T(), B());
          break;
        case 3:
          seg(R(), L());
          break;
        case 9:
          seg(B(), T());
          break;
        case 10:
          seg(L(), T());
          seg(R(), B());
          break;
        case 5:
          seg(T(), R());
          seg(B(), L());
          break;
      }
    }
  }
  const loops: Point[][] = [];
  const used = new Set<string>();
  for (const start of next.keys()) {
    if (used.has(start)) continue;
    const loop: Point[] = [];
    let k: string | undefined = start;
    while (k && !used.has(k)) {
      used.add(k);
      const p = points.get(k);
      // Back to the original pixel grid (the border added one pixel).
      if (p) loop.push({ x: p.x - 1, y: p.y - 1 });
      k = next.get(k);
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

const area = (loop: Point[]) => {
  let a = 0;
  for (let i = 0; i < loop.length; i++) {
    const p = loop[i] ?? { x: 0, y: 0 };
    const q = loop[(i + 1) % loop.length] ?? { x: 0, y: 0 };
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
};

/**
 * One box of the sheet (greyscale, straightened) → glyph, or null when the
 * box is empty. `pxPerMm` is the picture's resolution.
 */
export function glyphFromCell(
  gray: Uint8Array,
  w: number,
  h: number,
  pxPerMm: number,
): Glyph | null {
  // Ink = clearly darker than this box's paper. Guide lines are light and stay out.
  const sorted = Uint8Array.from(gray).sort();
  const paper = sorted[Math.floor(sorted.length * 0.9)] ?? 255;
  const limit = paper * 0.62;
  const mask = new Uint8Array(w * h);
  // Leave the outermost pixels: bits of the box border after straightening.
  const edge = Math.max(1, Math.round(pxPerMm * 0.4));
  for (let y = edge; y < h - edge; y++)
    for (let x = edge; x < w - edge; x++)
      mask[y * w + x] = (gray[y * w + x] ?? 255) < limit ? 1 : 0;
  dropSpecks(mask, w, h, Math.max(6, Math.round(pxPerMm * pxPerMm * 0.25)));
  let ink = 0;
  let minX = w;
  let maxX = 0;
  let minY = h;
  let maxY = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (mask[y * w + x]) {
        ink++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
  if (ink < pxPerMm * pxPerMm * 0.8) return null;
  const scale = unitsPerMm() / pxPerMm;
  const baseY = h * SHEET.baseline;
  const side = 50;
  const toUnits = (p: Point): Point => ({
    x: Math.round((p.x - minX) * scale + side),
    y: Math.round((baseY - p.y) * scale),
  });
  let loops = traceOutlines(mask, w, h)
    .map((l) => simplifyLoop(l, 0.35).map(toUnits))
    .filter((l) => l.length >= 3 && Math.abs(area(l)) > 40);
  if (loops.length === 0) return null;
  // Fonts (CFF) want outer loops counter-clockwise (y up); holes the other way.
  const biggest = loops.reduce((a, b) => (Math.abs(area(b)) > Math.abs(area(a)) ? b : a));
  if (area(biggest) < 0) loops = loops.map((l) => [...l].reverse());
  const commands: GlyphCommand[] = [];
  for (const l of loops) {
    // Smooth: corners become control points, edge middles the points on the curve.
    const mid = (a: Point, b: Point): Point => ({
      x: Math.round((a.x + b.x) / 2),
      y: Math.round((a.y + b.y) / 2),
    });
    const n = l.length;
    const first = mid(l[n - 1] ?? { x: 0, y: 0 }, l[0] ?? { x: 0, y: 0 });
    commands.push({ type: 'M', ...first });
    for (let i = 0; i < n; i++) {
      const c = l[i] ?? { x: 0, y: 0 };
      const e = mid(c, l[(i + 1) % n] ?? { x: 0, y: 0 });
      commands.push({ type: 'Q', x1: c.x, y1: c.y, x: e.x, y: e.y });
    }
    commands.push({ type: 'Z' });
  }
  const clipped = minX <= edge || minY <= edge || maxX >= w - 1 - edge || maxY >= h - 1 - edge;
  return { commands, advance: Math.round((maxX - minX + 1) * scale + 2 * side), clipped };
}

/** A font name usable in the font file (letters, digits, spaces). */
export function cleanFontName(name: string): string {
  const s = name
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
  return s || 'My Handwriting';
}
