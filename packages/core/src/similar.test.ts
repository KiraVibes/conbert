import { describe, expect, it } from 'vitest';
import { dHash, groupSimilar, hashDistance } from './similar';

/** A 9 × 8 gradient, optionally with noise. */
const picture = (seed: number, noise = 0) =>
  Array.from({ length: 72 }, (_, i) => ((i * 37 + seed * 101) % 255) + ((i * 7) % 3) * noise);

describe('similar pictures', () => {
  it('makes a 64-bit hash', () => {
    const hash = dHash(picture(1));
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
    expect(hashDistance(hash, hash)).toBe(0);
    expect(() => dHash([1, 2, 3])).toThrow();
  });

  it('counts differing bits', () => {
    expect(hashDistance('0000000000000000', 'ffffffffffffffff')).toBe(64);
    expect(hashDistance('0000000000000000', '0000000000000003')).toBe(2);
    expect(hashDistance('8000000000000000', '0000000000000000')).toBe(1);
  });

  it('groups pictures that are close, also as a chain', () => {
    const groups = groupSimilar(
      [
        { id: 'a', hash: '0000000000000000' },
        { id: 'b', hash: '000000000000000f' }, // 4 from a
        { id: 'c', hash: '00000000000000ff' }, // 4 from b, 8 from a
        { id: 'd', hash: 'ffffffffffffffff' },
        { id: 'e', hash: 'fffffffffffffffe' },
        { id: 'f', hash: '0f0f0f0f0f0f0f0f' },
      ],
      4,
    );
    expect(groups.map((g) => [...g].sort())).toEqual([
      ['a', 'b', 'c'],
      ['d', 'e'],
    ]);
    expect(groupSimilar([{ id: 'x', hash: '0000000000000000' }], 8)).toEqual([]);
  });
});
