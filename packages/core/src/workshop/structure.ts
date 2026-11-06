import { inflateSync } from 'fflate';
import { crc32 } from './crc';
import { ZIP_BASED, findSignature } from './identify';
import {
  BufferedReader,
  ascii,
  i32le,
  lastIndexOf,
  u16be,
  u16le,
  u32be,
  u32le,
  u64le,
  type ByteReader,
} from './reader';

import {
  Builder,
  MAX_REGIONS,
  field,
  finish,
  hex32,
  type FileRegion,
  type FileStructure,
  type RegionField,
  type ZipEntry,
} from './structure-base';
import { MEDIA_FORMATS, MEDIA_STRUCTURE_KEYS } from './structure-media';

export * from './structure-base';

// --- PNG -------------------------------------------------------------------

const PNG_CHUNKS = new Set([
  'IHDR',
  'ziPp',
  'PLTE',
  'IDAT',
  'IEND',
  'tEXt',
  'zTXt',
  'iTXt',
  'pHYs',
  'gAMA',
  'cHRM',
  'sRGB',
  'iCCP',
  'bKGD',
  'tIME',
  'tRNS',
  'eXIf',
  'acTL',
  'fcTL',
  'fdAT',
]);

/** Checksums of chunks up to this much data are recalculated (big picture data costs time). */
const CRC_CHECK_BUDGET = 64 * 1024 * 1024;

const PNG_COLOR_TYPES = new Set([0, 2, 3, 4, 6]);

/** The fields of a PNG picture header (IHDR). */
function ihdrFields(at: number, d: Uint8Array): RegionField[] {
  const colorType = d[9] ?? 0;
  return [
    field('width', at, 4, u32be(d, 0)),
    field('height', at + 4, 4, u32be(d, 4)),
    field('bitDepth', at + 8, 1, d[8] ?? 0),
    field('colorType', at + 9, 1, colorType, {
      ...(PNG_COLOR_TYPES.has(colorType) && { valueKey: `pngColor.${colorType}` }),
    }),
    field('compression', at + 10, 1, d[10] ?? 0),
    field('filter', at + 11, 1, d[11] ?? 0),
    field('interlace', at + 12, 1, d[12] ?? 0, {
      ...((d[12] ?? 0) <= 1 && { valueKey: `interlace.${d[12] ?? 0}` }),
    }),
  ];
}

async function parsePng(reader: ByteReader): Promise<FileStructure> {
  const b = new Builder();
  b.add({ start: 0, end: 8, kind: 'signature', key: 'png.signature' });
  let pos = 8;
  let end: number | null = null;
  let budget = CRC_CHECK_BUDGET;
  while (pos + 12 <= reader.size && !b.full) {
    const head = await reader.read(pos, 21);
    const length = u32be(head, 0);
    const type = ascii(head, 4, 4);
    if (!/^[A-Za-z]{4}$/.test(type)) {
      b.truncated = true;
      break;
    }
    const values: Record<string, number> = { bytes: length };
    if (type === 'IHDR') {
      values['width'] = u32be(head, 8);
      values['height'] = u32be(head, 12);
    }
    b.add({
      start: pos,
      end: pos + 8,
      kind: 'chunk',
      key: PNG_CHUNKS.has(type) ? `png.chunks.${type}` : 'png.chunks.other',
      label: type,
      values,
      fields: [field('length', pos, 4, length), field('chunkType', pos + 4, 4, type)],
    });
    const dataEnd = Math.min(reader.size, pos + 8 + length);
    b.add({
      start: pos + 8,
      end: dataEnd,
      kind: 'data',
      key: 'png.chunkData',
      label: type,
      ...(type === 'IHDR' && length >= 13 && { fields: ihdrFields(pos + 8, head.subarray(8)) }),
    });
    // The checksum covers type and data; recalculated while the budget lasts.
    const stored = dataEnd + 4 <= reader.size ? u32be(await reader.read(dataEnd, 4), 0) : null;
    let ok: boolean | undefined;
    if (stored !== null && length <= budget) {
      budget -= length;
      let crc = crc32(head.subarray(4, 8));
      for (let at = pos + 8; at < dataEnd; at += 1024 * 1024) {
        crc = crc32(await reader.read(at, Math.min(1024 * 1024, dataEnd - at)), crc);
      }
      ok = crc === stored;
    }
    b.add({
      start: dataEnd,
      end: Math.min(reader.size, dataEnd + 4),
      kind: 'checksum',
      key: 'png.crc',
      label: type,
      ...(stored !== null && {
        fields: [field('crc', dataEnd, 4, hex32(stored), ok === undefined ? {} : { ok })],
      }),
    });
    pos = dataEnd + 4;
    if (type === 'IEND') {
      end = pos;
      break;
    }
  }
  return finish(reader, 'png', b, end);
}

// --- JPEG ------------------------------------------------------------------

function jpegMarkerKey(marker: number, data: Uint8Array): { key: string; label: string } {
  const hex = marker.toString(16).toUpperCase();
  if (marker === 0xe0) return { key: 'jpg.markers.app0', label: 'APP0' };
  if (marker === 0xe1) {
    if (ascii(data, 0, 4) === 'Exif') return { key: 'jpg.markers.exif', label: 'APP1 EXIF' };
    if (ascii(data, 0, 4) === 'http') return { key: 'jpg.markers.xmp', label: 'APP1 XMP' };
    return { key: 'jpg.markers.app', label: 'APP1' };
  }
  if (marker === 0xe2 && ascii(data, 0, 11) === 'ICC_PROFILE') {
    return { key: 'jpg.markers.icc', label: 'APP2 ICC' };
  }
  if (marker === 0xee) return { key: 'jpg.markers.adobe', label: 'APP14' };
  if (marker >= 0xe0 && marker <= 0xef)
    return { key: 'jpg.markers.app', label: `APP${marker - 0xe0}` };
  if (marker === 0xc4) return { key: 'jpg.markers.dht', label: 'DHT' };
  if (marker === 0xdb) return { key: 'jpg.markers.dqt', label: 'DQT' };
  if (marker === 0xdd) return { key: 'jpg.markers.dri', label: 'DRI' };
  if (marker === 0xda) return { key: 'jpg.markers.sos', label: 'SOS' };
  if (marker === 0xfe) return { key: 'jpg.markers.com', label: 'COM' };
  if (marker === 0xc2) return { key: 'jpg.markers.sofProgressive', label: 'SOF2' };
  if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc8 && marker !== 0xcc) {
    return { key: 'jpg.markers.sof', label: `SOF${marker - 0xc0}` };
  }
  return { key: 'jpg.markers.other', label: `FF${hex}` };
}

/** The next marker behind compressed image data (FF 00 and restart markers belong to the data). */
async function nextJpegMarker(r: BufferedReader, from: number): Promise<number> {
  for (let i = from; i < r.size - 1; i++) {
    if ((await r.byte(i)) !== 0xff) continue;
    const next = await r.byte(i + 1);
    if (next === 0x00 || next === 0xff || (next >= 0xd0 && next <= 0xd7)) continue;
    return i;
  }
  return r.size;
}

async function parseJpeg(reader: ByteReader): Promise<FileStructure> {
  const b = new Builder();
  const r = new BufferedReader(reader);
  b.add({ start: 0, end: 2, kind: 'signature', key: 'jpg.soi' });
  let pos = 2;
  let end: number | null = null;
  while (pos + 2 <= reader.size && !b.full) {
    if ((await r.byte(pos)) !== 0xff) {
      b.truncated = true;
      break;
    }
    const marker = await r.byte(pos + 1);
    if (marker === 0xff) {
      pos += 1; // fill byte
      continue;
    }
    if (marker === 0xd9) {
      b.add({ start: pos, end: pos + 2, kind: 'trailer', key: 'jpg.eoi', label: 'EOI' });
      end = pos + 2;
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      b.add({
        start: pos,
        end: pos + 2,
        kind: 'chunk',
        key: 'jpg.markers.other',
        label: `FF${marker.toString(16).toUpperCase()}`,
      });
      pos += 2;
      continue;
    }
    const head = await r.bytes(pos, 20);
    const length = u16be(head, 2);
    if (length < 2) {
      b.truncated = true;
      break;
    }
    const data = head.subarray(4);
    const { key, label } = jpegMarkerKey(marker, data);
    const values: Record<string, number> = { bytes: length - 2 };
    if (key === 'jpg.markers.sof' || key === 'jpg.markers.sofProgressive') {
      values['height'] = u16be(data, 1);
      values['width'] = u16be(data, 3);
    }
    b.add({
      start: pos,
      end: pos + 4,
      kind: 'chunk',
      key,
      label,
      values,
      fields: [
        field('marker', pos, 2, `FF ${marker.toString(16).toUpperCase().padStart(2, '0')}`),
        field('length', pos + 2, 2, length),
      ],
    });
    const segmentEnd = Math.min(reader.size, pos + 2 + length);
    const at = pos + 4;
    const dataFields: RegionField[] =
      key === 'jpg.markers.sof' || key === 'jpg.markers.sofProgressive'
        ? [
            field('precision', at, 1, data[0] ?? 0),
            field('height', at + 1, 2, u16be(data, 1)),
            field('width', at + 3, 2, u16be(data, 3)),
            field('components', at + 5, 1, data[5] ?? 0),
          ]
        : key === 'jpg.markers.app0' && ascii(data, 0, 4) === 'JFIF'
          ? [
              field('identifier', at, 5, 'JFIF'),
              field(
                'version',
                at + 5,
                2,
                `${data[5] ?? 0}.${String(data[6] ?? 0).padStart(2, '0')}`,
              ),
              field('densityUnit', at + 7, 1, data[7] ?? 0, {
                ...((data[7] ?? 0) <= 2 && { valueKey: `densityUnit.${data[7] ?? 0}` }),
              }),
              field('xDensity', at + 8, 2, u16be(data, 8)),
              field('yDensity', at + 10, 2, u16be(data, 10)),
            ]
          : [];
    b.add({
      start: at,
      end: segmentEnd,
      kind: 'data',
      key: 'jpg.segmentData',
      label,
      ...(dataFields.length > 0 && { fields: dataFields }),
    });
    pos = segmentEnd;
    if (marker === 0xda) {
      const next = await nextJpegMarker(r, pos);
      b.add({ start: pos, end: next, kind: 'data', key: 'jpg.scan', label: 'SOS' });
      pos = next;
    }
  }
  return finish(reader, 'jpg', b, end);
}

// --- GIF -------------------------------------------------------------------

/** Skips GIF sub-blocks (size byte + data … until a 0 byte). Returns the position behind them. */
async function skipSubBlocks(r: BufferedReader, from: number): Promise<number> {
  let pos = from;
  for (;;) {
    const size = await r.byte(pos);
    if (size <= 0) return size === 0 ? pos + 1 : r.size;
    pos += 1 + size;
  }
}

async function parseGif(reader: ByteReader): Promise<FileStructure> {
  const b = new Builder();
  const r = new BufferedReader(reader);
  const head = await r.bytes(0, 13);
  b.add({
    start: 0,
    end: 6,
    kind: 'signature',
    key: 'gif.signature',
    label: ascii(head, 0, 6),
    fields: [field('identifier', 0, 3, 'GIF'), field('version', 3, 3, ascii(head, 3, 3))],
  });
  b.add({
    start: 6,
    end: 13,
    kind: 'header',
    key: 'gif.screen',
    values: { width: u16le(head, 6), height: u16le(head, 8) },
    fields: [
      field('width', 6, 2, u16le(head, 6)),
      field('height', 8, 2, u16le(head, 8)),
      field('gifFlags', 10, 1, `0b${(head[10] ?? 0).toString(2).padStart(8, '0')}`),
      field('background', 11, 1, head[11] ?? 0),
      field('aspect', 12, 1, head[12] ?? 0),
    ],
  });
  let pos = 13;
  const flags = head[10] ?? 0;
  if (flags & 0x80) {
    const size = 3 * 2 ** ((flags & 7) + 1);
    b.add({
      start: pos,
      end: pos + size,
      kind: 'data',
      key: 'gif.palette',
      values: { colors: size / 3 },
    });
    pos += size;
  }
  let end: number | null = null;
  let frames = 0;
  while (pos < reader.size && !b.full) {
    const type = await r.byte(pos);
    if (type === 0x3b) {
      b.add({ start: pos, end: pos + 1, kind: 'trailer', key: 'gif.trailer' });
      end = pos + 1;
      break;
    }
    if (type === 0x21) {
      const label = await r.byte(pos + 1);
      const key =
        label === 0xf9
          ? 'gif.gce'
          : label === 0xff
            ? 'gif.app'
            : label === 0xfe
              ? 'gif.comment'
              : 'gif.extension';
      const blockEnd = await skipSubBlocks(r, pos + 2);
      b.add({ start: pos, end: blockEnd, kind: 'chunk', key });
      pos = blockEnd;
      continue;
    }
    if (type === 0x2c) {
      frames++;
      const desc = await r.bytes(pos, 10);
      b.add({
        start: pos,
        end: pos + 10,
        kind: 'chunk',
        key: 'gif.image',
        values: { frame: frames, width: u16le(desc, 5), height: u16le(desc, 7) },
      });
      pos += 10;
      const local = desc[9] ?? 0;
      if (local & 0x80) {
        const size = 3 * 2 ** ((local & 7) + 1);
        b.add({
          start: pos,
          end: pos + size,
          kind: 'data',
          key: 'gif.palette',
          values: { colors: size / 3 },
        });
        pos += size;
      }
      const dataEnd = await skipSubBlocks(r, pos + 1);
      b.add({
        start: pos,
        end: dataEnd,
        kind: 'data',
        key: 'gif.imageData',
        values: { frame: frames },
      });
      pos = dataEnd;
      continue;
    }
    b.truncated = true;
    break;
  }
  return finish(reader, 'gif', b, end);
}

// --- BMP -------------------------------------------------------------------

async function parseBmp(reader: ByteReader): Promise<FileStructure> {
  const b = new Builder();
  const head = await reader.read(0, 54);
  const fileSize = u32le(head, 2);
  const dataOffset = u32le(head, 10);
  const infoSize = u32le(head, 14);
  const compression = u32le(head, 30);
  b.add({ start: 0, end: 2, kind: 'signature', key: 'bmp.signature' });
  b.add({
    start: 2,
    end: 14,
    kind: 'header',
    key: 'bmp.fileHeader',
    values: { bytes: fileSize },
    fields: [
      field('fileSize', 2, 4, fileSize),
      field('reserved', 6, 4, u32le(head, 6)),
      field('dataOffset', 10, 4, dataOffset),
    ],
  });
  b.add({
    start: 14,
    end: Math.min(14 + infoSize, reader.size),
    kind: 'header',
    key: 'bmp.infoHeader',
    values: { width: i32le(head, 18), height: Math.abs(i32le(head, 22)) },
    ...(infoSize >= 40 && {
      fields: [
        field('headerSize', 14, 4, infoSize),
        field('width', 18, 4, i32le(head, 18)),
        // Positive: the rows are stored bottom-up.
        field('height', 22, 4, i32le(head, 22)),
        field('planes', 26, 2, u16le(head, 26)),
        field('bitCount', 28, 2, u16le(head, 28)),
        field('bmpCompression', 30, 4, compression, {
          ...(compression <= 3 && { valueKey: `bmpCompression.${compression}` }),
        }),
        field('imageSize', 34, 4, u32le(head, 34)),
      ],
    }),
  });
  if (dataOffset > 14 + infoSize) {
    b.add({
      start: 14 + infoSize,
      end: Math.min(dataOffset, reader.size),
      kind: 'data',
      key: 'bmp.palette',
    });
  }
  const end = fileSize > dataOffset && fileSize <= reader.size ? fileSize : reader.size;
  b.add({ start: dataOffset, end, kind: 'data', key: 'bmp.pixels' });
  return finish(reader, 'bmp', b, end);
}

// --- RIFF (WAV, WebP, AVI) --------------------------------------------------

const RIFF_CHUNKS = new Set([
  'fmt',
  'data',
  'list',
  'vp8',
  'vp8l',
  'vp8x',
  'anim',
  'anmf',
  'alph',
  'iccp',
  'exif',
  'xmp',
  'avih',
  'movi',
  'idx1',
  'junk',
  'id3',
  'fact',
]);

async function parseRiff(reader: ByteReader, format: string): Promise<FileStructure> {
  const b = new Builder();
  const head = await reader.read(0, 12);
  const riffEnd = Math.min(reader.size, 8 + u32le(head, 4));
  b.add({
    start: 0,
    end: 12,
    kind: 'signature',
    key: 'riff.header',
    label: ascii(head, 8, 4).trim(),
    fields: [
      field('identifier', 0, 4, 'RIFF'),
      field('riffSize', 4, 4, u32le(head, 4)),
      field('form', 8, 4, ascii(head, 8, 4)),
    ],
  });
  let pos = 12;
  while (pos + 8 <= riffEnd && !b.full) {
    const chunk = await reader.read(pos, 8);
    const id = ascii(chunk, 0, 4);
    if (!/^[\x20-\x7e]{4}$/.test(id)) {
      b.truncated = true;
      break;
    }
    const size = u32le(chunk, 4);
    const name = id.trim().toLowerCase();
    b.add({
      start: pos,
      end: pos + 8,
      kind: 'chunk',
      key: RIFF_CHUNKS.has(name) ? `riff.chunks.${name}` : 'riff.chunks.other',
      label: id.trim(),
      values: { bytes: size },
      fields: [field('chunkType', pos, 4, id), field('length', pos + 4, 4, size)],
    });
    const dataEnd = Math.min(riffEnd, pos + 8 + size);
    let dataFields: RegionField[] = [];
    if (name === 'fmt' && size >= 16) {
      const f = await reader.read(pos + 8, 16);
      const at = pos + 8;
      const audioFormat = u16le(f, 0);
      dataFields = [
        field('audioFormat', at, 2, audioFormat, {
          ...([1, 3].includes(audioFormat) && { valueKey: `wavFormat.${audioFormat}` }),
        }),
        field('channels', at + 2, 2, u16le(f, 2)),
        field('sampleRate', at + 4, 4, u32le(f, 4)),
        field('byteRate', at + 8, 4, u32le(f, 8)),
        field('blockAlign', at + 12, 2, u16le(f, 12)),
        field('bitsPerSample', at + 14, 2, u16le(f, 14)),
      ];
    }
    b.add({
      start: pos + 8,
      end: dataEnd,
      kind: 'data',
      key: 'riff.chunkData',
      label: id.trim(),
      ...(dataFields.length > 0 && { fields: dataFields }),
    });
    pos = dataEnd + (size % 2); // chunks are padded to an even length
  }
  return finish(reader, format, b, riffEnd);
}

// --- PDF -------------------------------------------------------------------

const text = (s: string) => [...s].map((c) => c.charCodeAt(0));

async function parsePdf(reader: ByteReader): Promise<FileStructure> {
  const b = new Builder();
  const head = await reader.read(0, 32);
  const line = /^%PDF-(\d\.\d)/.exec(ascii(head, 0, 16));
  const headerEnd = line ? line[0].length : 5;
  b.add({
    start: 0,
    end: headerEnd,
    kind: 'signature',
    key: 'pdf.header',
    values: { version: line?.[1] ?? '?' },
  });
  const tailStart = Math.max(0, reader.size - 4096);
  const tail = await reader.read(tailStart, reader.size - tailStart);
  const eof = lastIndexOf(tail, text('%%EOF'));
  if (eof < 0) {
    b.add({ start: headerEnd, end: reader.size, kind: 'data', key: 'pdf.body' });
    return finish(reader, 'pdf', b, null);
  }
  const startxref = lastIndexOf(tail.subarray(0, eof), text('startxref'));
  const trailerAt = lastIndexOf(tail.subarray(0, startxref < 0 ? eof : startxref), text('trailer'));
  const trailerStart = tailStart + (trailerAt >= 0 ? trailerAt : startxref >= 0 ? startxref : eof);
  let end = tailStart + eof + 5;
  // The line break behind %%EOF still belongs to the PDF.
  while (end < reader.size && (tail[end - tailStart] === 0x0d || tail[end - tailStart] === 0x0a))
    end++;
  b.add({ start: headerEnd, end: trailerStart, kind: 'data', key: 'pdf.body' });
  b.add({ start: trailerStart, end, kind: 'trailer', key: 'pdf.trailer' });
  return finish(reader, 'pdf', b, end);
}

// --- ZIP -------------------------------------------------------------------

/** MS-DOS date and time as ZIP stores them → "2026-10-30 14:05:22". */
export function dosDate(date: number, time: number): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${1980 + (date >> 9)}-${p((date >> 5) & 15)}-${p(date & 31)} ${p(time >> 11)}:${p((time >> 5) & 63)}:${p((time & 31) * 2)}`;
}

const EOCD = [0x50, 0x4b, 0x05, 0x06];
const ZIP64_LOCATOR = [0x50, 0x4b, 0x06, 0x07];
const MAX_CENTRAL_DIRECTORY = 32 * 1024 * 1024;

export interface ZipEnd {
  /** Where the end record starts. */
  eocd: number;
  entries: number;
  cdSize: number;
  cdStart: number;
  /** Bytes in front of the archive (a picture, a stub …); negative for a cut-out archive. */
  shift: number;
  /** Where the end record stores the directory's offset (to rewrite it). */
  cdOffsetAt: number;
  /** Where the ZIP64 end record sits, if the archive has one. */
  zip64At: number | null;
}

/** Finds the archive's table of contents at the end of the file. */
export async function findZipEnd(reader: ByteReader): Promise<ZipEnd | null> {
  const tailStart = Math.max(0, reader.size - (65535 + 22));
  const tail = await reader.read(tailStart, reader.size - tailStart);
  let at = tail.length;
  for (;;) {
    at = lastIndexOf(tail.subarray(0, at + 3), EOCD);
    if (at < 0) return null;
    const eocd = tailStart + at;
    const record = tail.subarray(at, at + 22);
    let entries = u16le(record, 10);
    let cdSize = u32le(record, 12);
    let cdOffset = u32le(record, 16);
    let cdEnd = eocd;
    let zip64Record: number | null = null;
    if (cdOffset === 0xffffffff || cdSize === 0xffffffff || entries === 0xffff) {
      const locator = await reader.read(eocd - 20, 20);
      if (lastIndexOf(locator.subarray(0, 4), ZIP64_LOCATOR) === 0) {
        // The stored offset ignores bytes in front of the archive; the record
        // usually sits right before the locator.
        let zip64At = u64le(locator, 8);
        let zip64 = await reader.read(zip64At, 56);
        if (u32le(zip64, 0) !== 0x06064b50) {
          zip64At = eocd - 20 - 56;
          zip64 = await reader.read(zip64At, 56);
        }
        entries = u64le(zip64, 32);
        cdSize = u64le(zip64, 40);
        cdOffset = u64le(zip64, 48);
        // The ZIP64 end record follows the directory.
        cdEnd = zip64At;
        zip64Record = zip64At;
      }
    }
    const cdStart = cdEnd - cdSize;
    // Bytes in front of the archive (positive), or an archive cut out of a
    // bigger file whose offsets still count from there (negative).
    const shift = cdStart - cdOffset;
    // A plausible end record: the directory fits in front of it and starts
    // with a directory entry.
    if (cdStart >= 0 && cdSize <= MAX_CENTRAL_DIRECTORY) {
      const first = cdSize === 0 ? null : await reader.read(cdStart, 4);
      if (!first || u32le(first, 0) === 0x02014b50) {
        return {
          eocd,
          entries,
          cdSize,
          cdStart,
          shift,
          cdOffsetAt: eocd + 16,
          zip64At: zip64Record,
        };
      }
    }
    if (at === 0) return null;
    at -= 1;
  }
}

/** The ZIP's entries from its table of contents (also when something is in front of it). */
export async function readZipEntries(reader: ByteReader, end: ZipEnd): Promise<ZipEntry[]> {
  const cd = await reader.read(end.cdStart, end.cdSize);
  const entries: ZipEntry[] = [];
  let p = 0;
  while (p + 46 <= cd.length && entries.length < MAX_REGIONS) {
    if (u32le(cd, p) !== 0x02014b50) break;
    const flags = u16le(cd, p + 8);
    const method = u16le(cd, p + 10);
    const crc = u32le(cd, p + 16);
    let compressedSize = u32le(cd, p + 20);
    let size = u32le(cd, p + 24);
    const nameLength = u16le(cd, p + 28);
    const extraLength = u16le(cd, p + 30);
    const commentLength = u16le(cd, p + 32);
    let offset = u32le(cd, p + 42);
    const name = new TextDecoder().decode(cd.subarray(p + 46, p + 46 + nameLength));
    // ZIP64: the real numbers are in an extra field.
    let e = p + 46 + nameLength;
    const extraEnd = e + extraLength;
    while (e + 4 <= extraEnd) {
      const id = u16le(cd, e);
      const length = u16le(cd, e + 2);
      if (id === 0x0001) {
        let q = e + 4;
        if (size === 0xffffffff) {
          size = u64le(cd, q);
          q += 8;
        }
        if (compressedSize === 0xffffffff) {
          compressedSize = u64le(cd, q);
          q += 8;
        }
        if (offset === 0xffffffff) offset = u64le(cd, q);
      }
      e += 4 + length;
    }
    entries.push({
      name,
      offset: offset + end.shift,
      compressedSize,
      size,
      encrypted: (flags & 1) === 1,
      directory: name.endsWith('/'),
      method,
      crc,
    });
    p = extraEnd + commentLength;
  }
  return entries;
}

async function parseZip(reader: ByteReader): Promise<FileStructure | null> {
  const zipEnd = await findZipEnd(reader);
  if (!zipEnd) return null;
  const b = new Builder();
  const entries = await readZipEntries(reader, zipEnd);
  // Bytes in front of the first entry: plain `copy /b` (shift) or an archive
  // whose positions were moved along (like `zip -A`).
  const firstEntry = entries.reduce((min, e) => Math.min(min, e.offset), zipEnd.cdStart);
  const prefixEnd = Math.max(zipEnd.shift, firstEntry);
  if (prefixEnd > 0) {
    const head = await reader.read(0, 512);
    const found = findSignature(head);
    b.add({
      start: 0,
      end: prefixEnd,
      kind: 'data',
      key: found ? 'zip.prefixKnown' : 'zip.prefix',
      values: { bytes: prefixEnd, ...(found && { format: found.ext }) },
    });
  }
  let budget = CRC_CHECK_BUDGET;
  for (const entry of entries) {
    if (b.full) break;
    const local = await reader.read(entry.offset, 30);
    if (u32le(local, 0) !== 0x04034b50) continue;
    const o = entry.offset;
    const nameLength = u16le(local, 26);
    const headerEnd = o + 30 + nameLength + u16le(local, 28);
    const method = u16le(local, 8);
    // The checksum is over the unpacked content: unpack while the budget lasts.
    let ok: boolean | undefined;
    if (!entry.encrypted && (method === 0 || method === 8) && entry.size <= budget) {
      budget -= entry.size;
      try {
        const packed = await reader.read(headerEnd, entry.compressedSize);
        const content =
          method === 0 ? packed : inflateSync(packed, { out: new Uint8Array(entry.size) });
        ok = crc32(content) === entry.crc;
      } catch {
        ok = false;
      }
    }
    b.add({
      start: o,
      end: headerEnd,
      kind: 'header',
      key: 'zip.local',
      label: entry.name,
      fields: [
        field('identifier', o, 4, 'PK 03 04'),
        field('zipVersion', o + 4, 2, u16le(local, 4) / 10),
        field('zipFlags', o + 6, 2, `0b${u16le(local, 6).toString(2).padStart(16, '0')}`),
        field('zipMethod', o + 8, 2, method, {
          ...([0, 8, 12, 14, 93, 99].includes(method) && { valueKey: `zipMethod.${method}` }),
        }),
        field('modified', o + 10, 4, dosDate(u16le(local, 12), u16le(local, 10))),
        field('crc', o + 14, 4, hex32(entry.crc), ok === undefined ? {} : { ok }),
        field('compressedSize', o + 18, 4, entry.compressedSize),
        field('size', o + 22, 4, entry.size),
        field('nameLength', o + 26, 2, nameLength),
        field('extraLength', o + 28, 2, u16le(local, 28)),
        field('fileName', o + 30, nameLength, entry.name),
      ],
    });
    const dataEnd = Math.min(reader.size, headerEnd + entry.compressedSize);
    b.add({
      start: headerEnd,
      end: dataEnd,
      kind: 'data',
      key: entry.encrypted ? 'zip.dataEncrypted' : 'zip.data',
      label: entry.name,
      values: { bytes: entry.size },
    });
    if (u16le(local, 6) & 0x08) {
      const desc = await reader.read(dataEnd, 4);
      const length = u32le(desc, 0) === 0x08074b50 ? 16 : 12;
      b.add({
        start: dataEnd,
        end: dataEnd + length,
        kind: 'checksum',
        key: 'zip.descriptor',
        label: entry.name,
      });
    }
  }
  if (!b.full) {
    b.add({
      start: zipEnd.cdStart,
      end: zipEnd.cdStart + zipEnd.cdSize,
      kind: 'chunk',
      key: 'zip.central',
      values: { count: zipEnd.entries },
    });
  }
  const record = await reader.read(zipEnd.eocd, 22);
  const end = Math.min(reader.size, zipEnd.eocd + 22 + u16le(record, 20));
  if (zipEnd.cdStart + zipEnd.cdSize < zipEnd.eocd) {
    b.add({
      start: zipEnd.cdStart + zipEnd.cdSize,
      end: zipEnd.eocd,
      kind: 'trailer',
      key: 'zip.zip64',
    });
  }
  const e = zipEnd.eocd;
  b.add({
    start: e,
    end,
    kind: 'trailer',
    key: 'zip.end',
    fields: [
      field('identifier', e, 4, 'PK 05 06'),
      field('entryCount', e + 10, 2, u16le(record, 10)),
      field('directorySize', e + 12, 4, u32le(record, 12)),
      field('directoryOffset', e + 16, 4, u32le(record, 16)),
      field('commentLength', e + 20, 2, u16le(record, 20)),
    ],
  });
  return finish(reader, 'zip', b, end, { entries });
}

// ---------------------------------------------------------------------------

/** Formats the hex viewer can explain. */
export const STRUCTURE_FORMATS = [
  'png',
  'jpg',
  'gif',
  'bmp',
  'wav',
  'webp',
  'avi',
  'pdf',
  ...ZIP_BASED,
  ...Object.keys(MEDIA_FORMATS),
] as const;

/** Reads the file's building blocks – or null when the format is not known here. */
export async function parseStructure(
  reader: ByteReader,
  ext: string,
): Promise<FileStructure | null> {
  if (reader.size === 0) return null;
  try {
    switch (ext) {
      case 'png':
        return await parsePng(reader);
      case 'jpg':
        return await parseJpeg(reader);
      case 'gif':
        return await parseGif(reader);
      case 'bmp':
        return await parseBmp(reader);
      case 'wav':
      case 'webp':
      case 'avi':
        return await parseRiff(reader, ext);
      case 'pdf':
        return await parsePdf(reader);
      default: {
        const media = MEDIA_FORMATS[ext];
        if (media) {
          const found = await media(reader, ext);
          // Nothing recognised: no explanation rather than an empty one.
          return found.regions.length > 0 ? found : null;
        }
        return ZIP_BASED.has(ext) ? await parseZip(reader) : null;
      }
    }
  } catch {
    // A broken file: no explanation rather than a wrong one.
    return null;
  }
}

/** All text keys a structure can use (for the help-text guard). */
export const STRUCTURE_KEYS: readonly string[] = [
  ...MEDIA_STRUCTURE_KEYS,
  'appended',
  'appendedKnown',
  'png.signature',
  ...[...PNG_CHUNKS, 'other'].map((c) => `png.chunks.${c}`),
  'png.chunkData',
  'png.crc',
  'jpg.soi',
  'jpg.eoi',
  'jpg.scan',
  'jpg.segmentData',
  ...[
    'app0',
    'exif',
    'xmp',
    'icc',
    'adobe',
    'app',
    'dht',
    'dqt',
    'dri',
    'sos',
    'com',
    'sof',
    'sofProgressive',
    'other',
  ].map((m) => `jpg.markers.${m}`),
  ...[
    'signature',
    'screen',
    'palette',
    'trailer',
    'gce',
    'app',
    'comment',
    'extension',
    'image',
    'imageData',
  ].map((k) => `gif.${k}`),
  ...['signature', 'fileHeader', 'infoHeader', 'palette', 'pixels'].map((k) => `bmp.${k}`),
  'riff.header',
  'riff.chunkData',
  ...[...RIFF_CHUNKS, 'other'].map((c) => `riff.chunks.${c}`),
  ...['header', 'body', 'trailer'].map((k) => `pdf.${k}`),
  ...[
    'prefix',
    'prefixKnown',
    'local',
    'data',
    'dataEncrypted',
    'descriptor',
    'central',
    'zip64',
    'end',
  ].map((k) => `zip.${k}`),
];

/** The region a byte belongs to (regions are sorted and don't overlap). */
export function regionAt(regions: readonly FileRegion[], offset: number): FileRegion | null {
  let lo = 0;
  let hi = regions.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = regions[mid];
    if (!r) break;
    if (offset < r.start) hi = mid - 1;
    else if (offset >= r.end) lo = mid + 1;
    else return r;
  }
  return null;
}

/** Names of the single values (below `workshop.fields.`) – checked by a test. */
export const FIELD_KEYS: readonly string[] = [
  'length',
  'chunkType',
  'width',
  'height',
  'bitDepth',
  'colorType',
  'compression',
  'filter',
  'interlace',
  'crc',
  'marker',
  'precision',
  'components',
  'identifier',
  'version',
  'densityUnit',
  'xDensity',
  'yDensity',
  'gifFlags',
  'background',
  'aspect',
  'fileSize',
  'reserved',
  'dataOffset',
  'headerSize',
  'planes',
  'bitCount',
  'bmpCompression',
  'imageSize',
  'riffSize',
  'form',
  'audioFormat',
  'channels',
  'sampleRate',
  'byteRate',
  'blockAlign',
  'bitsPerSample',
  'zipVersion',
  'zipFlags',
  'zipMethod',
  'modified',
  'compressedSize',
  'size',
  'nameLength',
  'extraLength',
  'fileName',
  'entryCount',
  'directorySize',
  'directoryOffset',
  'commentLength',
  'largeSize',
  'majorBrand',
  'minorVersion',
  'compatibleBrand',
  'handlerType',
  'tagSize',
  'id3Flags',
  'mpegVersion',
  'layer',
  'bitrate',
  'channelMode',
  'lastBlock',
  'blockType',
  'minBlockSize',
  'maxBlockSize',
  'md5',
  'oggFlags',
  'granule',
  'stream',
  'pageNumber',
  'segments',
  'byteOrder',
  'magic',
  'ifdOffset',
  'tiffEntry',
  'nextIfd',
  'gzFlags',
  'os',
  'tarType',
  'icoType',
  'docType',
  'ebmlVersion',
  'duration',
  'muxingApp',
  'writingApp',
  'codec',
];

/** What codes mean (below `workshop.fieldValues.`) – checked by a test. */
export const FIELD_VALUE_KEYS: readonly string[] = [
  ...[0, 2, 3, 4, 6].map((v) => `pngColor.${v}`),
  'interlace.0',
  'interlace.1',
  ...[0, 1, 2].map((v) => `densityUnit.${v}`),
  ...[0, 1, 2, 3].map((v) => `bmpCompression.${v}`),
  'wavFormat.1',
  'wavFormat.3',
  ...[0, 8, 12, 14, 93, 99].map((v) => `zipMethod.${v}`),
  ...[0, 1, 2, 3].map((v) => `channelMode.${v}`),
  ...['first', 'last', 'continued', 'normal'].map((v) => `oggFlag.${v}`),
  'byteOrder.little',
  'byteOrder.big',
  ...['file', 'folder', 'link'].map((v) => `tarType.${v}`),
];
