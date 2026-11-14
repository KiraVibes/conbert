import { deflateSync, inflateSync } from 'fflate';
import { crc32 } from './crc';

/**
 * Files on unusual carriers: printed as a grid of QR codes (paper backup)
 * and as black-and-white blocks in the frames of a video. Both split the
 * (packed) file into numbered pieces with a checksum, so missing or broken
 * pieces show up instead of a silently broken file.
 */

export interface CarriedFile {
  name: string;
  bytes: Uint8Array;
}

export type AssembleResult =
  | { ok: true; file: CarriedFile }
  | { ok: false; reason: 'none' | 'missing' | 'broken'; missing: number[]; total: number };

const MAGIC = [0x43, 0x42]; // "CB"
const VERSION = 1;
/** Piece header: magic (2), version (1), file id (4), index (2), total (2). */
const HEAD = 11;

interface Piece {
  id: number;
  index: number;
  total: number;
  data: Uint8Array;
}

/**
 * Packs the file (name, size, checksum, deflated content) and cuts it into
 * pieces of at most `size` bytes, each with a header.
 */
export function splitForCarrier(
  file: CarriedFile,
  size: number,
  id = (Math.random() * 2 ** 32) >>> 0,
): Uint8Array[] {
  const name = new TextEncoder().encode(file.name.slice(0, 200));
  const packed = deflateSync(file.bytes, { level: 9 });
  const body = new Uint8Array(1 + name.length + 8 + packed.length);
  const v = new DataView(body.buffer);
  body[0] = name.length;
  body.set(name, 1);
  v.setUint32(1 + name.length, file.bytes.length);
  v.setUint32(5 + name.length, crc32(file.bytes));
  body.set(packed, 9 + name.length);
  const room = size - HEAD;
  const total = Math.max(1, Math.ceil(body.length / room));
  if (total > 0xffff) throw new RangeError('too many pieces');
  const out: Uint8Array[] = [];
  for (let i = 0; i < total; i++) {
    const data = body.subarray(i * room, (i + 1) * room);
    const piece = new Uint8Array(HEAD + data.length);
    const pv = new DataView(piece.buffer);
    piece.set(MAGIC);
    piece[2] = VERSION;
    pv.setUint32(3, id);
    pv.setUint16(7, i);
    pv.setUint16(9, total);
    piece.set(data, HEAD);
    out.push(piece);
  }
  return out;
}

function readPiece(bytes: Uint8Array): Piece | null {
  if (bytes.length < HEAD || bytes[0] !== MAGIC[0] || bytes[1] !== MAGIC[1] || bytes[2] !== VERSION)
    return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    id: v.getUint32(3),
    index: v.getUint16(7),
    total: v.getUint16(9),
    data: bytes.subarray(HEAD),
  };
}

/** Puts pieces (in any order, duplicates allowed) back together. */
export function assembleCarrier(pieces: readonly Uint8Array[]): AssembleResult {
  const parsed = pieces.map(readPiece).filter((p): p is Piece => p !== null);
  if (parsed.length === 0) return { ok: false, reason: 'none', missing: [], total: 0 };
  // The file with the most pieces wins (other pages may belong to another file).
  const counts = new Map<number, number>();
  for (const p of parsed) counts.set(p.id, (counts.get(p.id) ?? 0) + 1);
  const id = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const mine = parsed.filter((p) => p.id === id);
  const total = mine[0]?.total ?? 0;
  const byIndex = new Map(mine.map((p) => [p.index, p.data]));
  const missing = Array.from({ length: total }, (_, i) => i).filter((i) => !byIndex.has(i));
  if (missing.length > 0) return { ok: false, reason: 'missing', missing, total };
  const body = new Uint8Array([...byIndex.values()].reduce((n, d) => n + d.length, 0));
  let o = 0;
  for (let i = 0; i < total; i++) {
    const d = byIndex.get(i) ?? new Uint8Array();
    body.set(d, o);
    o += d.length;
  }
  try {
    const nameLen = body[0] ?? 0;
    const name = new TextDecoder().decode(body.subarray(1, 1 + nameLen));
    const v = new DataView(body.buffer, body.byteOffset, body.byteLength);
    const size = v.getUint32(1 + nameLen);
    const crc = v.getUint32(5 + nameLen);
    const bytes = inflateSync(body.subarray(9 + nameLen), { out: new Uint8Array(size) });
    if (bytes.length !== size || crc32(bytes) !== crc) throw new Error('checksum');
    return { ok: true, file: { name, bytes } };
  } catch {
    return { ok: false, reason: 'broken', missing: [], total };
  }
}

// ---------------------------------------------------------------- video frames

/** Frame layout: blocks of `block` pixels; the first row holds a sync pattern. */
export interface FrameLayout {
  width: number;
  height: number;
  block: number;
}

export const frameColumns = (l: FrameLayout) => Math.floor(l.width / l.block);
export const frameRows = (l: FrameLayout) => Math.floor(l.height / l.block);
/** Payload bytes per frame: all blocks but the first row, minus a 4-byte checksum. */
export const frameCapacity = (l: FrameLayout) =>
  Math.floor((frameColumns(l) * (frameRows(l) - 1)) / 8) - 6;

/**
 * One frame as blocks (1 = white): first row alternates (so a reader can
 * check the layout), then length (2 bytes), the piece, and its CRC32.
 */
export function frameBlocks(piece: Uint8Array, l: FrameLayout): Uint8Array {
  const cols = frameColumns(l);
  const rows = frameRows(l);
  const blocks = new Uint8Array(cols * rows);
  for (let x = 0; x < cols; x++) blocks[x] = x % 2;
  const payload = new Uint8Array(6 + piece.length);
  const v = new DataView(payload.buffer);
  v.setUint16(0, piece.length);
  payload.set(piece, 2);
  v.setUint32(2 + piece.length, crc32(piece));
  for (let bit = 0; bit < payload.length * 8; bit++)
    blocks[cols + bit] = ((payload[bit >> 3] ?? 0) >> (7 - (bit & 7))) & 1;
  return blocks;
}

/** Reads a piece back from block brightnesses (0–255); null when the checksum fails. */
export function readFrameBlocks(
  levels: Uint8Array | Float32Array,
  l: FrameLayout,
): Uint8Array | null {
  const cols = frameColumns(l);
  // The sync row tells the threshold between black and white.
  let lo = 0;
  let hi = 0;
  for (let x = 0; x < cols; x++) {
    if (x % 2) hi += levels[x] ?? 0;
    else lo += levels[x] ?? 0;
  }
  const threshold = (lo + hi) / cols;
  if (hi - lo < cols * 20) return null;
  const bit = (i: number) => ((levels[cols + i] ?? 0) > threshold ? 1 : 0);
  const byte = (at: number) => {
    let b = 0;
    for (let k = 0; k < 8; k++) b = (b << 1) | bit(at * 8 + k);
    return b;
  };
  const length = (byte(0) << 8) | byte(1);
  if (length > frameCapacity(l)) return null;
  const piece = new Uint8Array(length);
  for (let i = 0; i < length; i++) piece[i] = byte(2 + i);
  const crc =
    ((byte(2 + length) << 24) |
      (byte(3 + length) << 16) |
      (byte(4 + length) << 8) |
      byte(5 + length)) >>>
    0;
  return crc32(piece) === crc ? piece : null;
}

/** Average brightness of every block's middle (RGBA frame). */
export function blockLevels(rgba: Uint8ClampedArray, width: number, l: FrameLayout): Float32Array {
  const cols = frameColumns(l);
  const rows = frameRows(l);
  const out = new Float32Array(cols * rows);
  const m = Math.max(1, Math.floor(l.block / 4));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      let s = 0;
      let n = 0;
      for (let y = r * l.block + m; y < (r + 1) * l.block - m; y++)
        for (let x = c * l.block + m; x < (c + 1) * l.block - m; x++) {
          const o = (y * width + x) * 4;
          s += ((rgba[o] ?? 0) + (rgba[o + 1] ?? 0) + (rgba[o + 2] ?? 0)) / 3;
          n++;
        }
      out[r * cols + c] = n ? s / n : 0;
    }
  return out;
}
