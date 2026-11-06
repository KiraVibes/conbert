import {
  BufferedReader,
  ascii,
  u16be,
  u16le,
  u32be,
  u32le,
  u64le,
  type ByteReader,
} from './reader';
import {
  Builder,
  field,
  finish,
  hex32,
  type FileStructure,
  type RegionField,
} from './structure-base';
import { EBML_ELEMENTS, parseEbml } from './structure-ebml';

/**
 * More formats for the hex viewer: video/HEIC boxes, MP3, FLAC, OGG, TIFF,
 * GZIP, TAR and ICO. Same rules as the others: regions in file order, every
 * key has a text under `workshop.structure.`.
 */

// --- ISO media (MP4, MOV, M4A, HEIC, AVIF) ------------------------------------

const BMFF_BOXES = new Set([
  'ftyp',
  'moov',
  'mvhd',
  'trak',
  'tkhd',
  'mdia',
  'mdhd',
  'hdlr',
  'minf',
  'stbl',
  'stsd',
  'stts',
  'stsc',
  'stco',
  'co64',
  'stsz',
  'stss',
  'mdat',
  'free',
  'skip',
  'udta',
  'meta',
  'uuid',
  'moof',
  'mfra',
  'edts',
  'elst',
  'pitm',
  'iloc',
  'iinf',
  'iprp',
  'ipco',
  'ispe',
  'idat',
  'iref',
]);
/** Boxes that only hold other boxes. */
const BMFF_CONTAINERS = new Set([
  'moov',
  'trak',
  'mdia',
  'minf',
  'stbl',
  'dinf',
  'edts',
  'udta',
  'moof',
  'traf',
  'mvex',
  'iprp',
  'ipco',
  'mfra',
]);
const MAX_DEPTH = 8;

async function bmffBoxes(
  reader: ByteReader,
  b: Builder,
  from: number,
  to: number,
  depth: number,
): Promise<number> {
  let pos = from;
  while (pos + 8 <= to && !b.full) {
    const head = await reader.read(pos, 16);
    let size = u32be(head, 0);
    const type = ascii(head, 4, 4);
    if (!/^[\x20-\x7e]{4}$/.test(type)) {
      b.truncated = true;
      return pos;
    }
    let headerSize = 8;
    if (size === 1) {
      size = Number(BigInt(u32be(head, 8)) * 2n ** 32n + BigInt(u32be(head, 12)));
      headerSize = 16;
    } else if (size === 0) {
      size = to - pos; // up to the end of the file
    }
    if (size < headerSize || pos + size > to) {
      b.truncated = true;
      return pos;
    }
    // "meta" is a full box: 4 bytes version/flags before its children.
    const isMeta = type === 'meta';
    const container = (BMFF_CONTAINERS.has(type) || isMeta) && depth < MAX_DEPTH;
    const ownHeader = headerSize + (isMeta ? 4 : 0);
    b.add({
      start: pos,
      end: pos + (container ? ownHeader : headerSize),
      kind: 'chunk',
      key: BMFF_BOXES.has(type) ? `bmff.boxes.${type}` : 'bmff.boxes.other',
      label: type,
      values: { bytes: size },
      fields: [
        field('length', pos, 4, size),
        field('chunkType', pos + 4, 4, type),
        ...(headerSize === 16 ? [field('largeSize', pos + 8, 8, size)] : []),
      ],
    });
    if (container) {
      await bmffBoxes(reader, b, pos + ownHeader, pos + size, depth + 1);
    } else {
      let fields: RegionField[] = [];
      const at = pos + headerSize;
      if (type === 'ftyp' && size >= 16) {
        const d = await reader.read(at, Math.min(size - headerSize, 64));
        const brands: RegionField[] = [];
        for (let i = 8; i + 4 <= d.length; i += 4) {
          brands.push(field('compatibleBrand', at + i, 4, ascii(d, i, 4)));
        }
        fields = [
          field('majorBrand', at, 4, ascii(d, 0, 4)),
          field('minorVersion', at + 4, 4, u32be(d, 4)),
          ...brands,
        ];
      } else if (type === 'hdlr' && size >= headerSize + 12) {
        const d = await reader.read(at, 12);
        fields = [field('handlerType', at + 8, 4, ascii(d, 8, 4))];
      } else if (type === 'ispe' && size >= headerSize + 12) {
        const d = await reader.read(at, 12);
        fields = [field('width', at + 4, 4, u32be(d, 4)), field('height', at + 8, 4, u32be(d, 8))];
      }
      b.add({
        start: at,
        end: pos + size,
        kind: 'data',
        key: type === 'mdat' ? 'bmff.media' : 'bmff.boxData',
        label: type,
        ...(fields.length > 0 && { fields }),
      });
    }
    pos += size;
  }
  return pos;
}

async function parseBmff(reader: ByteReader, format: string): Promise<FileStructure> {
  const b = new Builder();
  const end = await bmffBoxes(reader, b, 0, reader.size, 0);
  return finish(reader, format, b, b.truncated ? null : end);
}

// --- MP3 ---------------------------------------------------------------------

const ID3_FRAMES = new Set([
  'TIT2',
  'TPE1',
  'TPE2',
  'TALB',
  'TYER',
  'TDRC',
  'TRCK',
  'TCON',
  'COMM',
  'APIC',
  'TXXX',
  'TLEN',
  'TSSE',
  'USLT',
  'PRIV',
]);

const synchsafe = (b: Uint8Array, i: number) =>
  (((b[i] ?? 0) & 0x7f) << 21) |
  (((b[i + 1] ?? 0) & 0x7f) << 14) |
  (((b[i + 2] ?? 0) & 0x7f) << 7) |
  ((b[i + 3] ?? 0) & 0x7f);

const MPEG1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const MPEG2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const RATES: Record<number, number[]> = {
  3: [44100, 48000, 32000],
  2: [22050, 24000, 16000],
  0: [11025, 12000, 8000],
};

/** The four bytes in front of every piece of MP3 sound. */
function mpegFrameFields(at: number, h: Uint8Array): RegionField[] | null {
  if (h[0] !== 0xff || ((h[1] ?? 0) & 0xe0) !== 0xe0) return null;
  const version = ((h[1] ?? 0) >> 3) & 3; // 3 = MPEG-1, 2 = MPEG-2, 0 = MPEG-2.5
  const layer = 4 - (((h[1] ?? 0) >> 1) & 3);
  const bitrateIndex = (h[2] ?? 0) >> 4;
  const rateIndex = ((h[2] ?? 0) >> 2) & 3;
  if (version === 1 || layer === 4 || bitrateIndex === 15 || rateIndex === 3) return null;
  const kbps = (version === 3 ? MPEG1_L3 : MPEG2_L3)[bitrateIndex] ?? 0;
  const mode = (h[3] ?? 0) >> 6;
  return [
    field(
      'mpegVersion',
      at + 1,
      1,
      version === 3 ? 'MPEG-1' : version === 2 ? 'MPEG-2' : 'MPEG-2.5',
    ),
    field('layer', at + 1, 1, `Layer ${'I'.repeat(Math.min(layer, 3))}`),
    field('bitrate', at + 2, 1, `${kbps} kbit/s`),
    field('sampleRate', at + 2, 1, RATES[version]?.[rateIndex] ?? 0),
    field('channelMode', at + 3, 1, mode, { valueKey: `channelMode.${mode}` }),
  ];
}

async function parseMp3(reader: ByteReader): Promise<FileStructure> {
  const b = new Builder();
  let pos = 0;
  const head = await reader.read(0, 10);
  if (ascii(head, 0, 3) === 'ID3') {
    const tagSize = synchsafe(head, 6);
    const major = head[3] ?? 3;
    b.add({
      start: 0,
      end: 10,
      kind: 'signature',
      key: 'mp3.id3',
      fields: [
        field('identifier', 0, 3, 'ID3'),
        field('version', 3, 2, `2.${major}.${head[4] ?? 0}`),
        field('id3Flags', 5, 1, `0b${(head[5] ?? 0).toString(2).padStart(8, '0')}`),
        field('tagSize', 6, 4, tagSize),
      ],
    });
    const tagEnd = Math.min(reader.size, 10 + tagSize);
    pos = 10;
    while (pos + 10 <= tagEnd && !b.full) {
      const f = await reader.read(pos, 10);
      const id = ascii(f, 0, 4);
      if (!/^[A-Z0-9]{4}$/.test(id)) break; // padding (zeros) follows
      const size = major >= 4 ? synchsafe(f, 4) : u32be(f, 4);
      b.add({
        start: pos,
        end: pos + 10,
        kind: 'chunk',
        key: ID3_FRAMES.has(id) ? `mp3.frames.${id}` : 'mp3.frames.other',
        label: id,
        values: { bytes: size },
        fields: [field('chunkType', pos, 4, id), field('length', pos + 4, 4, size)],
      });
      const dataEnd = Math.min(tagEnd, pos + 10 + size);
      b.add({ start: pos + 10, end: dataEnd, kind: 'data', key: 'mp3.frameData', label: id });
      pos = dataEnd;
    }
    if (pos < tagEnd) b.add({ start: pos, end: tagEnd, kind: 'data', key: 'mp3.padding' });
    pos = tagEnd;
  }
  // The sound: starts with the first frame header.
  const r = new BufferedReader(reader);
  while (
    pos < reader.size - 1 &&
    !((await r.byte(pos)) === 0xff && ((await r.byte(pos + 1)) & 0xe0) === 0xe0)
  ) {
    pos++;
    if (pos > 1024 * 1024) break;
  }
  const tail = reader.size >= 128 ? await reader.read(reader.size - 128, 3) : new Uint8Array(0);
  const audioEnd = ascii(tail, 0, 3) === 'TAG' ? reader.size - 128 : reader.size;
  if (pos < audioEnd) {
    const frame = await reader.read(pos, 4);
    const fields = mpegFrameFields(pos, frame);
    if (fields) {
      b.add({ start: pos, end: pos + 4, kind: 'header', key: 'mp3.frameHeader', fields });
      pos += 4;
    }
    // Neither a tag nor a sound frame: this is no MP3.
    if (b.regions.length === 0) return finish(reader, 'mp3', b, null);
    b.add({ start: pos, end: audioEnd, kind: 'data', key: 'mp3.audio' });
  }
  if (audioEnd < reader.size) {
    b.add({ start: audioEnd, end: reader.size, kind: 'trailer', key: 'mp3.id3v1' });
  }
  return finish(reader, 'mp3', b, null);
}

// --- FLAC --------------------------------------------------------------------

const FLAC_BLOCKS = [
  'streaminfo',
  'padding',
  'application',
  'seektable',
  'vorbisComment',
  'cuesheet',
  'picture',
];

async function parseFlac(reader: ByteReader): Promise<FileStructure> {
  const b = new Builder();
  b.add({ start: 0, end: 4, kind: 'signature', key: 'flac.signature' });
  let pos = 4;
  for (;;) {
    if (pos + 4 > reader.size || b.full) break;
    const h = await reader.read(pos, 4);
    const last = ((h[0] ?? 0) & 0x80) !== 0;
    const type = (h[0] ?? 0) & 0x7f;
    const length = ((h[1] ?? 0) << 16) | ((h[2] ?? 0) << 8) | (h[3] ?? 0);
    const name = FLAC_BLOCKS[type] ?? 'other';
    b.add({
      start: pos,
      end: pos + 4,
      kind: 'chunk',
      key: `flac.blocks.${name}`,
      values: { bytes: length },
      fields: [
        field('lastBlock', pos, 1, last ? 1 : 0),
        field('blockType', pos, 1, type),
        field('length', pos + 1, 3, length),
      ],
    });
    const at = pos + 4;
    let fields: RegionField[] = [];
    if (type === 0 && length >= 34) {
      const d = await reader.read(at, 34);
      // 20 bits sample rate, 3 bits channels − 1, 5 bits bits per sample − 1.
      const rate = ((d[10] ?? 0) << 12) | ((d[11] ?? 0) << 4) | ((d[12] ?? 0) >> 4);
      const channels = (((d[12] ?? 0) >> 1) & 7) + 1;
      const bits = ((((d[12] ?? 0) & 1) << 4) | ((d[13] ?? 0) >> 4)) + 1;
      const md5 = [...d.subarray(18, 34)].map((x) => x.toString(16).padStart(2, '0')).join('');
      fields = [
        field('minBlockSize', at, 2, u16be(d, 0)),
        field('maxBlockSize', at + 2, 2, u16be(d, 2)),
        field('sampleRate', at + 10, 3, rate),
        field('channels', at + 12, 1, channels),
        field('bitsPerSample', at + 12, 2, bits),
        field('md5', at + 18, 16, md5),
      ];
    }
    b.add({
      start: at,
      end: Math.min(reader.size, at + length),
      kind: 'data',
      key: 'flac.blockData',
      ...(fields.length > 0 && { fields }),
    });
    pos = at + length;
    if (last) break;
  }
  if (pos < reader.size) b.add({ start: pos, end: reader.size, kind: 'data', key: 'flac.audio' });
  return finish(reader, 'flac', b, null);
}

// --- OGG (Vorbis, Opus) --------------------------------------------------------

async function parseOgg(reader: ByteReader): Promise<FileStructure> {
  const b = new Builder();
  let pos = 0;
  while (pos + 27 <= reader.size && !b.full) {
    const h = await reader.read(pos, 27 + 255);
    if (ascii(h, 0, 4) !== 'OggS') break;
    const segments = h[26] ?? 0;
    let body = 0;
    for (let i = 0; i < segments; i++) body += h[27 + i] ?? 0;
    const headerEnd = pos + 27 + segments;
    const type = h[5] ?? 0;
    b.add({
      start: pos,
      end: headerEnd,
      kind: 'chunk',
      key: 'ogg.page',
      label: `#${u32le(h, 18)}`,
      values: { bytes: body },
      fields: [
        field('identifier', pos, 4, 'OggS'),
        field('oggFlags', pos + 5, 1, type, {
          valueKey:
            type & 2
              ? 'oggFlag.first'
              : type & 4
                ? 'oggFlag.last'
                : type & 1
                  ? 'oggFlag.continued'
                  : 'oggFlag.normal',
        }),
        field('granule', pos + 6, 8, u64le(h, 6)),
        field('stream', pos + 14, 4, hex32(u32le(h, 14))),
        field('pageNumber', pos + 18, 4, u32le(h, 18)),
        field('crc', pos + 22, 4, hex32(u32le(h, 22))),
        field('segments', pos + 26, 1, segments),
      ],
    });
    const end = Math.min(reader.size, headerEnd + body);
    b.add({ start: headerEnd, end, kind: 'data', key: 'ogg.data' });
    pos = end;
  }
  return finish(reader, 'ogg', b, b.full ? null : pos);
}

// --- TIFF (and camera RAW files built on it) -----------------------------------

const TIFF_TAGS: Record<number, string> = {
  256: 'ImageWidth',
  257: 'ImageLength',
  258: 'BitsPerSample',
  259: 'Compression',
  262: 'PhotometricInterpretation',
  270: 'ImageDescription',
  271: 'Make',
  272: 'Model',
  273: 'StripOffsets',
  274: 'Orientation',
  277: 'SamplesPerPixel',
  278: 'RowsPerStrip',
  279: 'StripByteCounts',
  282: 'XResolution',
  283: 'YResolution',
  296: 'ResolutionUnit',
  305: 'Software',
  306: 'DateTime',
  315: 'Artist',
  330: 'SubIFDs',
  33432: 'Copyright',
  34665: 'ExifIFD',
  34853: 'GPSInfo',
};

async function parseTiff(reader: ByteReader): Promise<FileStructure> {
  const b = new Builder();
  const head = await reader.read(0, 8);
  const little = ascii(head, 0, 2) === 'II';
  const u16 = (d: Uint8Array, i: number) => (little ? u16le(d, i) : u16be(d, i));
  const u32 = (d: Uint8Array, i: number) => (little ? u32le(d, i) : u32be(d, i));
  b.add({
    start: 0,
    end: 8,
    kind: 'signature',
    key: 'tiff.header',
    fields: [
      field('byteOrder', 0, 2, little ? 'II' : 'MM', {
        valueKey: `byteOrder.${little ? 'little' : 'big'}`,
      }),
      field('magic', 2, 2, u16(head, 2)),
      field('ifdOffset', 4, 4, u32(head, 4)),
    ],
  });
  const seen = new Set<number>();
  let next = u32(head, 4);
  let n = 0;
  while (next > 0 && next + 2 <= reader.size && !seen.has(next) && n < 64 && !b.full) {
    seen.add(next);
    n++;
    const count = u16(await reader.read(next, 2), 0);
    const size = 2 + count * 12 + 4;
    const d = await reader.read(next, size);
    const fields: RegionField[] = [field('entryCount', next, 2, count)];
    for (let i = 0; i < Math.min(count, 200); i++) {
      const at = 2 + i * 12;
      const tag = u16(d, at);
      const type = u16(d, at + 2);
      const valueCount = u32(d, at + 4);
      // Short values sit right in the entry; longer ones elsewhere (shown as their position).
      const value =
        type === 3 && valueCount === 1
          ? u16(d, at + 8)
          : type === 4 && valueCount === 1
            ? u32(d, at + 8)
            : `→ 0x${u32(d, at + 8)
                .toString(16)
                .toUpperCase()}`;
      fields.push(
        field('tiffEntry', next + at, 12, `${TIFF_TAGS[tag] ?? `Tag ${tag}`} = ${value}`),
      );
    }
    fields.push(field('nextIfd', next + 2 + count * 12, 4, u32(d, 2 + count * 12)));
    b.add({
      start: next,
      end: Math.min(reader.size, next + size),
      kind: 'chunk',
      key: 'tiff.ifd',
      label: `IFD ${n - 1}`,
      values: { count },
      fields,
    });
    next = u32(d, 2 + count * 12);
  }
  // The picture data sits between and behind the directories; no end can be told.
  return finish(reader, 'tiff', b, null);
}

// --- GZIP ----------------------------------------------------------------------

const GZIP_OS: Record<number, string> = {
  0: 'FAT/Windows',
  3: 'Unix',
  7: 'macOS',
  11: 'NTFS',
  255: '?',
};

async function parseGzip(reader: ByteReader): Promise<FileStructure> {
  const b = new Builder();
  const h = await reader.read(0, 1024);
  const flags = h[3] ?? 0;
  let pos = 10;
  let name = '';
  if (flags & 4) pos += 2 + u16le(h, pos); // extra field
  if (flags & 8) {
    const zero = h.indexOf(0, pos);
    name = new TextDecoder('latin1').decode(h.subarray(pos, zero < 0 ? pos : zero));
    pos = zero < 0 ? pos : zero + 1;
  }
  if (flags & 16) {
    const zero = h.indexOf(0, pos);
    pos = zero < 0 ? pos : zero + 1;
  }
  if (flags & 2) pos += 2;
  const mtime = u32le(h, 4);
  b.add({
    start: 0,
    end: pos,
    kind: 'header',
    key: 'gz.header',
    fields: [
      field('identifier', 0, 2, '1F 8B'),
      field('zipMethod', 2, 1, h[2] ?? 0, { valueKey: 'zipMethod.8' }),
      field('gzFlags', 3, 1, `0b${flags.toString(2).padStart(8, '0')}`),
      field(
        'modified',
        4,
        4,
        mtime ? new Date(mtime * 1000).toISOString().replace('T', ' ').slice(0, 19) : '–',
      ),
      field('os', 9, 1, GZIP_OS[h[9] ?? 255] ?? String(h[9])),
      ...(name ? [field('fileName', 10, name.length + 1, name)] : []),
    ],
  });
  if (reader.size - 8 > pos) {
    b.add({ start: pos, end: reader.size - 8, kind: 'data', key: 'gz.data' });
    const t = await reader.read(reader.size - 8, 8);
    b.add({
      start: reader.size - 8,
      end: reader.size,
      kind: 'checksum',
      key: 'gz.trailer',
      fields: [
        field('crc', reader.size - 8, 4, hex32(u32le(t, 0))),
        field('size', reader.size - 4, 4, u32le(t, 4)),
      ],
    });
  }
  return finish(reader, 'gz', b, null);
}

// --- TAR -----------------------------------------------------------------------

const octal = (d: Uint8Array, i: number, n: number) =>
  Number.parseInt(ascii(d, i, n).replace(/\0.*$/, '').trim() || '0', 8) || 0;

async function parseTar(reader: ByteReader): Promise<FileStructure> {
  const b = new Builder();
  let pos = 0;
  let end: number | null = null;
  while (pos + 512 <= reader.size && !b.full) {
    const h = await reader.read(pos, 512);
    if (h.every((x) => x === 0)) {
      // Two empty blocks end the archive.
      end = Math.min(reader.size, pos + 1024);
      b.add({ start: pos, end, kind: 'trailer', key: 'tar.end' });
      break;
    }
    const name = ascii(h, 0, 100).replace(/\0.*$/s, '');
    const size = octal(h, 124, 12);
    const mtime = octal(h, 136, 12);
    const type = String.fromCharCode(h[156] ?? 48);
    b.add({
      start: pos,
      end: pos + 512,
      kind: 'header',
      key: 'tar.header',
      label: name,
      fields: [
        field('fileName', pos, 100, name),
        field('size', pos + 124, 12, size),
        field(
          'modified',
          pos + 136,
          12,
          new Date(mtime * 1000).toISOString().replace('T', ' ').slice(0, 19),
        ),
        field('tarType', pos + 156, 1, type, {
          ...(['0', '5', '2'].includes(type) && {
            valueKey: `tarType.${type === '0' ? 'file' : type === '5' ? 'folder' : 'link'}`,
          }),
        }),
      ],
    });
    const padded = Math.ceil(size / 512) * 512;
    if (padded > 0) {
      b.add({
        start: pos + 512,
        end: Math.min(reader.size, pos + 512 + padded),
        kind: 'data',
        key: 'tar.data',
        label: name,
        values: { bytes: size },
      });
    }
    pos += 512 + padded;
  }
  return finish(reader, 'tar', b, end);
}

// --- ICO -----------------------------------------------------------------------

async function parseIco(reader: ByteReader): Promise<FileStructure> {
  const b = new Builder();
  const h = await reader.read(0, 6);
  const count = u16le(h, 4);
  b.add({
    start: 0,
    end: 6,
    kind: 'signature',
    key: 'ico.header',
    fields: [field('icoType', 2, 2, u16le(h, 2)), field('entryCount', 4, 2, count)],
  });
  const dir = await reader.read(6, count * 16);
  const images: { offset: number; size: number; w: number; h: number }[] = [];
  for (let i = 0; i < count && (i + 1) * 16 <= dir.length; i++) {
    const at = 6 + i * 16;
    const d = dir.subarray(i * 16);
    const w = d[0] || 256;
    const hh = d[1] || 256;
    const size = u32le(d, 8);
    const offset = u32le(d, 12);
    images.push({ offset, size, w, h: hh });
    b.add({
      start: at,
      end: at + 16,
      kind: 'chunk',
      key: 'ico.entry',
      label: `${w}×${hh}`,
      fields: [
        field('width', at, 1, w),
        field('height', at + 1, 1, hh),
        field('bitCount', at + 6, 2, u16le(d, 6)),
        field('size', at + 8, 4, size),
        field('dataOffset', at + 12, 4, offset),
      ],
    });
  }
  let end = 6 + count * 16;
  for (const img of images.sort((x, y) => x.offset - y.offset)) {
    if (img.offset < end || img.offset + img.size > reader.size) continue;
    const sig = await reader.read(img.offset, 4);
    b.add({
      start: img.offset,
      end: img.offset + img.size,
      kind: 'data',
      key: ascii(sig, 1, 3) === 'PNG' ? 'ico.png' : 'ico.bitmap',
      label: `${img.w}×${img.h}`,
    });
    end = img.offset + img.size;
  }
  return finish(reader, 'ico', b, end);
}

// -------------------------------------------------------------------------------

export const MEDIA_FORMATS: Record<
  string,
  (reader: ByteReader, ext: string) => Promise<FileStructure>
> = {
  mp4: parseBmff,
  mov: parseBmff,
  m4a: parseBmff,
  m4v: parseBmff,
  heic: parseBmff,
  heif: parseBmff,
  avif: parseBmff,
  '3gp': parseBmff,
  mp3: parseMp3,
  flac: parseFlac,
  ogg: parseOgg,
  opus: parseOgg,
  oga: parseOgg,
  tiff: parseTiff,
  dng: parseTiff,
  cr2: parseTiff,
  nef: parseTiff,
  arw: parseTiff,
  gz: parseGzip,
  tgz: parseGzip,
  tar: parseTar,
  ico: parseIco,
  cur: parseIco,
  mkv: parseEbml,
  mka: parseEbml,
  mk3d: parseEbml,
  webm: parseEbml,
};

/** All text keys the media readers use (for the help-text guard). */
export const MEDIA_STRUCTURE_KEYS: readonly string[] = [
  ...[...BMFF_BOXES, 'other'].map((x) => `bmff.boxes.${x}`),
  'bmff.boxData',
  'bmff.media',
  'mp3.id3',
  ...[...ID3_FRAMES, 'other'].map((x) => `mp3.frames.${x}`),
  'mp3.frameData',
  'mp3.padding',
  'mp3.frameHeader',
  'mp3.audio',
  'mp3.id3v1',
  'flac.signature',
  ...[...FLAC_BLOCKS, 'other'].map((x) => `flac.blocks.${x}`),
  'flac.blockData',
  'flac.audio',
  'ogg.page',
  'ogg.data',
  'tiff.header',
  'tiff.ifd',
  'gz.header',
  'gz.data',
  'gz.trailer',
  'tar.header',
  'tar.data',
  'tar.end',
  'ico.header',
  'ico.entry',
  'ico.png',
  'ico.bitmap',
  'mkv.signature',
  'mkv.header',
  'mkv.segment',
  ...EBML_ELEMENTS.map((x) => `mkv.elements.${x}`),
];
