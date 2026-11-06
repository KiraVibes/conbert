import type { Category } from '../engine';
import { getFormat, normalizeExt, refineDetectedExt } from '../formats';

/**
 * "Was ist diese Datei wirklich?" – the real type from the first bytes
 * (magic bytes) instead of the name. The detection itself (file-type) runs
 * outside; this module explains it and suggests the right name.
 */

export interface MagicSignature {
  /** What the bytes stand for ('zip' also for DOCX, EPUB …). */
  ext: string;
  offset: number;
  /** null = any byte (e.g. the size inside a RIFF header). */
  bytes: readonly (number | null)[];
}

const s = (ext: string, offset: number, text: string): MagicSignature => ({
  ext,
  offset,
  bytes: [...text].map((c) => (c === '?' ? null : c.charCodeAt(0))),
});
const h = (ext: string, offset: number, hex: string): MagicSignature => ({
  ext,
  offset,
  bytes: hex.split(' ').map((b) => (b === '??' ? null : Number.parseInt(b, 16))),
});

/** The best-known file signatures – only to show *which* bytes gave the type away. */
export const MAGIC_SIGNATURES: readonly MagicSignature[] = [
  h('png', 0, '89 50 4E 47 0D 0A 1A 0A'),
  h('jpg', 0, 'FF D8 FF'),
  s('gif', 0, 'GIF8'),
  s('webp', 0, 'RIFF????WEBP'),
  s('wav', 0, 'RIFF????WAVE'),
  s('avi', 0, 'RIFF????AVI '),
  h('tiff', 0, '49 49 2A 00'),
  h('tiff', 0, '4D 4D 00 2A'),
  h('ico', 0, '00 00 01 00'),
  s('psd', 0, '8BPS'),
  h('jxl', 0, '00 00 00 0C 4A 58 4C 20'),
  h('jxl', 0, 'FF 0A'),
  s('bmp', 0, 'BM'),
  s('pdf', 0, '%PDF-'),
  h('zip', 0, '50 4B 03 04'),
  h('zip', 0, '50 4B 05 06'),
  h('rar', 0, '52 61 72 21 1A 07'),
  h('7z', 0, '37 7A BC AF 27 1C'),
  h('xz', 0, 'FD 37 7A 58 5A 00'),
  h('zst', 0, '28 B5 2F FD'),
  h('gz', 0, '1F 8B'),
  s('bz2', 0, 'BZh'),
  s('tar', 257, 'ustar'),
  s('mp3', 0, 'ID3'),
  s('flac', 0, 'fLaC'),
  s('ogg', 0, 'OggS'),
  s('mid', 0, 'MThd'),
  s('mp4', 4, 'ftyp'),
  h('mkv', 0, '1A 45 DF A3'),
  s('woff', 0, 'wOFF'),
  s('woff2', 0, 'wOF2'),
  s('otf', 0, 'OTTO'),
  h('ttf', 0, '00 01 00 00 00'),
  h('cfb', 0, 'D0 CF 11 E0 A1 B1 1A E1'),
  s('rtf', 0, '{\\rtf'),
  s('sqlite', 0, 'SQLite format 3'),
  h('wasm', 0, '00 61 73 6D'),
  s('age', 0, 'age-encryption.org/v1'),
  s('age', 0, '-----BEGIN AGE ENCRYPTED FILE-----'),
  h('elf', 0, '7F 45 4C 46'),
  s('exe', 0, 'MZ'),
  // Last: two bytes say little on their own.
  h('mp3', 0, 'FF FB'),
  h('mp3', 0, 'FF F3'),
];

export interface SignatureMatch {
  ext: string;
  offset: number;
  length: number;
}

/** The signature at the start of the file (longest match wins). */
export function findSignature(head: Uint8Array): SignatureMatch | null {
  let best: SignatureMatch | null = null;
  for (const sig of MAGIC_SIGNATURES) {
    if (head.length < sig.offset + sig.bytes.length) continue;
    const hit = sig.bytes.every((b, i) => b === null || head[sig.offset + i] === b);
    if (hit && (!best || sig.bytes.length > best.length)) {
      best = { ext: sig.ext, offset: sig.offset, length: sig.bytes.length };
    }
  }
  return best;
}

/** Formats that are ZIP files inside. */
export const ZIP_BASED: ReadonlySet<string> = new Set([
  'zip',
  'docx',
  'xlsx',
  'pptx',
  'odt',
  'ods',
  'odp',
  'epub',
  '3mf',
  'usdz',
  'jar',
  'apk',
  'cbz',
  'xpi',
  'kmz',
]);

export const TEXT_ENCODINGS = [
  'utf-8',
  'utf-8-bom',
  'utf-16le',
  'utf-16be',
  'ascii',
  'latin1',
] as const;
export type TextEncoding = (typeof TEXT_ENCODINGS)[number];

/** Is a complete UTF-8 sequence at `i`? Returns its length, 0 if invalid, -1 if cut off. */
function utf8Length(b: Uint8Array, i: number): number {
  const first = b[i] ?? 0;
  const length = first >= 0xf0 && first <= 0xf4 ? 4 : first >= 0xe0 ? 3 : first >= 0xc2 ? 2 : 0;
  if (length === 0 || first > 0xf4) return 0;
  for (let k = 1; k < length; k++) {
    if (i + k >= b.length) return -1;
    if (((b[i + k] ?? 0) & 0xc0) !== 0x80) return 0;
  }
  return length;
}

/**
 * Text has no magic bytes – it is recognised by what is *missing*: no zero
 * bytes, hardly any control characters, valid characters of one encoding.
 */
export function sniffText(head: Uint8Array): TextEncoding | null {
  if (head.length === 0) return null;
  if (head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) return 'utf-8-bom';
  if (head[0] === 0xff && head[1] === 0xfe) return 'utf-16le';
  if (head[0] === 0xfe && head[1] === 0xff) return 'utf-16be';
  let control = 0;
  let high = 0;
  let utf8Valid = true;
  let c1 = 0;
  for (let i = 0; i < head.length; i++) {
    const b = head[i] ?? 0;
    if (b === 0) return null;
    if (b < 0x20 && b !== 9 && b !== 10 && b !== 13 && b !== 12 && b !== 27) control++;
    if (b < 0x80) continue;
    high++;
    if (b < 0xa0) c1++;
    if (utf8Valid) {
      const length = utf8Length(head, i);
      if (length === -1) break; // cut off at the end of the sample
      if (length === 0) utf8Valid = false;
      else i += length - 1;
    }
  }
  if (control > head.length / 100) return null;
  if (high === 0) return 'ascii';
  if (utf8Valid) return 'utf-8';
  // Latin-1 / Windows-1252 text: high bytes are letters, rarely 0x80–0x9F.
  return c1 <= high / 4 ? 'latin1' : null;
}

/** Categories whose formats are never plain text. */
const BINARY_CATEGORIES: readonly Category[] = [
  'image',
  'audio',
  'video',
  'archive',
  'font',
  'pdf',
];
/** Binary formats of mixed categories, and text-capable pictures to leave out. */
const BINARY_EXTS = new Set([
  'docx',
  'xlsx',
  'pptx',
  'odt',
  'ods',
  'odp',
  'doc',
  'xls',
  'ppt',
  'epub',
  'mobi',
  'azw3',
  'glb',
  '3mf',
  'usdz',
  'blend',
]);
const TEXT_PICTURES = new Set(['ppm', 'pgm', 'pbm', 'pnm', 'xpm', 'xbm']);

function isBinaryFormat(ext: string): boolean {
  if (TEXT_PICTURES.has(ext)) return false;
  if (BINARY_EXTS.has(ext)) return true;
  const category = getFormat(ext)?.category;
  return category !== undefined && BINARY_CATEGORIES.includes(category);
}

export type IdentifyVerdict =
  /** Name and content agree. */
  | 'match'
  /** The content is something else than the name says. */
  | 'mismatch'
  /** The name has no extension, the content is known. */
  | 'missing-ext'
  /** Plain text – the name decides what kind. */
  | 'text'
  /** The name promises a binary format, but the content is plain text. */
  | 'text-mismatch'
  /** No known signature and not text. */
  | 'unknown';

export interface FileIdentity {
  nameExt: string | null;
  /** The type from the content (null for text and unknown files). */
  realExt: string | null;
  verdict: IdentifyVerdict;
  /** The bytes that gave the type away. */
  signature: SignatureMatch | null;
  text: TextEncoding | null;
  /** The name with the right extension (only when it should change). */
  suggestedName: string | null;
}

export function extFromName(name: string): string | null {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return null;
  return normalizeExt(name.slice(dot + 1));
}

function withExt(name: string, ext: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? `${name.slice(0, dot)}.${ext}` : `${name}.${ext}`;
}

/**
 * Compares name and content. `detectedExt` comes from the magic-bytes
 * detection (file-type), `head` are the first bytes (a few KB are enough).
 */
export function identifyFile(input: {
  name: string;
  detectedExt: string | null;
  head: Uint8Array;
}): FileIdentity {
  const nameExt = extFromName(input.name);
  const signature = findSignature(input.head);
  // Formats the detection library doesn't know (age) are recognised by their signature.
  const detected = input.detectedExt
    ? normalizeExt(input.detectedExt)
    : signature?.ext === 'age'
      ? 'age'
      : null;
  // "Brief.docx" whose content only says ZIP: a DOCX *is* a ZIP inside.
  const realExt = !detected
    ? null
    : detected === 'zip' && nameExt !== null && ZIP_BASED.has(nameExt)
      ? nameExt
      : refineDetectedExt(detected, nameExt);
  if (realExt) {
    const verdict: IdentifyVerdict =
      nameExt === null ? 'missing-ext' : nameExt === realExt ? 'match' : 'mismatch';
    return {
      nameExt,
      realExt,
      verdict,
      signature,
      text: null,
      suggestedName: verdict === 'match' ? null : withExt(input.name, realExt),
    };
  }
  const text = sniffText(input.head);
  if (text) {
    const wrong = nameExt !== null && isBinaryFormat(nameExt);
    return {
      nameExt,
      realExt: null,
      verdict: wrong ? 'text-mismatch' : 'text',
      signature: null,
      text,
      suggestedName: wrong ? withExt(input.name, 'txt') : null,
    };
  }
  return { nameExt, realExt: null, verdict: 'unknown', signature, text: null, suggestedName: null };
}
