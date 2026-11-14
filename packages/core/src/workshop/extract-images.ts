import { inflateSync, unzlibSync, zlibSync } from 'fflate';
import { crc32 } from './crc';
import { encodePng } from './raster';
import { readAll, type ByteReader } from './reader';
import { findZipEnd, readZipEntries } from './structure';
import { WorkshopError, extractZipEntry } from './zip-tools';

/**
 * Get all pictures out of documents. Office files (DOCX, PPTX, XLSX, ODT …),
 * EPUB/CBZ and Apple Pages/Keynote/Numbers are ZIP archives with the pictures
 * as files inside. A PDF keeps every picture as a "stream object" – JPEGs as
 * they are, other pictures as compressed raw pixels that become PNGs here.
 */

export interface ExtractedImage {
  /** File name for saving ("image1.png", "bild-003.jpg"). */
  name: string;
  /** Where it came from inside the file ("word/media/image1.png", "PDF-Objekt 12"). */
  source: string;
  ext: string;
  bytes: Uint8Array;
  /** A preview picture the program saved (Apple/LibreOffice thumbnail), not part of the content. */
  preview: boolean;
}

export interface ExtractImagesResult {
  container: 'zip' | 'pdf';
  images: ExtractedImage[];
  /** Pictures that were found but are stored in a format Conbert can't save (CCITT, JBIG2, indexed …). */
  skipped: number;
}

const IMAGE_EXTS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'bmp',
  'tif',
  'tiff',
  'webp',
  'svg',
  'emf',
  'wmf',
  'heic',
  'avif',
  'jp2',
  'ico',
]);

/** Thumbnails apps put into their files – handy, but not part of the content. */
function isPreviewEntry(name: string): boolean {
  return /^(QuickLook\/|Thumbnails\/|preview(-micro|-web)?\.(jpg|png)$|docProps\/thumbnail)/i.test(
    name,
  );
}

function extOfName(name: string): string {
  return /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? '';
}

function baseOfName(name: string): string {
  return name.split('/').pop() ?? name;
}

/** Makes names unique: a second "image1.png" becomes "image1-2.png". */
function uniqueName(name: string, used: Set<string>): string {
  if (!used.has(name.toLowerCase())) {
    used.add(name.toLowerCase());
    return name;
  }
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let n = 2; ; n++) {
    const candidate = `${stem}-${n}${ext}`;
    if (!used.has(candidate.toLowerCase())) {
      used.add(candidate.toLowerCase());
      return candidate;
    }
  }
}

async function fromZip(reader: ByteReader): Promise<ExtractImagesResult | null> {
  const end = await findZipEnd(reader);
  if (!end) return null;
  const entries = await readZipEntries(reader, end);
  const used = new Set<string>();
  const images: ExtractedImage[] = [];
  let skipped = 0;
  for (const entry of entries) {
    if (entry.directory) continue;
    const ext = extOfName(entry.name);
    if (!IMAGE_EXTS.has(ext)) continue;
    try {
      const bytes = await extractZipEntry(reader, entry);
      if (bytes.length === 0) continue;
      images.push({
        name: uniqueName(baseOfName(entry.name), used),
        source: entry.name,
        ext: ext === 'jpeg' ? 'jpg' : ext,
        bytes,
        preview: isPreviewEntry(entry.name),
      });
    } catch {
      skipped++;
    }
  }
  // Content first, the app's own preview pictures last.
  images.sort((a, b) => Number(a.preview) - Number(b.preview));
  return { container: 'zip', images, skipped };
}

// --- PDF -----------------------------------------------------------------------

/** One stream object found in the PDF: its dictionary as text and where the data lies. */
interface PdfStream {
  id: number;
  dict: string;
  dataStart: number;
  dataEnd: number;
}

/** PDF Flate data is zlib-wrapped; a few writers leave the wrapper out. */
function inflatePdf(data: Uint8Array): Uint8Array {
  try {
    return unzlibSync(data);
  } catch {
    return inflateSync(data);
  }
}

function latin1(bytes: Uint8Array): string {
  let out = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    out += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return out;
}

/** All "n 0 obj << … >> stream … endstream" objects whose dictionary says /Subtype /Image. */
function findImageStreams(text: string): PdfStream[] {
  const out: PdfStream[] = [];
  const objRe = /(\d+)\s+\d+\s+obj\b/g;
  let m: RegExpExecArray | null;
  while ((m = objRe.exec(text))) {
    const dictStart = text.indexOf('<<', m.index);
    const streamAt = text.indexOf('stream', m.index);
    const endObj = text.indexOf('endobj', m.index);
    if (dictStart < 0 || streamAt < 0 || (endObj >= 0 && streamAt > endObj)) continue;
    const dict = text.slice(dictStart, streamAt);
    if (!/\/Subtype\s*\/Image\b/.test(dict)) continue;
    let dataStart = streamAt + 6;
    if (text[dataStart] === '\r') dataStart++;
    if (text[dataStart] === '\n') dataStart++;
    const endStream = text.indexOf('endstream', dataStart);
    if (endStream < 0) continue;
    let dataEnd = endStream;
    // The line break before "endstream" isn't part of the data.
    if (text[dataEnd - 1] === '\n') dataEnd--;
    if (text[dataEnd - 1] === '\r') dataEnd--;
    // A /Length that is a plain number is more exact than the search.
    const length = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict);
    if (length) {
      const n = Number(length[1]);
      if (dataStart + n <= endStream) dataEnd = dataStart + n;
    }
    out.push({ id: Number(m[1]), dict, dataStart, dataEnd });
    objRe.lastIndex = endStream;
  }
  return out;
}

function numberIn(dict: string, key: string): number | null {
  const m = new RegExp(`/${key}\\s+(\\d+)(?!\\s+\\d+\\s+R)`).exec(dict);
  return m ? Number(m[1]) : null;
}

function filtersOf(dict: string): string[] {
  const m = /\/Filter\s*(\[[^\]]*\]|\/\w+)/.exec(dict);
  if (!m?.[1]) return [];
  return [...m[1].matchAll(/\/(\w+)/g)].map((f) => f[1] ?? '');
}

/**
 * How many colour channels: from the colour space name; 'guess' for ICC
 * profiles and references; null for palettes and special colour spaces.
 */
function channelsOf(dict: string): 1 | 3 | 4 | 'guess' | null {
  const cs = /\/ColorSpace\s*(\/\w+|\[[^\]]*\]|\d+\s+\d+\s+R)/.exec(dict)?.[1] ?? '';
  if (/DeviceGray|CalGray/.test(cs)) return 1;
  if (/DeviceRGB|CalRGB/.test(cs)) return 3;
  if (/DeviceCMYK/.test(cs)) return 4;
  if (/Indexed|Separation|DeviceN|Pattern/.test(cs)) return null;
  return 'guess';
}

function cmykToRgb(data: Uint8Array, pixels: number): Uint8Array {
  const out = new Uint8Array(pixels * 3);
  for (let i = 0; i < pixels; i++) {
    const c = (data[i * 4] ?? 0) / 255;
    const m = (data[i * 4 + 1] ?? 0) / 255;
    const y = (data[i * 4 + 2] ?? 0) / 255;
    const k = (data[i * 4 + 3] ?? 0) / 255;
    out[i * 3] = Math.round(255 * (1 - c) * (1 - k));
    out[i * 3 + 1] = Math.round(255 * (1 - m) * (1 - k));
    out[i * 3 + 2] = Math.round(255 * (1 - y) * (1 - k));
  }
  return out;
}

/** 8-bit greyscale PNG (the raster helper only writes RGB/RGBA). */
function encodeGrayPng(width: number, height: number, data: Uint8Array): Uint8Array {
  const rows = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y++)
    rows.set(data.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
  const chunk = (type: string, body: Uint8Array) => {
    const out = new Uint8Array(12 + body.length);
    const v = new DataView(out.buffer);
    v.setUint32(0, body.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(body, 8);
    v.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 0;
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlibSync(rows, { level: 6 })),
    chunk('IEND', new Uint8Array()),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const png = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    png.set(p, at);
    at += p.length;
  }
  return png;
}

/** Undoes the PNG row predictors (/Predictor ≥ 10) that PDFs may use for Flate data. */
function unpredict(data: Uint8Array, width: number, height: number, channels: number) {
  const stride = width * channels;
  const out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = data[y * (stride + 1)] ?? 0;
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const raw = data[src + x] ?? 0;
      const left = x >= channels ? (out[dst + x - channels] ?? 0) : 0;
      const up = y > 0 ? (out[dst - stride + x] ?? 0) : 0;
      const upLeft = y > 0 && x >= channels ? (out[dst - stride + x - channels] ?? 0) : 0;
      let value = raw;
      if (filter === 1) value = raw + left;
      else if (filter === 2) value = raw + up;
      else if (filter === 3) value = raw + ((left + up) >> 1);
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        value = raw + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
      }
      out[dst + x] = value & 0xff;
    }
  }
  return out;
}

/** A Flate-compressed raw picture as PNG, or null if its layout is not supported. */
function rawToPng(dict: string, compressed: Uint8Array): Uint8Array | null {
  const width = numberIn(dict, 'Width');
  const height = numberIn(dict, 'Height');
  const bits = numberIn(dict, 'BitsPerComponent') ?? 8;
  if (!width || !height || bits !== 8 || width * height > 50_000_000) return null;
  let data: Uint8Array;
  try {
    data = inflatePdf(compressed);
  } catch {
    return null;
  }
  const predictor = numberIn(dict, 'Predictor') ?? 1;
  const space = channelsOf(dict);
  if (space === null) return null;
  let channels: number = space === 'guess' ? 0 : space;
  if (space === 'guess') {
    // Unknown colour space (ICC profile): guess from the size of the data.
    const per = Math.round(data.length / (width * height));
    const perRow = predictor >= 10 ? (data.length / height - 1) / width : per;
    const guess = Math.round(perRow);
    if (guess !== 1 && guess !== 3 && guess !== 4) return null;
    channels = guess;
  }
  if (predictor >= 10) {
    if (data.length < (width * channels + 1) * height) return null;
    data = unpredict(data, width, height, channels);
  }
  if (data.length < width * height * channels) return null;
  if (channels === 1) return encodeGrayPng(width, height, data);
  const rgb = channels === 4 ? cmykToRgb(data, width * height) : data;
  return encodePng({ width, height, channels: 3, data: rgb.subarray(0, width * height * 3) });
}

async function fromPdf(reader: ByteReader, prefix: string): Promise<ExtractImagesResult> {
  const bytes = await readAll(reader);
  const text = latin1(bytes);
  // Encrypted PDFs keep their pictures encrypted, too.
  if (/\/Encrypt\s+\d+\s+\d+\s+R/.test(text)) throw new WorkshopError('locked-pdf');
  const streams = findImageStreams(text);
  // Soft masks (transparency) are pictures too, but only make sense with their partner.
  const masks = new Set([...text.matchAll(/\/SMask\s+(\d+)\s+\d+\s+R/g)].map((m) => Number(m[1])));
  const images: ExtractedImage[] = [];
  let skipped = 0;
  let n = 0;
  for (const s of streams) {
    if (masks.has(s.id) || /\/ImageMask\s+true/.test(s.dict)) continue;
    const data = bytes.subarray(s.dataStart, s.dataEnd);
    const filters = filtersOf(s.dict);
    const last = filters.at(-1);
    let out: { bytes: Uint8Array; ext: string } | null = null;
    if (filters.length === 1 && last === 'DCTDecode') out = { bytes: data.slice(), ext: 'jpg' };
    else if (filters.length === 1 && last === 'JPXDecode')
      out = { bytes: data.slice(), ext: 'jp2' };
    else if (filters.length === 1 && last === 'FlateDecode') {
      const png = rawToPng(s.dict, data);
      if (png) out = { bytes: png, ext: 'png' };
    } else if (filters.length === 2 && filters[0] === 'FlateDecode' && last === 'DCTDecode') {
      try {
        out = { bytes: inflatePdf(data), ext: 'jpg' };
      } catch {
        out = null;
      }
    }
    if (!out) {
      skipped++;
      continue;
    }
    n++;
    images.push({
      name: `${prefix}-${String(n).padStart(3, '0')}.${out.ext}`,
      source: `PDF ${s.id}`,
      ext: out.ext,
      bytes: out.bytes,
      preview: false,
    });
  }
  return { container: 'pdf', images, skipped };
}

/**
 * Pictures inside a document (ZIP-based office/e-book files or PDF); null if
 * it is neither. PDF pictures have no names – they become `<prefix>-001.jpg` …
 */
export async function extractImages(
  reader: ByteReader,
  prefix = 'image',
): Promise<ExtractImagesResult | null> {
  const head = await reader.read(0, 1024);
  const headText = String.fromCharCode(...head);
  if (headText.includes('%PDF-')) return fromPdf(reader, prefix);
  return fromZip(reader);
}

export const EXTRACT_IMAGES_ACCEPT = [
  'docx',
  'pptx',
  'xlsx',
  'odt',
  'odp',
  'ods',
  'epub',
  'cbz',
  'pages',
  'key',
  'numbers',
  'pdf',
  'zip',
];
