/**
 * LZ77 in the format the GBA BIOS decompresses (SWI 0x11, LZ77UnCompWram):
 *
 *   header  u32: 0x10 | (decompressed size << 8)
 *   blocks  1 flag byte (MSB first: 1 = reference, 0 = literal) + 8 items
 *   literal 1 byte
 *   reference 2 bytes: length-3 (4 bits) | (distance-1) (12 bits), big endian
 *
 * Lengths 3–18, distances 1–4096. Output is padded to a multiple of 4 because
 * the BIOS wants word-aligned sources.
 */

const MIN_MATCH = 3;
const MAX_MATCH = 18;
const WINDOW = 4096;
const HASH_BITS = 13;
const MAX_CHAIN = 24;

export function lz77Compress(input: Uint8Array): Uint8Array {
  const n = input.length;
  if (n >= 1 << 24) throw new Error('lz77: input too large');
  // Worst case: every byte a literal + one flag byte per 8.
  const out = new Uint8Array(4 + n + Math.ceil(n / 8) + 8);
  out[0] = 0x10;
  out[1] = n & 0xff;
  out[2] = (n >> 8) & 0xff;
  out[3] = (n >> 16) & 0xff;
  let o = 4;

  const head = new Int32Array(1 << HASH_BITS).fill(-1);
  const prev = new Int32Array(n).fill(-1);
  const hash = (i: number) =>
    (((input[i] ?? 0) << 10) ^ ((input[i + 1] ?? 0) << 5) ^ (input[i + 2] ?? 0)) &
    ((1 << HASH_BITS) - 1);
  const insert = (i: number) => {
    if (i + MIN_MATCH > n) return;
    const h = hash(i);
    prev[i] = head[h] ?? -1;
    head[h] = i;
  };

  let i = 0;
  while (i < n) {
    const flagPos = o++;
    let flags = 0;
    for (let bit = 0; bit < 8 && i < n; bit++) {
      let bestLen = 0;
      let bestDist = 0;
      if (i + MIN_MATCH <= n) {
        let candidate = head[hash(i)] ?? -1;
        let chain = 0;
        const maxLen = Math.min(MAX_MATCH, n - i);
        while (candidate >= 0 && i - candidate <= WINDOW && chain++ < MAX_CHAIN) {
          let len = 0;
          while (len < maxLen && input[candidate + len] === input[i + len]) len++;
          if (len > bestLen) {
            bestLen = len;
            bestDist = i - candidate;
            if (len === maxLen) break;
          }
          candidate = prev[candidate] ?? -1;
        }
      }
      if (bestLen >= MIN_MATCH) {
        flags |= 0x80 >> bit;
        const d = bestDist - 1;
        out[o++] = ((bestLen - MIN_MATCH) << 4) | (d >> 8);
        out[o++] = d & 0xff;
        for (let k = 0; k < bestLen; k++) insert(i + k);
        i += bestLen;
      } else {
        out[o++] = input[i] ?? 0;
        insert(i);
        i++;
      }
    }
    out[flagPos] = flags;
  }
  return out.slice(0, (o + 3) & ~3);
}

/** Reference decoder (what the BIOS does) – used by tests and the size check. */
export function lz77Decompress(data: Uint8Array): Uint8Array {
  if (data[0] !== 0x10) throw new Error('lz77: not LZ77 data');
  const size = (data[1] ?? 0) | ((data[2] ?? 0) << 8) | ((data[3] ?? 0) << 16);
  const out = new Uint8Array(size);
  let i = 4;
  let o = 0;
  while (o < size) {
    const flags = data[i++] ?? 0;
    for (let bit = 0; bit < 8 && o < size; bit++) {
      if (flags & (0x80 >> bit)) {
        const b1 = data[i++] ?? 0;
        const b2 = data[i++] ?? 0;
        const len = (b1 >> 4) + MIN_MATCH;
        const dist = (((b1 & 0x0f) << 8) | b2) + 1;
        for (let k = 0; k < len && o < size; k++, o++) out[o] = out[o - dist] ?? 0;
      } else {
        out[o++] = data[i++] ?? 0;
      }
    }
  }
  return out;
}
