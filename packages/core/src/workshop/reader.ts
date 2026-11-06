/**
 * Random access to a file's bytes: a Blob in the browser, a file handle on the
 * server or plain bytes in tests. The workshop tricks only use this, so the
 * same code runs on both sides.
 */
export interface ByteReader {
  readonly size: number;
  /** Up to `length` bytes from `offset` (fewer at the end of the file). */
  read(offset: number, length: number): Promise<Uint8Array>;
}

export function bytesReader(bytes: Uint8Array): ByteReader {
  return {
    size: bytes.length,
    read: (offset, length) => {
      const start = Math.max(0, Math.min(bytes.length, offset));
      return Promise.resolve(bytes.subarray(start, Math.min(bytes.length, start + length)));
    },
  };
}

export function blobReader(blob: Blob): ByteReader {
  return {
    size: blob.size,
    read: async (offset, length) => {
      const start = Math.max(0, Math.min(blob.size, offset));
      return new Uint8Array(await blob.slice(start, start + length).arrayBuffer());
    },
  };
}

/**
 * Reads byte by byte without one read per byte: keeps a window of the file
 * and only fetches the next one when the position leaves it.
 */
export class BufferedReader {
  private start = 0;
  private buffer: Uint8Array = new Uint8Array(0);

  constructor(
    readonly reader: ByteReader,
    private readonly windowSize = 64 * 1024,
  ) {}

  get size(): number {
    return this.reader.size;
  }

  private async ensure(offset: number, length: number): Promise<void> {
    if (offset >= this.start && offset + length <= this.start + this.buffer.length) return;
    this.start = offset;
    this.buffer = await this.reader.read(offset, Math.max(length, this.windowSize));
  }

  /** The byte at `offset`, or -1 behind the end. */
  async byte(offset: number): Promise<number> {
    if (offset < 0 || offset >= this.size) return -1;
    await this.ensure(offset, 1);
    return this.buffer[offset - this.start] ?? -1;
  }

  /** `length` bytes from `offset` (fewer at the end of the file). */
  async bytes(offset: number, length: number): Promise<Uint8Array> {
    const wanted = Math.max(0, Math.min(length, this.size - offset));
    await this.ensure(offset, wanted);
    const from = offset - this.start;
    return this.buffer.subarray(from, from + wanted);
  }
}

export function u16be(b: Uint8Array, i: number): number {
  return ((b[i] ?? 0) << 8) | (b[i + 1] ?? 0);
}
export function u16le(b: Uint8Array, i: number): number {
  return (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8);
}
export function u32be(b: Uint8Array, i: number): number {
  return (
    (((b[i] ?? 0) << 24) >>> 0) +
    (((b[i + 1] ?? 0) << 16) | ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0))
  );
}
export function u32le(b: Uint8Array, i: number): number {
  return (
    (((b[i + 3] ?? 0) << 24) >>> 0) +
    (((b[i + 2] ?? 0) << 16) | ((b[i + 1] ?? 0) << 8) | (b[i] ?? 0))
  );
}
export function i32le(b: Uint8Array, i: number): number {
  return u32le(b, i) | 0;
}
/** 64-bit little endian as a number (exact up to 2^53 – far beyond any real file). */
export function u64le(b: Uint8Array, i: number): number {
  return u32le(b, i) + u32le(b, i + 4) * 2 ** 32;
}
export function ascii(b: Uint8Array, i: number, length: number): string {
  let s = '';
  for (let k = i; k < i + length && k < b.length; k++) s += String.fromCharCode(b[k] ?? 0);
  return s;
}

/** Finds `needle` in `haystack` from the end (or -1). */
export function lastIndexOf(haystack: Uint8Array, needle: readonly number[]): number {
  outer: for (let i = haystack.length - needle.length; i >= 0; i--) {
    for (let k = 0; k < needle.length; k++) if (haystack[i + k] !== needle[k]) continue outer;
    return i;
  }
  return -1;
}

/** A part of a file as a file of its own (for something embedded in it). */
export function sliceReader(reader: ByteReader, offset: number, length?: number): ByteReader {
  const start = Math.max(0, Math.min(reader.size, offset));
  const size = Math.max(0, Math.min(reader.size - start, length ?? reader.size - start));
  return {
    size,
    read: (o, l) => {
      const from = Math.max(0, Math.min(size, o));
      return reader.read(start + from, Math.max(0, Math.min(l, size - from)));
    },
  };
}

/** The whole (small) content of a reader. */
export async function readAll(reader: ByteReader): Promise<Uint8Array> {
  return reader.read(0, reader.size);
}

/**
 * Where `pattern` appears next, from `from` on (or backwards before it).
 * Reads the file in windows, so it works for any size. -1 = not found.
 */
export async function searchBytes(
  reader: ByteReader,
  pattern: Uint8Array,
  from: number,
  backwards = false,
  window = 1024 * 1024,
): Promise<number> {
  const n = pattern.length;
  if (n === 0 || n > reader.size) return -1;
  const matchAt = (buf: Uint8Array, i: number) => {
    for (let k = 0; k < n; k++) if (buf[i + k] !== pattern[k]) return false;
    return true;
  };
  if (!backwards) {
    for (let start = Math.max(0, from); start < reader.size; start += window) {
      const buf = await reader.read(start, window + n - 1);
      for (let i = 0; i + n <= buf.length && i < window; i++) if (matchAt(buf, i)) return start + i;
    }
    return -1;
  }
  for (let end = Math.min(from, reader.size - n); end >= 0; end -= window) {
    const start = Math.max(0, end - window + 1);
    const buf = await reader.read(start, end - start + n);
    for (let i = end - start; i >= 0; i--) if (matchAt(buf, i)) return start + i;
  }
  return -1;
}

/** "89 50 4E 47", "0x89504e47" or "89504E47" → bytes; null if it isn't hex. */
export function parseHexPattern(text: string): Uint8Array | null {
  const clean = text
    .trim()
    .replace(/^0x/i, '')
    .replace(/[\s:,-]/g, '');
  if (clean.length === 0 || clean.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(clean)) return null;
  return Uint8Array.from(clean.match(/../g) ?? [], (h) => Number.parseInt(h, 16));
}
