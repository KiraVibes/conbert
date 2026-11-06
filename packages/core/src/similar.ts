/**
 * Similar pictures: a "difference hash" (dHash) per picture – 64 bits that
 * say where each row gets lighter or darker. Resized, recompressed or lightly
 * edited copies have almost the same bits; different pictures don't.
 */

/** The picture, scaled to 9 × 8 grey pixels (row by row). */
export const DHASH_WIDTH = 9;
export const DHASH_HEIGHT = 8;
/**
 * "Lighter" only counts above this difference: in flat areas (sky, plain
 * backgrounds) JPEG noise would otherwise flip bits at random.
 */
const DHASH_TOLERANCE = 3;

/** 64-bit dHash as 16 hex digits. */
export function dHash(grey: ArrayLike<number>): string {
  if (grey.length < DHASH_WIDTH * DHASH_HEIGHT) throw new Error('dHash needs 9 × 8 pixels');
  let hex = '';
  let nibble = 0;
  let bits = 0;
  for (let y = 0; y < DHASH_HEIGHT; y++) {
    for (let x = 0; x < DHASH_WIDTH - 1; x++) {
      const left = grey[y * DHASH_WIDTH + x] ?? 0;
      const right = grey[y * DHASH_WIDTH + x + 1] ?? 0;
      nibble = (nibble << 1) | (left - right > DHASH_TOLERANCE ? 1 : 0);
      if (++bits === 4) {
        hex += nibble.toString(16);
        nibble = 0;
        bits = 0;
      }
    }
  }
  return hex;
}

const POP = Array.from(
  { length: 16 },
  (_, n) => (n & 1) + ((n >> 1) & 1) + ((n >> 2) & 1) + (n >> 3),
);

/** How many of the 64 bits differ (0 = the same picture, ~32 = unrelated). */
export function hashDistance(a: string, b: string): number {
  let distance = 0;
  for (let i = 0; i < 16; i++) {
    distance += POP[parseInt(a[i] ?? '0', 16) ^ parseInt(b[i] ?? '0', 16)] ?? 0;
  }
  return distance;
}

/** How strict "similar" is: the most bits that may differ. */
export const SIMILARITY_LEVELS = { strict: 4, normal: 8, loose: 12 } as const;
export type SimilarityLevel = keyof typeof SIMILARITY_LEVELS;

/** Splits a hash into two 32-bit numbers for fast comparing. */
function words(hash: string): [number, number] {
  return [parseInt(hash.slice(0, 8), 16) >>> 0, parseInt(hash.slice(8, 16), 16) >>> 0];
}

function popcount32(n: number): number {
  let v = n - ((n >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/**
 * Groups of pictures that look alike (each with at least two members). A
 * picture joins a group when it is close to any member, so a group can hold
 * a chain of small edits.
 */
export function groupSimilar(
  items: readonly { id: string; hash: string }[],
  maxDistance: number,
): string[][] {
  const parsed = items.map((item) => words(item.hash));
  const parent = items.map((_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root] ?? root;
    while (parent[i] !== root) {
      const next = parent[i] ?? root;
      parent[i] = root;
      i = next;
    }
    return root;
  };
  for (let i = 0; i < parsed.length; i++) {
    const [a1, a2] = parsed[i] ?? [0, 0];
    for (let j = i + 1; j < parsed.length; j++) {
      const [b1, b2] = parsed[j] ?? [0, 0];
      if (popcount32((a1 ^ b1) >>> 0) + popcount32((a2 ^ b2) >>> 0) <= maxDistance) {
        const ri = find(i);
        const rj = find(j);
        if (ri !== rj) parent[rj] = ri;
      }
    }
  }
  const groups = new Map<number, string[]>();
  items.forEach((item, i) => {
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), item.id]);
  });
  return [...groups.values()].filter((g) => g.length > 1);
}
