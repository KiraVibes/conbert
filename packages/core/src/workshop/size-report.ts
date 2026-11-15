/**
 * "Why is my file so big?" – takes a file apart and says what the bytes are:
 * pictures in a Word file, the video track of an MP4, a video glued to a
 * photo, fonts in a PDF … plus tips what would make it smaller.
 */
import { zipSync, type Zippable } from 'fflate';
import type { ByteReader } from './reader';
import { findZipEnd, readZipEntries } from './structure';
import { extractZipEntry } from './zip-tools';

export const SIZE_FILE_KINDS = [
  'office',
  'epub',
  'zip',
  'pdf',
  'mp4',
  'jpeg',
  'png',
  'wav',
  'bmp',
  'other',
] as const;
export type SizeFileKind = (typeof SIZE_FILE_KINDS)[number];

export const SIZE_PART_KINDS = [
  'images',
  'picture',
  'video',
  'audio',
  'subtitles',
  'media',
  'fonts',
  'embedded',
  'thumbnail',
  'text',
  'metadata',
  'appended',
  'structure',
  'other',
] as const;
export type SizePartKind = (typeof SIZE_PART_KINDS)[number];

export const SIZE_TIPS = [
  'shrinkImages',
  'compressPdf',
  'pdfFonts',
  'pdfAttachments',
  'compressVideo',
  'pcmAudio',
  'wavToSmaller',
  'appended',
  'motionPhoto',
  'photoAsPng',
  'bigMetadata',
  'uncompressedImage',
  'embeddedObjects',
  'bigThumbnail',
  'alreadyPacked',
  'packable',
  'nothingBig',
] as const;
export type SizeTipKey = (typeof SIZE_TIPS)[number];

/** What a tip's button does (if it has one). */
export type SizeAction = 'shrinkImages' | 'compress' | 'stripAppended';

export interface SizeItem {
  name: string;
  bytes: number;
  /** Extra info, e.g. "1920×1080 JPEG". */
  note?: string;
}

export interface SizePart {
  kind: SizePartKind;
  bytes: number;
  /** The biggest single pieces of this part (at most 8). */
  items: SizeItem[];
}

export interface SizeTip {
  key: SizeTipKey;
  action?: SizeAction;
  values?: Record<string, string | number>;
}

export interface SizeReport {
  kind: SizeFileKind;
  total: number;
  parts: SizePart[];
  tips: SizeTip[];
  /** Where data glued after the real end starts (for "cut it off"). */
  appendedAt?: number;
}

const u16be = (b: Uint8Array, o: number) => ((b[o] ?? 0) << 8) | (b[o + 1] ?? 0);
const u32be = (b: Uint8Array, o: number) =>
  ((b[o] ?? 0) * 0x1000000 +
    (((b[o + 1] ?? 0) << 16) | ((b[o + 2] ?? 0) << 8) | (b[o + 3] ?? 0))) >>>
  0;
const u16le = (b: Uint8Array, o: number) => (b[o] ?? 0) | ((b[o + 1] ?? 0) << 8);
const u32le = (b: Uint8Array, o: number) =>
  ((b[o] ?? 0) | ((b[o + 1] ?? 0) << 8) | ((b[o + 2] ?? 0) << 16)) + (b[o + 3] ?? 0) * 0x1000000;
const ascii = (b: Uint8Array, o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));
const MB = 1024 * 1024;

/** Collects bytes per part; turns them into the sorted report. */
class Parts {
  private map = new Map<SizePartKind, SizePart>();
  add(kind: SizePartKind, bytes: number, item?: SizeItem) {
    if (bytes <= 0) return;
    let p = this.map.get(kind);
    if (!p) {
      p = { kind, bytes: 0, items: [] };
      this.map.set(kind, p);
    }
    p.bytes += bytes;
    if (item) p.items.push(item);
  }
  get(kind: SizePartKind) {
    return this.map.get(kind)?.bytes ?? 0;
  }
  list(): SizePart[] {
    return [...this.map.values()]
      .map((p) => ({ ...p, items: p.items.sort((a, b) => b.bytes - a.bytes).slice(0, 8) }))
      .sort((a, b) => b.bytes - a.bytes);
  }
}

function report(
  kind: SizeFileKind,
  total: number,
  parts: Parts,
  tips: SizeTip[],
  appendedAt?: number,
): SizeReport {
  // Whatever is left over: headers, tables, gaps.
  const known = parts.list().reduce((s, p) => s + p.bytes, 0);
  if (total - known > 0) parts.add('structure', total - known);
  const out: SizeReport = { kind, total, parts: parts.list(), tips };
  if (appendedAt !== undefined) out.appendedAt = appendedAt;
  if (tips.length === 0) out.tips.push({ key: 'nothingBig' });
  return out;
}

const share = (part: number, total: number) => (total > 0 ? part / total : 0);
const pct = (v: number) => Math.round(v * 100);

/* ------------------------------------------------------------- ZIP / Office */

const IMAGE_EXT = /\.(png|jpe?g|gif|bmp|tiff?|emf|wmf|svg|webp|heic|jxr|wdp)$/i;
const MEDIA_EXT = /\.(mp4|m4v|mov|avi|wmv|mpe?g|mkv|webm|mp3|wav|m4a|aac|ogg|wma|flac)$/i;
const FONT_EXT = /\.(ttf|otf|odttf|woff2?|fntdata|eot)$/i;
const TEXT_EXT = /\.(xml|rels|x?html?|css|txt|json|opf|ncx|js)$/i;

function zipPartOf(name: string): SizePartKind {
  if (/^docProps\/thumbnail\.|^Thumbnails\//i.test(name)) return 'thumbnail';
  if (/(^|\/)embeddings\/|oleObject|\.bin$|^ObjectReplacements\/|^Object \d+\//i.test(name))
    return 'embedded';
  if (IMAGE_EXT.test(name)) return 'images';
  if (MEDIA_EXT.test(name)) return 'media';
  if (FONT_EXT.test(name)) return 'fonts';
  if (TEXT_EXT.test(name) || name === 'mimetype') return 'text';
  return 'other';
}

async function zipReport(reader: ByteReader): Promise<SizeReport | null> {
  const end = await findZipEnd(reader);
  if (!end) return null;
  const entries = await readZipEntries(reader, end);
  const names = entries.map((e) => e.name);
  const kind: SizeFileKind =
    names.includes('word/document.xml') ||
    names.includes('xl/workbook.xml') ||
    names.includes('ppt/presentation.xml') ||
    (names.includes('content.xml') && names.includes('meta.xml'))
      ? 'office'
      : names.includes('META-INF/container.xml')
        ? 'epub'
        : 'zip';
  const parts = new Parts();
  for (const e of entries) {
    if (e.directory) continue;
    const part = kind === 'zip' ? (IMAGE_EXT.test(e.name) ? 'images' : 'other') : zipPartOf(e.name);
    parts.add(part, e.compressedSize, { name: e.name, bytes: e.compressedSize });
  }
  const total = reader.size;
  const tips: SizeTip[] = [];
  if (kind !== 'zip') {
    const images = parts.get('images');
    if (share(images, total) >= 0.3 && images > 300 * 1024)
      tips.push({
        key: 'shrinkImages',
        action: 'shrinkImages',
        values: { share: pct(share(images, total)) },
      });
    if (share(parts.get('embedded'), total) >= 0.2) tips.push({ key: 'embeddedObjects' });
    if (parts.get('thumbnail') > 200 * 1024) tips.push({ key: 'bigThumbnail' });
  }
  if (share(parts.get('media'), total) >= 0.3) tips.push({ key: 'compressVideo', values: {} });
  return report(kind, total, parts, tips);
}

/** Can this file's pictures be shrunk in place (Office, OpenDocument, EPUB)? */
export function canShrinkImages(r: SizeReport): boolean {
  return r.kind === 'office' || r.kind === 'epub';
}

/**
 * A copy of an Office/EPUB file with smaller pictures. `shrink` gets each
 * picture (name, bytes) and returns a smaller version in the *same* format,
 * or null to keep it. Only pictures that really got smaller are replaced.
 */
export async function shrinkZipImages(
  reader: ByteReader,
  shrink: (name: string, bytes: Uint8Array) => Promise<Uint8Array | null>,
  onProgress?: (share: number) => void,
): Promise<{ bytes: Uint8Array; replaced: number; saved: number }> {
  const end = await findZipEnd(reader);
  if (!end) throw new Error('not a zip');
  const entries = (await readZipEntries(reader, end)).filter((e) => !e.directory);
  const files: Zippable = {};
  let replaced = 0;
  let saved = 0;
  for (const [i, e] of entries.entries()) {
    onProgress?.(i / entries.length);
    let data: Uint8Array = await extractZipEntry(reader, e);
    if (/\.(png|jpe?g)$/i.test(e.name) && data.length > 50 * 1024) {
      const smaller = await shrink(e.name, data).catch(() => null);
      if (smaller && smaller.length < data.length * 0.9) {
        saved += data.length - smaller.length;
        replaced++;
        data = smaller;
      }
    }
    // ODF and EPUB want "mimetype" first and uncompressed; pictures don't pack.
    const level = e.name === 'mimetype' || /\.(png|jpe?g|gif|mp4|mp3)$/i.test(e.name) ? 0 : 6;
    files[e.name] = [data, { level }];
  }
  onProgress?.(1);
  return { bytes: zipSync(files), replaced, saved };
}

/** EXIF orientation of a JPEG (1 = normal); pictures turned by a tag are left alone. */
export function jpegOrientation(b: Uint8Array): number {
  let p = 2;
  while (p + 4 < b.length && b[p] === 0xff) {
    const marker = b[p + 1] ?? 0;
    const len = u16be(b, p + 2);
    if (marker === 0xe1 && ascii(b, p + 4, 4) === 'Exif') {
      const t = p + 10;
      const le = ascii(b, t, 2) === 'II';
      const r16 = (o: number) => (le ? u16le(b, o) : u16be(b, o));
      const r32 = (o: number) => (le ? u32le(b, o) : u32be(b, o));
      const ifd = t + r32(t + 4);
      const n = r16(ifd);
      for (let i = 0; i < n; i++) {
        const e = ifd + 2 + i * 12;
        if (r16(e) === 0x0112) return r16(e + 8);
      }
      return 1;
    }
    if (marker === 0xda) break;
    p += 2 + len;
  }
  return 1;
}

/* --------------------------------------------------------------------- PDF */

async function pdfReport(reader: ByteReader): Promise<SizeReport> {
  const total = reader.size;
  const bytes = await reader.read(0, Math.min(total, 512 * MB));
  const s = new TextDecoder('latin1').decode(bytes);
  const parts = new Parts();
  let pos = 0;
  let images = 0;
  for (;;) {
    const at = s.indexOf('stream', pos);
    if (at < 0) break;
    pos = at + 6;
    // "endstream" contains "stream" too; a real start follows ">>" and a line break.
    if (s.startsWith('end', at - 3)) continue;
    const before = s.slice(Math.max(0, at - 4096), at);
    if (!/>>\s*$/.test(before)) continue;
    let dataStart = at + 6;
    if (s[dataStart] === '\r') dataStart++;
    if (s[dataStart] === '\n') dataStart++;
    const stop = s.indexOf('endstream', dataStart);
    if (stop < 0) break;
    const length = stop - dataStart;
    const head = before.slice(before.lastIndexOf(' obj') + 4);
    const name = `#${before.slice(0, before.lastIndexOf(' obj')).match(/(\d+)\s+\d+\s*$/)?.[1] ?? '?'}`;
    if (/\/Subtype\s*\/Image/.test(head)) {
      images++;
      const w = head.match(/\/Width\s+(\d+)/)?.[1];
      const h = head.match(/\/Height\s+(\d+)/)?.[1];
      const filter = /DCTDecode/.test(head)
        ? 'JPEG'
        : /JPXDecode/.test(head)
          ? 'JPEG 2000'
          : /JBIG2/.test(head)
            ? 'JBIG2'
            : /FlateDecode/.test(head)
              ? 'Flate'
              : 'raw';
      parts.add('images', length, {
        name: `${name}`,
        bytes: length,
        note: w && h ? `${w}×${h} ${filter}` : filter,
      });
    } else if (/\/Type\s*\/EmbeddedFile/.test(head))
      parts.add('embedded', length, { name, bytes: length });
    else if (/\/Length1|\/Subtype\s*\/(Type1C|CIDFontType0C|OpenType)/.test(head))
      parts.add('fonts', length, { name, bytes: length });
    else if (
      /\/Type\s*\/Metadata|\/Alternate\s*\/Device|\/N\s+[134]\b(?![\s\S]*\/Subtype)/.test(head)
    )
      parts.add('metadata', length);
    else if (/\/Type\s*\/(XRef|ObjStm)/.test(head)) parts.add('structure', length);
    else parts.add('text', length);
    pos = stop + 9;
  }
  const tips: SizeTip[] = [];
  if (share(parts.get('images'), total) >= 0.4 && total > 500 * 1024)
    tips.push({
      key: 'compressPdf',
      action: 'compress',
      values: { share: pct(share(parts.get('images'), total)), count: images },
    });
  if (share(parts.get('fonts'), total) >= 0.3 && total > 300 * 1024) tips.push({ key: 'pdfFonts' });
  if (share(parts.get('embedded'), total) >= 0.2) tips.push({ key: 'pdfAttachments' });
  return report('pdf', total, parts, tips);
}

/* ----------------------------------------------------------------- MP4/MOV */

interface Box {
  type: string;
  start: number;
  size: number;
  header: number;
}

async function boxes(reader: ByteReader, from: number, to: number): Promise<Box[]> {
  const out: Box[] = [];
  let p = from;
  while (p + 8 <= to && out.length < 10_000) {
    const h = await reader.read(p, 16);
    let size = u32be(h, 0);
    const type = ascii(h, 4, 4);
    let header = 8;
    if (size === 1) {
      size = u32be(h, 8) * 0x100000000 + u32be(h, 12);
      header = 16;
    } else if (size === 0) size = to - p;
    if (size < header || !/^[\x20-\x7e]{4}$/.test(type)) break;
    out.push({ type, start: p, size, header });
    p += size;
  }
  return out;
}

const children = (b: Uint8Array, from: number, to: number): Box[] => {
  const out: Box[] = [];
  let p = from;
  while (p + 8 <= to) {
    const size = u32be(b, p);
    if (size < 8 || p + size > to) break;
    out.push({ type: ascii(b, p + 4, 4), start: p, size, header: 8 });
    p += size;
  }
  return out;
};
const child = (b: Uint8Array, box: Box | undefined, type: string, skip = 0) =>
  box
    ? children(b, box.start + box.header + skip, box.start + box.size).find((c) => c.type === type)
    : undefined;

const PCM = new Set(['lpcm', 'sowt', 'twos', 'in24', 'in32', 'fl32', 'fl64', 'raw ']);

async function mp4Report(reader: ByteReader): Promise<SizeReport | null> {
  const total = reader.size;
  const top = await boxes(reader, 0, total);
  const moovBox = top.find((b) => b.type === 'moov');
  if (!moovBox || moovBox.size > 200 * MB) return null;
  const moov = await reader.read(moovBox.start, moovBox.size);
  const m: Box = { ...moovBox, start: 0 };
  const parts = new Parts();
  const tips: SizeTip[] = [];
  for (const trak of children(moov, m.header, m.size).filter((c) => c.type === 'trak')) {
    const mdia = child(moov, trak, 'mdia');
    const hdlr = child(moov, mdia, 'hdlr');
    const mdhd = child(moov, mdia, 'mdhd');
    const stbl = child(moov, child(moov, mdia, 'minf'), 'stbl');
    const stsz = child(moov, stbl, 'stsz');
    const stsd = child(moov, stbl, 'stsd');
    if (!hdlr || !stsz) continue;
    const handler = ascii(moov, hdlr.start + 16, 4);
    let bytes = 0;
    const fixed = u32be(moov, stsz.start + 12);
    const count = u32be(moov, stsz.start + 16);
    if (fixed) bytes = fixed * count;
    else for (let i = 0; i < count; i++) bytes += u32be(moov, stsz.start + 20 + i * 4);
    let seconds = 0;
    if (mdhd) {
      const v1 = moov[mdhd.start + 8] === 1;
      const scale = u32be(moov, mdhd.start + (v1 ? 28 : 20));
      const dur = v1
        ? u32be(moov, mdhd.start + 32) * 0x100000000 + u32be(moov, mdhd.start + 36)
        : u32be(moov, mdhd.start + 24);
      seconds = scale ? dur / scale : 0;
    }
    const entry = stsd ? stsd.start + 16 : 0;
    const codec = stsd ? ascii(moov, entry + 4, 4) : '?';
    const mbps = seconds > 0 ? (bytes * 8) / seconds / 1e6 : 0;
    const rate = mbps >= 1 ? `${mbps.toFixed(1)} Mbit/s` : `${Math.round(mbps * 1000)} kbit/s`;
    if (handler === 'vide') {
      const w = u16be(moov, entry + 32);
      const h = u16be(moov, entry + 34);
      parts.add('video', bytes, { name: codec.trim(), bytes, note: `${w}×${h} · ${rate}` });
      // Roughly what a good H.264 encode needs for this size.
      const enough = Math.max(2, ((w * h) / (1920 * 1080)) * 8);
      if (mbps > enough * 1.5 && bytes > 20 * MB)
        tips.push({
          key: 'compressVideo',
          action: 'compress',
          values: { mbps: mbps.toFixed(1), enough: Math.round(enough) },
        });
    } else if (handler === 'soun') {
      parts.add('audio', bytes, { name: codec.trim(), bytes, note: rate });
      if (PCM.has(codec) && bytes > 5 * MB) tips.push({ key: 'pcmAudio', action: 'compress' });
    } else if (handler === 'text' || handler === 'sbtl' || handler === 'subt')
      parts.add('subtitles', bytes, { name: codec.trim(), bytes });
    else parts.add('metadata', bytes, { name: handler, bytes });
  }
  const udta = top.filter((b) => b.type === 'meta' || b.type === 'udta');
  for (const b of udta) parts.add('metadata', b.size);
  return report('mp4', total, parts, tips);
}

/* --------------------------------------------------------------- JPEG, PNG */

async function jpegReport(reader: ByteReader): Promise<SizeReport> {
  const total = reader.size;
  const parts = new Parts();
  const tips: SizeTip[] = [];
  const head = await reader.read(0, Math.min(total, 4 * MB));
  let p = 2;
  let sos = -1;
  while (p + 4 <= head.length) {
    if (head[p] !== 0xff) break;
    const marker = head[p + 1] ?? 0;
    if (marker === 0xda) {
      sos = p;
      break;
    }
    const len = u16be(head, p + 2);
    const id = ascii(head, p + 4, 4);
    if (marker >= 0xe0 && marker <= 0xef) {
      const name =
        marker === 0xe1 && id === 'Exif'
          ? 'EXIF'
          : marker === 0xe1
            ? 'XMP'
            : marker === 0xe2
              ? 'ICC'
              : marker === 0xed
                ? 'Photoshop'
                : `APP${marker - 0xe0}`;
      parts.add('metadata', len + 2, { name, bytes: len + 2 });
    }
    p += 2 + len;
  }
  let end = total;
  if (sos >= 0) {
    // The end marker FF D9 after the picture data (stuffed FF bytes are followed by 00).
    const CHUNK = 4 * MB;
    let found = -1;
    for (let at = sos; at < total && found < 0; at += CHUNK - 1) {
      const c = await reader.read(at, CHUNK);
      for (let i = 0; i + 1 < c.length; i++) {
        if (c[i] === 0xff && c[i + 1] === 0xd9) {
          found = at + i + 2;
          break;
        }
      }
    }
    if (found > 0) end = found;
    parts.add('picture', end - sos);
  }
  if (share(parts.get('metadata'), total) >= 0.2 && parts.get('metadata') > 64 * 1024)
    tips.push({ key: 'bigMetadata', action: 'compress' });
  let appendedAt: number | undefined;
  if (total - end > 1024) {
    appendedAt = end;
    const tail = await reader.read(end, 64);
    const video = ascii(tail, 4, 4) === 'ftyp';
    parts.add('appended', total - end, { name: video ? 'MP4' : '?', bytes: total - end });
    tips.push({ key: video ? 'motionPhoto' : 'appended', action: 'stripAppended' });
  }
  return report('jpeg', total, parts, tips, appendedAt);
}

async function pngReport(reader: ByteReader): Promise<SizeReport> {
  const total = reader.size;
  const parts = new Parts();
  const tips: SizeTip[] = [];
  let p = 8;
  let end = total;
  let w = 0;
  let h = 0;
  let colorType = 0;
  while (p + 12 <= total) {
    const head = await reader.read(p, 26);
    const len = u32be(head, 0);
    const type = ascii(head, 4, 4);
    if (type === 'IHDR') {
      w = u32be(head, 8);
      h = u32be(head, 12);
      colorType = head[17] ?? 0;
    }
    const size = len + 12;
    if (type === 'IDAT' || type === 'fdAT') parts.add('picture', size);
    else if (/^(tEXt|zTXt|iTXt|eXIf|iCCP|tIME|pHYs|sRGB|gAMA|cHRM)$/.test(type))
      parts.add('metadata', size, { name: type, bytes: size });
    else parts.add('structure', size);
    p += size;
    if (type === 'IEND') {
      end = p;
      break;
    }
  }
  const pixels = w * h;
  // A photo saved as PNG: many bytes per pixel, true colour.
  if (
    pixels > 500_000 &&
    (colorType === 2 || colorType === 6) &&
    parts.get('picture') / pixels > 1.2
  )
    tips.push({ key: 'photoAsPng', action: 'compress' });
  if (share(parts.get('metadata'), total) >= 0.2 && parts.get('metadata') > 64 * 1024)
    tips.push({ key: 'bigMetadata', action: 'compress' });
  let appendedAt: number | undefined;
  if (total - end > 1024) {
    appendedAt = end;
    parts.add('appended', total - end);
    tips.push({ key: 'appended', action: 'stripAppended' });
  }
  return report('png', total, parts, tips, appendedAt);
}

/* --------------------------------------------------------------- WAV, BMP */

async function wavReport(reader: ByteReader): Promise<SizeReport> {
  const total = reader.size;
  const parts = new Parts();
  const tips: SizeTip[] = [];
  let p = 12;
  let rate = 0;
  let channels = 0;
  let format = 0;
  let bits = 16;
  while (p + 8 <= total) {
    const h = await reader.read(p, 24);
    const id = ascii(h, 0, 4);
    const len = u32le(h, 4);
    const size = 8 + len + (len % 2);
    if (id === 'fmt ') {
      format = u16le(h, 8);
      channels = u16le(h, 10);
      rate = u32le(h, 12);
      bits = u16le(h, 22) || 16;
    }
    if (id === 'data') parts.add('audio', Math.min(size, total - p));
    else if (id === 'fmt ') parts.add('structure', size);
    else parts.add('metadata', Math.min(size, total - p), { name: id.trim(), bytes: size });
    p += size;
  }
  const audio = parts.get('audio');
  if ((format === 1 || format === 3 || format === 0xfffe) && audio > 2 * MB && rate > 0) {
    const seconds = audio / Math.max(1, (rate * channels * bits) / 8);
    tips.push({
      key: 'wavToSmaller',
      action: 'compress',
      values: {
        flac: Math.max(1, Math.round((audio * 0.55) / MB)),
        mp3: Math.max(1, Math.round((seconds * 192_000) / 8 / MB)),
      },
    });
  }
  return report('wav', total, parts, tips);
}

/* ----------------------------------------------------------------- generic */

async function genericReport(reader: ByteReader, kind: SizeFileKind): Promise<SizeReport> {
  const total = reader.size;
  const parts = new Parts();
  parts.add(kind === 'bmp' ? 'picture' : 'other', total);
  const tips: SizeTip[] = [];
  if (kind === 'bmp' && total > 300 * 1024)
    tips.push({ key: 'uncompressedImage', action: 'compress' });
  else if (total > 64 * 1024) {
    // A few samples spread over the file: how "packed" are the bytes?
    const counts = new Uint32Array(256);
    let sum = 0;
    let n = 0;
    for (let i = 0; i < 16; i++) {
      const at = Math.floor(((total - 65536) * i) / 15);
      const c = await reader.read(Math.max(0, at), 65536);
      counts.fill(0);
      for (const b of c) counts[b] = (counts[b] ?? 0) + 1;
      let h = 0;
      for (const v of counts) if (v) h -= (v / c.length) * Math.log2(v / c.length);
      sum += h;
      n++;
    }
    const avg = sum / Math.max(1, n);
    if (avg > 7.5) tips.push({ key: 'alreadyPacked' });
    else if (avg < 5) tips.push({ key: 'packable' });
  }
  return report(kind, total, parts, tips);
}

/** Takes the file apart. Never throws for odd files – they get the generic look. */
export async function sizeReport(reader: ByteReader): Promise<SizeReport> {
  const h = await reader.read(0, 16);
  try {
    if (h[0] === 0x50 && h[1] === 0x4b && h[2] === 3 && h[3] === 4) {
      const r = await zipReport(reader);
      if (r) return r;
    }
    if (ascii(h, 0, 5) === '%PDF-') return await pdfReport(reader);
    if (ascii(h, 4, 4) === 'ftyp') {
      const r = await mp4Report(reader);
      if (r) return r;
    }
    if (h[0] === 0xff && h[1] === 0xd8) return await jpegReport(reader);
    if (h[0] === 0x89 && ascii(h, 1, 3) === 'PNG') return await pngReport(reader);
    if (ascii(h, 0, 4) === 'RIFF' && ascii(h, 8, 4) === 'WAVE') return await wavReport(reader);
    if (ascii(h, 0, 2) === 'BM') return await genericReport(reader, 'bmp');
  } catch {
    // Broken inside: fall through to the generic look.
  }
  return genericReport(reader, 'other');
}
