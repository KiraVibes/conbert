import type { ByteReader } from './reader';
import { Builder, field, finish, type FileStructure, type RegionField } from './structure-base';

/**
 * Matroska (MKV, MKA) and WebM for the hex viewer. Both are EBML: every
 * element starts with an ID and a size, each written with a variable number
 * of bytes (the first 1-bit says how many). The top level is a header and one
 * "segment"; inside it lie the description (Info, Tracks …) and the clusters
 * with the actual video and sound.
 */

/** IDs of the elements this reader explains (hex as written in the file). */
const IDS = {
  ebml: 0x1a45dfa3,
  docType: 0x4282,
  ebmlVersion: 0x4286,
  segment: 0x18538067,
  info: 0x1549a966,
  timestampScale: 0x2ad7b1,
  duration: 0x4489,
  muxingApp: 0x4d80,
  writingApp: 0x5741,
  tracks: 0x1654ae6b,
  trackEntry: 0xae,
  codecId: 0x86,
  video: 0xe0,
  pixelWidth: 0xb0,
  pixelHeight: 0xba,
  audio: 0xe1,
  samplingFrequency: 0xb5,
  channels: 0x9f,
} as const;

/** Top-level elements inside the segment (text key per name). */
const SEGMENT_CHILDREN: Record<number, string> = {
  0x114d9b74: 'seekHead',
  0x1549a966: 'info',
  0x1654ae6b: 'tracks',
  0x1f43b675: 'cluster',
  0x1c53bb6b: 'cues',
  0x1941a469: 'attachments',
  0x1043a770: 'chapters',
  0x1254c367: 'tags',
  0xec: 'void',
  0xbf: 'crc',
};
export const EBML_ELEMENTS = [...new Set(Object.values(SEGMENT_CHILDREN)), 'other'] as const;

/** Description elements are small; bigger ones are only marked, not read. */
const MAX_READ = 1024 * 1024;

interface Vint {
  value: number;
  length: number;
  /** All value bits set: "size unknown" (live recordings, streaming). */
  unknown: boolean;
}

/** A variable-length number; `keepMarker` for IDs (the marker bit is part of the ID). */
function vint(bytes: Uint8Array, at: number, keepMarker: boolean): Vint | null {
  const first = bytes[at] ?? 0;
  if (first === 0) return null;
  const length = Math.clz32(first) - 23;
  if (length > 8 || at + length > bytes.length) return null;
  let value = keepMarker ? first : first & (0xff >> length);
  let allOnes = value === 0xff >> length;
  for (let i = 1; i < length; i++) {
    const b = bytes[at + i] ?? 0;
    value = value * 256 + b;
    if (b !== 0xff) allOnes = false;
  }
  return { value, length, unknown: !keepMarker && allOnes };
}

interface Element {
  id: number;
  /** Where the element (its ID) starts. */
  start: number;
  /** Where its content starts. */
  dataStart: number;
  /** Exclusive; the file's end when the size is unknown. */
  end: number;
  unknownSize: boolean;
}

/** The element header at `pos` (in the file), or null when it is not one. */
async function elementAt(reader: ByteReader, pos: number, limit: number): Promise<Element | null> {
  const head = await reader.read(pos, 12);
  const id = vint(head, 0, true);
  if (!id) return null;
  const size = vint(head, id.length, false);
  if (!size) return null;
  const dataStart = pos + id.length + size.length;
  const end = size.unknown ? limit : Math.min(limit, dataStart + size.value);
  return { id: id.value, start: pos, dataStart, end, unknownSize: size.unknown };
}

/** Elements inside `bytes` (content of a small element); positions relative to it. */
function children(bytes: Uint8Array): { id: number; start: number; data: Uint8Array }[] {
  const out: { id: number; start: number; data: Uint8Array }[] = [];
  let pos = 0;
  while (pos < bytes.length) {
    const id = vint(bytes, pos, true);
    const size = id && vint(bytes, pos + id.length, false);
    if (!id || !size || size.unknown) break;
    const dataStart = pos + id.length + size.length;
    out.push({ id: id.value, start: pos, data: bytes.subarray(dataStart, dataStart + size.value) });
    pos = dataStart + size.value;
  }
  return out;
}

const uint = (d: Uint8Array) => d.reduce((n, b) => n * 256 + b, 0);
const text = (d: Uint8Array) => new TextDecoder().decode(d).replace(/\0+$/, '');
function float(d: Uint8Array): number {
  const view = new DataView(d.buffer, d.byteOffset, d.byteLength);
  return d.length === 4 ? view.getFloat32(0) : d.length === 8 ? view.getFloat64(0) : 0;
}

function headerFields(body: Uint8Array, at: number): RegionField[] {
  const fields: RegionField[] = [];
  for (const c of children(body)) {
    const start = at + c.start;
    const length = c.data.byteOffset - body.byteOffset - c.start + c.data.length;
    if (c.id === IDS.docType) fields.push(field('docType', start, length, text(c.data)));
    if (c.id === IDS.ebmlVersion) fields.push(field('ebmlVersion', start, length, uint(c.data)));
  }
  return fields;
}

function infoFields(body: Uint8Array, at: number): RegionField[] {
  const found = children(body);
  const scale = uint(found.find((c) => c.id === IDS.timestampScale)?.data ?? Uint8Array.of());
  const fields: RegionField[] = [];
  for (const c of found) {
    const start = at + c.start;
    const length = c.data.byteOffset - body.byteOffset - c.start + c.data.length;
    if (c.id === IDS.duration) {
      // Duration counts in timestamp steps (default 1 ms).
      const seconds = (float(c.data) * (scale || 1_000_000)) / 1e9;
      fields.push(field('duration', start, length, Math.round(seconds * 10) / 10));
    }
    if (c.id === IDS.muxingApp) fields.push(field('muxingApp', start, length, text(c.data)));
    if (c.id === IDS.writingApp) fields.push(field('writingApp', start, length, text(c.data)));
  }
  return fields;
}

function trackFields(body: Uint8Array, at: number): { fields: RegionField[]; codecs: string[] } {
  const fields: RegionField[] = [];
  const codecs: string[] = [];
  const offset = (c: { data: Uint8Array }) => at + (c.data.byteOffset - body.byteOffset);
  for (const entry of children(body).filter((c) => c.id === IDS.trackEntry)) {
    for (const c of children(entry.data)) {
      const start = offset(c);
      if (c.id === IDS.codecId) {
        codecs.push(text(c.data));
        fields.push(field('codec', start, c.data.length, text(c.data)));
      }
      if (c.id === IDS.video) {
        for (const v of children(c.data)) {
          if (v.id === IDS.pixelWidth)
            fields.push(field('width', offset(v), v.data.length, uint(v.data)));
          if (v.id === IDS.pixelHeight)
            fields.push(field('height', offset(v), v.data.length, uint(v.data)));
        }
      }
      if (c.id === IDS.audio) {
        for (const a of children(c.data)) {
          if (a.id === IDS.samplingFrequency) {
            fields.push(field('sampleRate', offset(a), a.data.length, Math.round(float(a.data))));
          }
          if (a.id === IDS.channels)
            fields.push(field('channels', offset(a), a.data.length, uint(a.data)));
        }
      }
    }
  }
  return { fields, codecs };
}

export async function parseEbml(reader: ByteReader): Promise<FileStructure> {
  const b = new Builder();
  const header = await elementAt(reader, 0, reader.size);
  if (!header || header.id !== IDS.ebml) return finish(reader, 'mkv', b, null);
  const headerBody = await reader.read(
    header.dataStart,
    Math.min(MAX_READ, header.end - header.dataStart),
  );
  b.add({ start: 0, end: 4, kind: 'signature', key: 'mkv.signature' });
  const fields = headerFields(headerBody, header.dataStart);
  b.add({
    start: 4,
    end: header.end,
    kind: 'header',
    key: 'mkv.header',
    ...(fields.length > 0 && { fields }),
  });

  const segment = await elementAt(reader, header.end, reader.size);
  if (!segment || segment.id !== IDS.segment) return finish(reader, 'mkv', b, header.end);
  b.add({ start: segment.start, end: segment.dataStart, kind: 'chunk', key: 'mkv.segment' });

  let pos = segment.dataStart;
  while (pos < segment.end && !b.full) {
    const el = await elementAt(reader, pos, segment.end);
    if (!el || el.end <= el.start) break;
    const name = SEGMENT_CHILDREN[el.id] ?? 'other';
    const small = el.end - el.dataStart <= MAX_READ;
    let elFields: RegionField[] = [];
    let label: string | undefined;
    if (small && (name === 'info' || name === 'tracks')) {
      const body = await reader.read(el.dataStart, el.end - el.dataStart);
      if (name === 'info') elFields = infoFields(body, el.dataStart);
      else {
        const tracks = trackFields(body, el.dataStart);
        elFields = tracks.fields;
        if (tracks.codecs.length > 0) label = tracks.codecs.join(' · ');
      }
    }
    b.add({
      start: el.start,
      end: el.end,
      kind: name === 'cluster' ? 'data' : name === 'crc' ? 'checksum' : 'chunk',
      key: `mkv.elements.${name}`,
      values: { bytes: el.end - el.dataStart },
      ...(label && { label }),
      ...(elFields.length > 0 && { fields: elFields }),
    });
    // An element without a size (live recording) runs to the end.
    if (el.unknownSize) break;
    pos = el.end;
  }
  return finish(reader, 'mkv', b, segment.unknownSize ? null : segment.end);
}
