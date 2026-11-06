import type { ByteReader } from './reader';

/**
 * File entropy: how "random" the bytes look, from 0 (always the same byte)
 * to 8 bits per byte (pure chance). Compressed and encrypted data sit close
 * to 8 – that's why they can't shrink any further.
 */

function entropyOf(counts: Uint32Array, total: number): number {
  if (total === 0) return 0;
  let h = 0;
  for (const c of counts) {
    if (c === 0) continue;
    const p = c / total;
    h -= p * Math.log2(p);
  }
  return h;
}

export function shannonEntropy(bytes: Uint8Array): number {
  const counts = new Uint32Array(256);
  for (const b of bytes) counts[b] = (counts[b] ?? 0) + 1;
  return entropyOf(counts, bytes.length);
}

export interface EntropyProfile {
  /** Bytes per block (the last block may be shorter). */
  blockSize: number;
  /** Entropy per block, 0–8. */
  blocks: number[];
  /** Over the whole file (or all samples). */
  overall: number;
  /** Big files: only the start of each block was read. */
  sampled: boolean;
}

export async function entropyProfile(
  reader: ByteReader,
  { blocks = 200, sampleBytes = 64 * 1024, minBlock = 256 } = {},
): Promise<EntropyProfile> {
  if (reader.size === 0) return { blockSize: 0, blocks: [], overall: 0, sampled: false };
  const blockSize = Math.max(minBlock, Math.ceil(reader.size / blocks));
  const count = Math.ceil(reader.size / blockSize);
  const sampled = blockSize > sampleBytes;
  const all = new Uint32Array(256);
  let total = 0;
  const values: number[] = [];
  for (let i = 0; i < count; i++) {
    const bytes = await reader.read(i * blockSize, Math.min(blockSize, sampleBytes));
    const counts = new Uint32Array(256);
    for (const b of bytes) counts[b] = (counts[b] ?? 0) + 1;
    for (let k = 0; k < 256; k++) all[k] = (all[k] ?? 0) + (counts[k] ?? 0);
    total += bytes.length;
    values.push(entropyOf(counts, bytes.length));
  }
  return { blockSize, blocks: values, overall: entropyOf(all, total), sampled };
}

export type EntropyLevel = 'uniform' | 'structured' | 'dense' | 'random';

/** In words: what does this value usually mean? */
export function entropyLevel(value: number): EntropyLevel {
  if (value < 2) return 'uniform';
  if (value < 6) return 'structured';
  if (value < 7.5) return 'dense';
  return 'random';
}

export const ENTROPY_LEVELS: readonly EntropyLevel[] = ['uniform', 'structured', 'dense', 'random'];
