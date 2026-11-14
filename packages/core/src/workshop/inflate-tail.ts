/**
 * A raw DEFLATE decoder (RFC 1951, after zlib's "puff") that can start in the
 * middle of a stream: back-references to bytes before the start are allowed
 * and come out as 0, marked in `unknown`. Used to read what is left of a
 * picture's data behind the end of a cropped PNG.
 */

export interface TailInflate {
  data: Uint8Array;
  /** 1 where the byte came from before the start (its value is unknown). */
  unknown: Uint8Array;
  /** Bits left after the last block (the zlib checksum follows there). */
  bitsLeft: number;
}

class Fail extends Error {}

const LEN_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131,
  163, 195, 227, 258,
];
const LEN_EXTRA = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
];
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049,
  3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DIST_EXTRA = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13,
];
const ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
const MAX_BITS = 15;

interface Huffman {
  count: Uint16Array;
  symbol: Uint16Array;
}

/** Canonical Huffman table; `strict` refuses incomplete codes (a wrong start shows up fast). */
function build(lengths: ArrayLike<number>, n: number, strict: boolean): Huffman {
  const count = new Uint16Array(MAX_BITS + 1);
  for (let s = 0; s < n; s++) {
    const l = lengths[s] ?? 0;
    count[l] = (count[l] ?? 0) + 1;
  }
  if (count[0] === n) throw new Fail();
  let left = 1;
  for (let len = 1; len <= MAX_BITS; len++) {
    left = (left << 1) - (count[len] ?? 0);
    if (left < 0) throw new Fail(); // over-subscribed
  }
  // Incomplete codes are only allowed for a single code (RFC 1951).
  if (strict && left > 0 && n - (count[0] ?? 0) !== 1) throw new Fail();
  const offs = new Uint16Array(MAX_BITS + 1);
  for (let len = 1; len < MAX_BITS; len++) offs[len + 1] = (offs[len] ?? 0) + (count[len] ?? 0);
  const symbol = new Uint16Array(n);
  for (let s = 0; s < n; s++) {
    const l = lengths[s] ?? 0;
    if (l !== 0) {
      const at = offs[l] ?? 0;
      symbol[at] = s;
      offs[l] = at + 1;
    }
  }
  return { count, symbol };
}

let fixed: { lit: Huffman; dist: Huffman } | null = null;
function fixedTables() {
  if (fixed) return fixed;
  const l = new Uint8Array(288);
  l.fill(8, 0, 144);
  l.fill(9, 144, 256);
  l.fill(7, 256, 280);
  l.fill(8, 280, 288);
  fixed = { lit: build(l, 288, false), dist: build(new Uint8Array(30).fill(5), 30, false) };
  return fixed;
}

const scratch = { out: new Uint8Array(1 << 16), unknown: new Uint8Array(1 << 16) };

class State {
  pos: number;
  out: Uint8Array;
  unknown: Uint8Array;
  outLen = 0;

  constructor(
    readonly src: Uint8Array,
    bit: number,
    readonly maxOut: number,
  ) {
    this.pos = bit;
    // Most tries fail after a few bytes – reuse the buffers of earlier tries.
    this.out = scratch.out;
    this.unknown = scratch.unknown;
  }

  bits(n: number): number {
    let v = 0;
    for (let i = 0; i < n; i++) {
      const p = this.pos++;
      const byte = this.src[p >> 3];
      if (byte === undefined) throw new Fail();
      v |= ((byte >> (p & 7)) & 1) << i;
    }
    return v;
  }

  decode(h: Huffman): number {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len <= MAX_BITS; len++) {
      code |= this.bits(1);
      const c = (h.count[len] ?? 0);
      if (code - c < first) return (h.symbol[index + (code - first)] ?? 0);
      index += c;
      first = (first + c) << 1;
      code <<= 1;
    }
    throw new Fail();
  }

  grow(extra: number) {
    if (this.outLen + extra <= this.out.length) return;
    if (this.outLen + extra > this.maxOut) throw new Fail();
    const size = Math.min(this.maxOut, Math.max(this.out.length * 2, this.outLen + extra));
    const out = new Uint8Array(size);
    out.set(this.out.subarray(0, this.outLen));
    const unknown = new Uint8Array(size);
    unknown.set(this.unknown.subarray(0, this.outLen));
    this.out = out;
    this.unknown = unknown;
    scratch.out = out;
    scratch.unknown = unknown;
  }

  codes(lit: Huffman, dist: Huffman) {
    for (;;) {
      const sym = this.decode(lit);
      if (sym < 256) {
        this.grow(1);
        this.unknown[this.outLen] = 0;
        this.out[this.outLen++] = sym;
      } else if (sym === 256) {
        return;
      } else {
        const li = sym - 257;
        if (li >= 29) throw new Fail();
        const len = (LEN_BASE[li] ?? 0) + this.bits((LEN_EXTRA[li] ?? 0));
        const ds = this.decode(dist);
        if (ds >= 30) throw new Fail();
        const d = (DIST_BASE[ds] ?? 0) + this.bits((DIST_EXTRA[ds] ?? 0));
        this.grow(len);
        for (let k = 0; k < len; k++) {
          const from = this.outLen - d;
          if (from >= 0) {
            this.out[this.outLen] = (this.out[from] ?? 0);
            this.unknown[this.outLen] = (this.unknown[from] ?? 0);
          } else {
            this.out[this.outLen] = 0;
            this.unknown[this.outLen] = 1; // before the start – lost
          }
          this.outLen++;
        }
      }
    }
  }

  stored() {
    this.pos = (this.pos + 7) & ~7;
    const len = this.bits(16);
    const nlen = this.bits(16);
    if ((len ^ 0xffff) !== nlen) throw new Fail();
    const start = this.pos >> 3;
    if (start + len > this.src.length) throw new Fail();
    this.grow(len);
    this.out.set(this.src.subarray(start, start + len), this.outLen);
    this.unknown.fill(0, this.outLen, this.outLen + len);
    this.outLen += len;
    this.pos += len * 8;
  }

  dynamic() {
    const nlen = this.bits(5) + 257;
    const ndist = this.bits(5) + 1;
    const ncode = this.bits(4) + 4;
    if (nlen > 286 || ndist > 30) throw new Fail();
    const lengths = new Uint8Array(320);
    for (let i = 0; i < ncode; i++) lengths[(ORDER[i] ?? 0)] = this.bits(3);
    const lencode = build(lengths, 19, true);
    lengths.fill(0);
    let i = 0;
    while (i < nlen + ndist) {
      const sym = this.decode(lencode);
      if (sym < 16) {
        lengths[i++] = sym;
        continue;
      }
      let len = 0;
      let repeat: number;
      if (sym === 16) {
        if (i === 0) throw new Fail();
        len = (lengths[i - 1] ?? 0);
        repeat = 3 + this.bits(2);
      } else if (sym === 17) repeat = 3 + this.bits(3);
      else repeat = 11 + this.bits(7);
      if (i + repeat > nlen + ndist) throw new Fail();
      while (repeat--) lengths[i++] = len;
    }
    if (lengths[256] === 0) throw new Fail(); // no end-of-block code
    const lit = build(lengths.subarray(0, nlen), nlen, true);
    const dist = build(lengths.subarray(nlen, nlen + ndist), ndist, false);
    this.codes(lit, dist);
  }
}

/**
 * Decodes from bit `bit` of `src` to the last block. Returns null when the
 * bits there are no valid DEFLATE start (the usual case for a wrong guess).
 * `firstType` limits the first block's type (2 = dynamic, as zlib writes).
 */
export function inflateTail(
  src: Uint8Array,
  bit: number,
  options: { maxOut?: number; firstType?: number } = {},
): TailInflate | null {
  const s = new State(src, bit, options.maxOut ?? 256 * 1024 * 1024);
  try {
    let first = true;
    for (;;) {
      const last = s.bits(1);
      const type = s.bits(2);
      if (first && options.firstType !== undefined && type !== options.firstType) return null;
      first = false;
      if (type === 0) s.stored();
      else if (type === 1) s.codes(fixedTables().lit, fixedTables().dist);
      else if (type === 2) s.dynamic();
      else return null;
      if (last) break;
    }
  } catch (e) {
    if (e instanceof Fail) return null;
    throw e;
  }
  return {
    data: s.out.slice(0, s.outLen),
    unknown: s.unknown.slice(0, s.outLen),
    bitsLeft: src.length * 8 - s.pos,
  };
}
