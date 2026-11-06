import { findSignature } from './identify';
import type { ByteReader } from './reader';

/**
 * The building blocks of a file for the hex viewer: which bytes are the
 * signature, a header, a chunk, data or something hidden behind the end.
 * Every region has an i18n key under `workshop.structure.` that explains it.
 */

export type RegionKind =
  | 'signature'
  | 'header'
  | 'chunk'
  | 'data'
  | 'checksum'
  | 'trailer'
  /** Bytes after the format's own end (e.g. an archive behind a picture). */
  | 'appended';

export const REGION_KINDS: readonly RegionKind[] = [
  'signature',
  'header',
  'chunk',
  'data',
  'checksum',
  'trailer',
  'appended',
];

export interface FileRegion {
  start: number;
  /** Exclusive. */
  end: number;
  kind: RegionKind;
  /** Below `workshop.structure.` – e.g. 'png.chunks.IHDR'. */
  key: string;
  /** Shown as it is (chunk name, file name in a ZIP). */
  label?: string;
  /** Placeholders for the text; `bytes` is shown as a file size. */
  values?: Record<string, string | number>;
  /** The single values inside it ("bytes 16–19: width = 800"). */
  fields?: RegionField[];
}

export interface RegionField {
  start: number;
  /** Exclusive. */
  end: number;
  /** Below `workshop.fields.` – e.g. 'width'. */
  key: string;
  /** The value as read (numbers stay numbers). */
  value: string | number;
  /** Below `workshop.fieldValues.` – what a code means ("6" → "RGBA"). */
  valueKey?: string;
  /** For checksums: true = fits, false = the data is damaged. */
  ok?: boolean;
}

/** A field of `length` bytes at `start`. */
export function field(
  key: string,
  start: number,
  length: number,
  value: string | number,
  extra: Partial<Pick<RegionField, 'valueKey' | 'ok'>> = {},
): RegionField {
  return { key, start, end: start + length, value, ...extra };
}

/** 0x1A2B3C4D */
export const hex32 = (n: number) => `0x${(n >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;

export interface ZipEntry {
  name: string;
  /** Where the entry's local header starts in this file. */
  offset: number;
  compressedSize: number;
  size: number;
  encrypted: boolean;
  directory: boolean;
  /** 0 = stored, 8 = deflate, 99 = AES (WinZip). */
  method: number;
  crc: number;
}

export interface FileStructure {
  /** Which parser read it ('png', 'jpg', 'zip' …). */
  format: string;
  regions: FileRegion[];
  /** Stopped early (too many regions or a broken file). */
  truncated: boolean;
  /** Where the format's own data ends, when bytes follow behind it. */
  appendedAt: number | null;
  /** Only for ZIP files. */
  entries?: ZipEntry[];
}

export const MAX_REGIONS = 4000;

export class Builder {
  readonly regions: FileRegion[] = [];
  truncated = false;

  add(region: FileRegion): boolean {
    if (region.end <= region.start) return true;
    if (this.regions.length >= MAX_REGIONS) {
      this.truncated = true;
      return false;
    }
    this.regions.push(region);
    return true;
  }

  get full(): boolean {
    return this.regions.length >= MAX_REGIONS;
  }
}

/** The region for bytes behind the format's end – and what they look like. */
export async function appended(reader: ByteReader, from: number): Promise<FileRegion | null> {
  if (from >= reader.size) return null;
  const head = await reader.read(from, 512);
  const found = findSignature(head);
  return {
    start: from,
    end: reader.size,
    kind: 'appended',
    key: found ? 'appendedKnown' : 'appended',
    values: { bytes: reader.size - from, ...(found && { format: found.ext }) },
  };
}

export async function finish(
  reader: ByteReader,
  format: string,
  b: Builder,
  end: number | null,
  extra?: Partial<FileStructure>,
): Promise<FileStructure> {
  const tail = end !== null && end < reader.size ? await appended(reader, end) : null;
  if (tail) b.regions.push(tail);
  b.regions.sort((x, y) => x.start - y.start);
  return {
    format,
    regions: b.regions,
    truncated: b.truncated,
    appendedAt: tail ? tail.start : null,
    ...extra,
  };
}
