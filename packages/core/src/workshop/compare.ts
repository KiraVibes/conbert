/**
 * Compare two files: line by line for text, pixel by pixel for pictures and
 * byte by byte for everything else. Pure functions; the browser reads the
 * files and draws the results.
 */

// --- Text --------------------------------------------------------------------

export type DiffOp =
  | { kind: 'same'; a: number; b: number; text: string }
  | { kind: 'del'; a: number; text: string }
  | { kind: 'add'; b: number; text: string };

/** Above this many changed lines the comparison stops (it would get slow and unreadable). */
export const DIFF_MAX_EDITS = 20_000;
export const TEXT_COMPARE_MAX_BYTES = 10 * 1024 * 1024;

export function splitLines(text: string): string[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  // A final line break doesn't make an extra empty line.
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * Line diff (Myers' O(ND) algorithm, like `diff` and git use): the shortest
 * list of deleted/added lines that turns `a` into `b`. Returns null when more
 * than `maxEdits` lines differ.
 */
export function diffLines(
  a: readonly string[],
  b: readonly string[],
  maxEdits = DIFF_MAX_EDITS,
): DiffOp[] | null {
  // Same start and end are cut off first – often most of the file.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const n = endA - start;
  const m = endB - start;
  const max = Math.min(n + m, maxEdits);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = n === 0 && m === 0;
  for (let d = 0; d <= max && !found; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && (v[offset + k - 1] ?? 0) < (v[offset + k + 1] ?? 0))
          ? (v[offset + k + 1] ?? 0)
          : (v[offset + k - 1] ?? 0) + 1;
      let y = x - k;
      while (x < n && y < m && a[start + x] === b[start + y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = true;
        break;
      }
    }
  }
  if (!found) return null;

  // Walk back through the trace to collect the edits.
  const middle: DiffOp[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0 && (x > 0 || y > 0); d--) {
    const tv = trace[d] ?? v;
    const k = x - y;
    const down =
      k === -d || (k !== d && (tv[offset + k - 1] ?? 0) < (tv[offset + k + 1] ?? 0));
    const prevK = down ? k + 1 : k - 1;
    const prevX = tv[offset + prevK] ?? 0;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
      middle.push({ kind: 'same', a: start + x, b: start + y, text: a[start + x] ?? '' });
    }
    if (d === 0) break;
    if (down) {
      y--;
      middle.push({ kind: 'add', b: start + y, text: b[start + y] ?? '' });
    } else {
      x--;
      middle.push({ kind: 'del', a: start + x, text: a[start + x] ?? '' });
    }
    x = prevX;
    y = prevY;
  }
  middle.reverse();

  const ops: DiffOp[] = [];
  for (let i = 0; i < start; i++) ops.push({ kind: 'same', a: i, b: i, text: a[i] ?? '' });
  ops.push(...middle);
  for (let i = 0; i < a.length - endA; i++) {
    ops.push({ kind: 'same', a: endA + i, b: endB + i, text: a[endA + i] ?? '' });
  }
  return ops;
}

export interface DiffStats {
  added: number;
  removed: number;
  same: number;
}

export function diffStats(ops: readonly DiffOp[]): DiffStats {
  const stats = { added: 0, removed: 0, same: 0 };
  for (const op of ops) {
    if (op.kind === 'add') stats.added++;
    else if (op.kind === 'del') stats.removed++;
    else stats.same++;
  }
  return stats;
}

export type DiffRow = DiffOp | { kind: 'skip'; count: number };

/** Long unchanged stretches fold into "… n same lines …", keeping `context` lines around changes. */
export function foldDiff(ops: readonly DiffOp[], context = 3): DiffRow[] {
  const keep = new Uint8Array(ops.length);
  ops.forEach((op, i) => {
    if (op.kind === 'same') return;
    for (let j = Math.max(0, i - context); j <= Math.min(ops.length - 1, i + context); j++) {
      keep[j] = 1;
    }
  });
  const rows: DiffRow[] = [];
  let skipped = 0;
  ops.forEach((op, i) => {
    if (keep[i]) {
      if (skipped > 0) rows.push({ kind: 'skip', count: skipped });
      skipped = 0;
      rows.push(op);
    } else {
      skipped++;
    }
  });
  if (skipped > 0) rows.push({ kind: 'skip', count: skipped });
  return rows;
}

// --- Bytes -------------------------------------------------------------------

export interface ByteRange {
  start: number;
  /** Exclusive. */
  end: number;
}

export interface ByteComparison {
  sizeA: number;
  sizeB: number;
  /** Offset of the first difference (also when one file is just longer), or null if identical. */
  firstDiff: number | null;
  /** Differing bytes within the common length. */
  differing: number;
  /** The first differing stretches (at most `maxRanges`). */
  ranges: ByteRange[];
  /** More stretches than listed. */
  moreRanges: boolean;
}

/** Bytes that are equal again within this gap still count to the same stretch. */
const RANGE_GAP = 8;

/** Compares two files piece by piece: feed equally long pieces from the same offset. */
export function createByteCompare(sizeA: number, sizeB: number, maxRanges = 200) {
  let differing = 0;
  let firstDiff: number | null = null;
  const ranges: ByteRange[] = [];
  let moreRanges = false;
  let open: ByteRange | null = null;
  const close = () => {
    if (!open) return;
    if (ranges.length < maxRanges) ranges.push(open);
    else moreRanges = true;
    open = null;
  };
  return {
    feed(a: Uint8Array, b: Uint8Array, offset: number) {
      const n = Math.min(a.length, b.length);
      for (let i = 0; i < n; i++) {
        if (a[i] === b[i]) continue;
        const at = offset + i;
        differing++;
        firstDiff ??= at;
        if (open && at - open.end <= RANGE_GAP) open.end = at + 1;
        else {
          close();
          open = { start: at, end: at + 1 };
        }
      }
    },
    result(): ByteComparison {
      close();
      const common = Math.min(sizeA, sizeB);
      if (sizeA !== sizeB) {
        firstDiff ??= common;
        if (ranges.length < maxRanges) ranges.push({ start: common, end: Math.max(sizeA, sizeB) });
        else moreRanges = true;
      }
      return { sizeA, sizeB, firstDiff, differing, ranges, moreRanges };
    },
  };
}

// --- Pictures ----------------------------------------------------------------

export interface PixelDiff {
  /** Pixels that differ by more than the tolerance. */
  changed: number;
  total: number;
  /** Strongest difference found (0–255). */
  maxDelta: number;
  /** RGBA picture: the first picture faded out, changed pixels in bright red. */
  mask: Uint8ClampedArray<ArrayBuffer>;
}

/**
 * Compares two pictures of the same size. `tolerance` (0–255) ignores tiny
 * differences such as JPEG noise; transparency counts as a colour channel.
 */
export function diffPixels(
  a: Uint8ClampedArray,
  b: Uint8ClampedArray,
  tolerance = 16,
): PixelDiff {
  const total = Math.floor(Math.min(a.length, b.length) / 4);
  const mask = new Uint8ClampedArray(total * 4);
  let changed = 0;
  let maxDelta = 0;
  for (let p = 0; p < total; p++) {
    const o = p * 4;
    const delta = Math.max(
      Math.abs((a[o] ?? 0) - (b[o] ?? 0)),
      Math.abs((a[o + 1] ?? 0) - (b[o + 1] ?? 0)),
      Math.abs((a[o + 2] ?? 0) - (b[o + 2] ?? 0)),
      Math.abs((a[o + 3] ?? 0) - (b[o + 3] ?? 0)),
    );
    if (delta > maxDelta) maxDelta = delta;
    if (delta > tolerance) {
      changed++;
      mask[o] = 255;
      mask[o + 1] = 0;
      mask[o + 2] = 60;
      mask[o + 3] = 255;
    } else {
      // Faded greyscale of the original, so you still see where you are.
      const g = ((a[o] ?? 0) * 0.3 + (a[o + 1] ?? 0) * 0.59 + (a[o + 2] ?? 0) * 0.11) * 0.35 + 160;
      mask[o] = mask[o + 1] = mask[o + 2] = g;
      mask[o + 3] = 255;
    }
  }
  return { changed, total, maxDelta, mask };
}
