import { inflateSync } from 'fflate';
import { bytesReader, u16le, u32le, type ByteReader } from './reader';
import { findZipEnd, type ZipEntry } from './structure';

export type WorkshopErrorCode =
  | 'encrypted'
  | 'unsupported-method'
  | 'broken'
  | 'too-big'
  | 'empty'
  | 'executable'
  | 'wrong-password'
  | 'not-cover'
  | 'not-archive'
  | 'unchecked'
  | 'locked-pdf';

/** A workshop step that can't go on – the code has a text under `workshop.errors.`. */
export class WorkshopError extends Error {
  constructor(
    readonly code: WorkshopErrorCode,
    readonly details?: string,
  ) {
    super(details ? `${code}: ${details}` : code);
    this.name = 'WorkshopError';
  }
}

export const WORKSHOP_ERROR_CODES: readonly WorkshopErrorCode[] = [
  'encrypted',
  'unsupported-method',
  'broken',
  'too-big',
  'empty',
  'executable',
  'wrong-password',
  'not-cover',
  'not-archive',
  'unchecked',
  'locked-pdf',
];

/** Entries bigger than this are not unpacked in memory. */
export const MAX_EXTRACT_BYTES = 1024 * 1024 * 1024;

/**
 * Unpacks one entry of a ZIP (stored or deflate). Encrypted entries need the
 * password route (`unlockZipEntry`) instead.
 */
export async function extractZipEntry(reader: ByteReader, entry: ZipEntry): Promise<Uint8Array> {
  if (entry.encrypted || entry.method === 99) throw new WorkshopError('encrypted', entry.name);
  if (entry.size > MAX_EXTRACT_BYTES) throw new WorkshopError('too-big', entry.name);
  const local = await reader.read(entry.offset, 30);
  if (u32le(local, 0) !== 0x04034b50) throw new WorkshopError('broken', entry.name);
  const dataStart = entry.offset + 30 + u16le(local, 26) + u16le(local, 28);
  const data = await reader.read(dataStart, entry.compressedSize);
  if (data.length < entry.compressedSize) throw new WorkshopError('broken', entry.name);
  switch (entry.method) {
    case 0:
      return data.slice();
    case 8:
      try {
        return inflateSync(data, { out: new Uint8Array(entry.size) });
      } catch (error) {
        throw new WorkshopError('broken', error instanceof Error ? error.message : String(error));
      }
    default:
      throw new WorkshopError('unsupported-method', String(entry.method));
  }
}

const MAX32 = 0xffffffff;

/**
 * Moves every position a ZIP stores by `delta` bytes. Used to make a cut-out
 * archive self-contained again (delta = its shift) and to put an archive
 * behind a picture so that every ZIP program finds its entries (delta = the
 * picture's size, like `zip -A`).
 */
export async function relocateZip(bytes: Uint8Array, delta: number): Promise<Uint8Array> {
  const out = bytes.slice();
  const end = await findZipEnd(bytesReader(out));
  if (!end) throw new WorkshopError('broken', 'no end record');
  if (delta === 0) return out;
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  const add32 = (at: number) => {
    const next = view.getUint32(at, true) + delta;
    if (next < 0 || next >= MAX32) throw new WorkshopError('too-big', 'offset');
    view.setUint32(at, next, true);
  };
  const add64 = (at: number) => {
    const next = view.getBigUint64(at, true) + BigInt(delta);
    if (next < 0n) throw new WorkshopError('broken', 'offset');
    view.setBigUint64(at, next, true);
  };

  let p = end.cdStart;
  const cdEnd = end.cdStart + end.cdSize;
  while (p + 46 <= cdEnd && view.getUint32(p, true) === 0x02014b50) {
    const nameLength = view.getUint16(p + 28, true);
    const extraLength = view.getUint16(p + 30, true);
    const commentLength = view.getUint16(p + 32, true);
    if (view.getUint32(p + 42, true) === MAX32) {
      // ZIP64: the real offset sits in the extra field, behind the sizes that overflowed.
      let e = p + 46 + nameLength;
      const extraEnd = e + extraLength;
      while (e + 4 <= extraEnd) {
        const id = view.getUint16(e, true);
        const length = view.getUint16(e + 2, true);
        if (id === 0x0001) {
          let q = e + 4;
          if (view.getUint32(p + 24, true) === MAX32) q += 8;
          if (view.getUint32(p + 20, true) === MAX32) q += 8;
          add64(q);
        }
        e += 4 + length;
      }
    } else {
      add32(p + 42);
    }
    p += 46 + nameLength + extraLength + commentLength;
  }
  if (view.getUint32(end.cdOffsetAt, true) !== MAX32) add32(end.cdOffsetAt);
  if (end.zip64At !== null) {
    add64(end.zip64At + 48);
    // The locator right before the end record points at the ZIP64 record.
    if (view.getUint32(end.eocd - 20, true) === 0x07064b50) add64(end.eocd - 20 + 8);
  }
  return out;
}

/** A cut-out ZIP whose positions still count from the bigger file → a normal ZIP. */
export async function normalizeZip(bytes: Uint8Array): Promise<Uint8Array> {
  const end = await findZipEnd(bytesReader(bytes));
  if (!end) throw new WorkshopError('broken', 'no end record');
  return relocateZip(bytes, end.shift);
}
