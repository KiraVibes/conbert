import { describe, expect, it } from 'vitest';
import {
  createByteCompare,
  diffLines,
  diffPixels,
  diffStats,
  foldDiff,
  splitLines,
  type DiffOp,
} from './compare';

/** Applies a diff to `a` – must give `b`. */
function apply(ops: DiffOp[]): { a: string[]; b: string[] } {
  return {
    a: ops.filter((o) => o.kind !== 'add').map((o) => o.text),
    b: ops.filter((o) => o.kind !== 'del').map((o) => o.text),
  };
}

describe('compare', () => {
  it('splits lines of any line ending without a trailing empty line', () => {
    expect(splitLines('a\r\nb\rc\n')).toEqual(['a', 'b', 'c']);
    expect(splitLines('')).toEqual(['']);
  });

  it('finds the shortest line diff', () => {
    const a = ['eins', 'zwei', 'drei', 'vier', 'fünf'];
    const b = ['eins', 'drei', 'vier', 'VIER', 'fünf', 'sechs'];
    const ops = diffLines(a, b);
    expect(ops).not.toBeNull();
    expect(apply(ops ?? [])).toEqual({ a, b });
    expect(diffStats(ops ?? [])).toEqual({ added: 2, removed: 1, same: 4 });
  });

  it('handles empty and identical files', () => {
    expect(diffLines([], [])).toEqual([]);
    expect(diffStats(diffLines(['x'], ['x']) ?? [])).toEqual({ added: 0, removed: 0, same: 1 });
    expect(diffStats(diffLines([], ['a', 'b']) ?? [])).toEqual({ added: 2, removed: 0, same: 0 });
  });

  it('works on random edits', () => {
    for (let round = 0; round < 30; round++) {
      const a = Array.from({ length: 40 }, () => String(Math.floor(Math.random() * 6)));
      const b = a.filter(() => Math.random() > 0.2).map((l) => (Math.random() > 0.9 ? 'x' : l));
      const ops = diffLines(a, b);
      expect(apply(ops ?? [])).toEqual({ a, b });
    }
  });

  it('gives up when too much differs', () => {
    expect(diffLines(['a', 'b', 'c'], ['x', 'y', 'z'], 2)).toBeNull();
  });

  it('folds long unchanged stretches', () => {
    const a = Array.from({ length: 20 }, (_, i) => `l${i}`);
    const b = [...a];
    b[10] = 'changed';
    const rows = foldDiff(diffLines(a, b) ?? [], 2);
    expect(rows[0]).toEqual({ kind: 'skip', count: 8 });
    expect(rows.at(-1)).toEqual({ kind: 'skip', count: 7 });
  });

  it('compares bytes in pieces and groups nearby differences', () => {
    const a = new Uint8Array(100);
    const b = new Uint8Array(104);
    b[10] = 1;
    b[12] = 1;
    b[60] = 1;
    const cmp = createByteCompare(a.length, b.length);
    cmp.feed(a.subarray(0, 50), b.subarray(0, 50), 0);
    cmp.feed(a.subarray(50), b.subarray(50, 100), 50);
    const r = cmp.result();
    expect(r.firstDiff).toBe(10);
    expect(r.differing).toBe(3);
    expect(r.ranges).toEqual([
      { start: 10, end: 13 },
      { start: 60, end: 61 },
      { start: 100, end: 104 },
    ]);
  });

  it('says identical files are identical', () => {
    const cmp = createByteCompare(3, 3);
    cmp.feed(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]), 0);
    expect(cmp.result().firstDiff).toBeNull();
  });

  it('counts changed pixels above the tolerance', () => {
    const a = new Uint8ClampedArray([0, 0, 0, 255, 10, 10, 10, 255, 0, 0, 0, 255]);
    const b = new Uint8ClampedArray([0, 0, 0, 255, 15, 10, 10, 255, 200, 0, 0, 255]);
    const d = diffPixels(a, b, 16);
    expect(d.changed).toBe(1);
    expect(d.maxDelta).toBe(200);
    expect([...d.mask.slice(8, 11)]).toEqual([255, 0, 60]);
  });
});
