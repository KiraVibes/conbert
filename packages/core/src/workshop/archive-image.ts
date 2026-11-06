import { crc32 } from './crc';
import { zipHasExecutable } from './executable';
import { findSignature } from './identify';
import { bytesReader, u16le } from './reader';
import { findZipEnd, parseStructure, readZipEntries } from './structure';
import { MAX_EXTRACT_BYTES, WorkshopError, relocateZip } from './zip-tools';

/**
 * "Archiv im Bild" and polyglot files: one file that is a picture (or PDF)
 * and an archive at the same time. Only archives go in, never programs.
 */

/** Pictures an archive can hang behind. */
export const ARCHIVE_COVERS = ['jpg', 'png', 'gif'] as const;
/** Archives that can hang behind a picture (ZIP works best). */
export const HIDDEN_ARCHIVES = ['zip', 'rar', '7z'] as const;
/** Formats that take a ZIP *inside* them, not just behind them. */
export const POLYGLOT_HOSTS = ['png', 'pdf'] as const;
export type PolyglotHost = (typeof POLYGLOT_HOSTS)[number];

/** The PNG block that carries the ZIP (lowercase = optional, private, safe to copy). */
export const PNG_ZIP_CHUNK = 'ziPp';

const latin1 = new TextDecoder('latin1');
const ascii = new TextEncoder();

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const realExt = (bytes: Uint8Array) => findSignature(bytes.subarray(0, 64))?.ext ?? null;

function checkSize(...parts: Uint8Array[]): void {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  if (total > MAX_EXTRACT_BYTES) throw new WorkshopError('too-big', String(total));
}

/** The file's own bytes – without anything that already hangs behind its end. */
async function ownBytes(bytes: Uint8Array, ext: string): Promise<Uint8Array> {
  const structure = await parseStructure(bytesReader(bytes), ext);
  if (!structure) throw new WorkshopError('not-cover');
  return structure.appendedAt != null ? bytes.subarray(0, structure.appendedAt) : bytes;
}

/**
 * Checks a ZIP (nothing that runs) and returns it on its own, positions
 * counted from its start, with the place of its end record.
 */
async function checkedZip(zip: Uint8Array): Promise<{ zip: Uint8Array; eocd: number }> {
  if (realExt(zip) !== 'zip') throw new WorkshopError('not-archive');
  const reader = bytesReader(zip);
  const end = await findZipEnd(reader);
  if (!end) throw new WorkshopError('not-archive');
  const entries = await readZipEntries(reader, end);
  const bad = zipHasExecutable(entries.map((e) => e.name));
  if (bad) throw new WorkshopError('executable', bad);
  const own = end.shift === 0 ? zip : await relocateZip(zip, end.shift);
  return { zip: own, eocd: end.eocd };
}

/** Makes the ZIP's comment cover `extra` more bytes that will follow its end record. */
function extendComment(zip: Uint8Array, eocd: number, extra: number): void {
  const length = u16le(zip, eocd + 20) + extra;
  if (length > 0xffff) throw new WorkshopError('too-big', 'zip comment');
  zip[eocd + 20] = length & 0xff;
  zip[eocd + 21] = length >> 8;
}

/**
 * Puts an archive behind a picture (`copy /b bild.jpg + archiv.zip`). A ZIP
 * gets its positions moved along (like `zip -A`), so every ZIP program –
 * the Windows Explorer too – finds its files. RAR and 7Z are appended as
 * they are; `names` are their entries (listed by the caller), because they
 * are checked for programs as well.
 */
export async function hideArchiveInPicture(
  cover: Uint8Array,
  archive: Uint8Array,
  names?: readonly string[],
): Promise<Uint8Array> {
  const coverExt = realExt(cover);
  if (!coverExt || !(ARCHIVE_COVERS as readonly string[]).includes(coverExt)) {
    throw new WorkshopError('not-cover');
  }
  const own = await ownBytes(cover, coverExt);
  checkSize(own, archive);
  const kind = realExt(archive);
  if (kind === 'zip') {
    const { zip } = await checkedZip(archive);
    return concat(own, await relocateZip(zip, own.length));
  }
  if (kind === 'rar' || kind === '7z') {
    if (!names) throw new WorkshopError('unchecked');
    const bad = zipHasExecutable(names);
    if (bad) throw new WorkshopError('executable', bad);
    return concat(own, archive);
  }
  throw new WorkshopError('not-archive');
}

/**
 * PNG + ZIP: the ZIP sits in a block of its own in front of the closing
 * IEND block. Picture viewers skip blocks they don't know; ZIP programs read
 * from the end, where the ZIP's comment swallows the last 16 bytes (block
 * checksum and IEND). Nothing hangs behind the picture's end – a fully
 * valid PNG.
 */
async function pngPolyglot(png: Uint8Array, zipBytes: Uint8Array): Promise<Uint8Array> {
  const own = await ownBytes(png, 'png');
  const iend = own.length - 12;
  if (iend < 8 || latin1.decode(own.subarray(iend + 4, iend + 8)) !== 'IEND') {
    throw new WorkshopError('broken', 'no IEND');
  }
  const { zip, eocd } = await checkedZip(zipBytes);
  const dataStart = iend + 8;
  const data = await relocateZip(zip, dataStart);
  extendComment(data, eocd, 4 + 12);
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(ascii.encode(PNG_ZIP_CHUNK), 4);
  chunk.set(data, 8);
  view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
  return concat(own.subarray(0, iend), chunk, own.subarray(iend));
}

interface PdfTrailer {
  /** Where the last cross-reference section starts. */
  prev: number;
  /** A cross-reference stream (PDF 1.5+) instead of the classic table. */
  stream: boolean;
  size: number;
  /** The entries a new trailer must repeat (`/Root 1 0 R` …). */
  keep: string;
}

function readTrailer(pdf: Uint8Array): PdfTrailer {
  const tail = latin1.decode(pdf.subarray(Math.max(0, pdf.length - 4096)));
  const match = /startxref\s+(\d+)\s*%%EOF\s*$/.exec(tail) ?? /startxref\s+(\d+)/.exec(tail);
  if (!match?.[1]) throw new WorkshopError('broken', 'no startxref');
  const prev = Number(match[1]);
  if (prev <= 0 || prev >= pdf.length) throw new WorkshopError('broken', 'startxref');
  const section = latin1.decode(pdf.subarray(prev, Math.min(pdf.length, prev + 1024 * 1024)));
  let dict: string;
  let stream: boolean;
  if (section.startsWith('xref')) {
    const t = section.indexOf('trailer');
    const end = section.indexOf('startxref', t);
    if (t < 0) throw new WorkshopError('broken', 'no trailer');
    dict = section.slice(t, end < 0 ? undefined : end);
    stream = false;
  } else if (/^\d+\s+\d+\s+obj/.test(section)) {
    const end = section.indexOf('stream');
    dict = section.slice(0, end < 0 ? undefined : end);
    if (!/\/Type\s*\/XRef/.test(dict)) throw new WorkshopError('broken', 'no xref stream');
    stream = true;
  } else {
    throw new WorkshopError('broken', 'xref');
  }
  if (/\/Encrypt\b/.test(dict)) throw new WorkshopError('locked-pdf');
  const size = /\/Size\s+(\d+)/.exec(dict)?.[1];
  const root = /\/Root\s+(\d+\s+\d+\s+R)/.exec(dict)?.[1];
  if (!size || !root) throw new WorkshopError('broken', 'trailer');
  const info = /\/Info\s+(\d+\s+\d+\s+R)/.exec(dict)?.[1];
  const id = /\/ID\s*(\[\s*<[0-9A-Fa-f\s]*>\s*<[0-9A-Fa-f\s]*>\s*\])/.exec(dict)?.[1];
  const keep = `/Root ${root}${info ? ` /Info ${info}` : ''}${id ? ` /ID ${id}` : ''}`;
  return { prev, stream, size: Number(size), keep };
}

/**
 * PDF + ZIP: the ZIP becomes an extra object in an update at the end of the
 * PDF (the same way programs save changes to a PDF). PDF readers start at
 * the last `startxref` and never look at the object; ZIP programs find the
 * ZIP's end record, whose comment swallows the few bytes of the PDF's
 * closing table. The original PDF stays untouched in front.
 */
async function pdfPolyglot(pdf: Uint8Array, zipBytes: Uint8Array): Promise<Uint8Array> {
  if (realExt(pdf) !== 'pdf') throw new WorkshopError('not-cover');
  const trailer = readTrailer(pdf);
  const { zip, eocd } = await checkedZip(zipBytes);
  const last = pdf[pdf.length - 1];
  const gap = last === 0x0a || last === 0x0d ? '' : '\n';
  const n = trailer.size;
  const objectAt = pdf.length + gap.length;
  const head = `${gap}${n} 0 obj\n<< /Length ${zip.length} >>\nstream\n`;
  const dataStart = pdf.length + head.length;
  const data = await relocateZip(zip, dataStart);
  const close = '\nendstream\nendobj\n';
  const xrefAt = dataStart + data.length + close.length;
  let section: Uint8Array;
  if (trailer.stream) {
    // An uncompressed cross-reference stream for the ZIP object and itself.
    const rows = new Uint8Array(14);
    const view = new DataView(rows.buffer);
    rows[0] = 1;
    view.setUint32(1, objectAt);
    rows[7] = 1;
    view.setUint32(8, xrefAt);
    const dict =
      `${n + 1} 0 obj\n<< /Type /XRef /Size ${n + 2} /Index [${n} 2] /W [1 4 2]` +
      ` /Prev ${trailer.prev} ${trailer.keep} /Length ${rows.length} >>\nstream\n`;
    section = concat(
      ascii.encode(dict),
      rows,
      ascii.encode(`\nendstream\nendobj\nstartxref\n${xrefAt}\n%%EOF\n`),
    );
  } else {
    const entry = `${String(objectAt).padStart(10, '0')} 00000 n \n`;
    section = ascii.encode(
      `xref\n${n} 1\n${entry}trailer\n<< /Size ${n + 1} /Prev ${trailer.prev} ${trailer.keep} >>\n` +
        `startxref\n${xrefAt}\n%%EOF\n`,
    );
  }
  const tail = concat(ascii.encode(close), section);
  extendComment(data, eocd, tail.length);
  return concat(pdf, ascii.encode(head), data, tail);
}

/** A file that is a PNG or PDF and a ZIP at once – the ZIP lives inside, not behind. */
export async function makePolyglot(host: Uint8Array, zip: Uint8Array): Promise<Uint8Array> {
  checkSize(host, zip);
  const ext = realExt(host);
  if (ext === 'png') return pngPolyglot(host, zip);
  if (ext === 'pdf') return pdfPolyglot(host, zip);
  throw new WorkshopError('not-cover');
}
