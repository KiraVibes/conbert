import { unzlibSync } from 'fflate';
import { MAGIC_SIGNATURES, findSignature, sniffText, type MagicSignature } from './identify';
import { ascii, sliceReader, u16le, u32be, type ByteReader } from './reader';
import { audioSecrets, pictureSecrets, sealedSecrets, textSecrets } from './scan-secrets';
import {
  findZipEnd,
  parseStructure,
  readZipEntries,
  regionAt,
  type FileRegion,
  type FileStructure,
  type ZipEntry,
} from './structure';

/**
 * The detective scan: looks through a whole file for things that don't
 * belong there – data behind the end, other files inside it (a signature
 * search like binwalk), text notes and invisible characters.
 */

export type FindingKind =
  | 'appended'
  | 'prefix'
  | 'embedded'
  | 'thumbnail'
  | 'part'
  | 'text-note'
  | 'zero-width'
  | 'stego'
  | 'lsb'
  | 'sealed';

export interface Finding {
  kind: FindingKind;
  /** Something out of place (true) – or a normal, but interesting part (false). */
  hidden: boolean;
  offset: number;
  length: number;
  /** What the bytes are ('zip', 'jpg' …), if known. */
  format: string | null;
  /** Below `workshop.detective.findings.`. */
  key: string;
  values?: Record<string, string | number>;
  /** For text notes: the text itself. */
  text?: string;
  /** For archives: their entries, positions counted from `offset`. */
  entries?: ZipEntry[];
  /** Workshop trick that can open what was found. */
  trick?: string;
}

export interface DetectiveReport {
  findings: Finding[];
  /** Stopped after too many findings. */
  truncated: boolean;
}

export const FINDING_KEYS = [
  'appended',
  'appendedKnown',
  'appendedPadding',
  'motionPhoto',
  'prefix',
  'prefixKnown',
  'embedded',
  'thumbnail',
  'pdfObject',
  'textNote',
  'zeroWidth',
  'zeroWidthMessage',
  'zeroWidthMessageLocked',
  'stegoPicture',
  'stegoPictureLocked',
  'stegoAudio',
  'stegoAudioLocked',
  'lsbSuspicious',
  'sealedMeta',
] as const;

const MAX_FINDINGS = 200;
const MAX_HITS = 5000;
const WINDOW = 1024 * 1024;
const HEAD_BYTES = 32;
const MAX_TEXT_NOTE = 4000;
const MAX_ZERO_WIDTH_SCAN = 8 * 1024 * 1024;

/** Signatures strong enough to look for in the middle of a file. */
const SCAN_FORMATS = new Set([
  'png',
  'jpg',
  'gif',
  'webp',
  'wav',
  'avi',
  'tiff',
  'psd',
  'jxl',
  'pdf',
  'zip',
  'rar',
  '7z',
  'xz',
  'zst',
  'gz',
  'bz2',
  'tar',
  'mp3',
  'flac',
  'ogg',
  'mid',
  'mp4',
  'mkv',
  'woff',
  'woff2',
  'otf',
  'cfb',
  'rtf',
  'sqlite',
  'wasm',
  'elf',
]);

const SCAN_SIGNATURES: readonly MagicSignature[] = [
  ...MAGIC_SIGNATURES.filter(
    (s) =>
      SCAN_FORMATS.has(s.ext) &&
      // Two or three bytes match far too often by chance.
      (s.bytes.length >= 4 || s.ext === 'jpg' || s.ext === 'bz2' || s.ext === 'mp3') &&
      !(s.ext === 'zip' && s.bytes[2] === 0x05) &&
      !(s.ext === 'mp3' && s.bytes[0] === 0xff),
  ),
  { ext: 'gz', offset: 0, bytes: [0x1f, 0x8b, 0x08] },
];

/** Cheap extra checks on the bytes behind a hit, against chance matches. */
function plausible(ext: string, b: Uint8Array): boolean {
  switch (ext) {
    case 'jpg': {
      const m = b[3] ?? 0;
      return (m >= 0xe0 && m <= 0xef) || m === 0xdb || m === 0xfe || m === 0xc0 || m === 0xc4;
    }
    case 'gif':
      return (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61;
    case 'bz2':
      return (b[3] ?? 0) >= 0x31 && (b[3] ?? 0) <= 0x39;
    case 'mp3':
      return (b[3] ?? 0) >= 2 && (b[3] ?? 0) <= 4 && (b[5] ?? 0xff) < 0x10;
    case 'gz':
      return (b[3] ?? 0xff) < 0x20;
    case 'ogg':
      return b[4] === 0;
    case 'mid':
      return u32be(b, 4) === 6;
    case 'mp4': {
      const size = u32be(b, 0);
      return size >= 8 && size <= 4096 && /^[\x20-\x7e]{4}$/.test(ascii(b, 8, 4));
    }
    case 'zip':
      return u16le(b, 4) <= 63 && u16le(b, 26) > 0 && u16le(b, 26) < 1024;
    default:
      return true;
  }
}

/** Formats `parseStructure` knows – there the end of an embedded file can be found. */
const PARSED = new Set(['png', 'jpg', 'gif', 'webp', 'wav', 'avi', 'pdf', 'zip']);

interface Hit {
  offset: number;
  ext: string;
}

async function signatureHits(
  reader: ByteReader,
  onProgress?: (done: number) => void,
): Promise<Hit[]> {
  const byFirst: MagicSignature[][] = Array.from({ length: 256 }, () => []);
  for (const sig of SCAN_SIGNATURES) {
    const first = sig.bytes[0];
    if (first !== null && first !== undefined) byFirst[first]?.push(sig);
  }
  const hits: Hit[] = [];
  const seen = new Set<number>();
  for (let start = 0; start < reader.size && hits.length < MAX_HITS; start += WINDOW) {
    const buf = await reader.read(start, WINDOW + 300);
    const end = Math.min(WINDOW, buf.length);
    for (let i = 0; i < end; i++) {
      const candidates = byFirst[buf[i] ?? 0];
      if (!candidates || candidates.length === 0) continue;
      for (const sig of candidates) {
        let ok = true;
        for (let k = 1; k < sig.bytes.length; k++) {
          const want = sig.bytes[k];
          if (want !== null && buf[i + k] !== want) {
            ok = false;
            break;
          }
        }
        const offset = start + i - sig.offset;
        if (!ok || offset < 0 || seen.has(offset)) continue;
        // 32 bytes: the ZIP check looks at the name length at byte 26.
        const head =
          offset >= start
            ? buf.subarray(offset - start, offset - start + HEAD_BYTES)
            : await reader.read(offset, HEAD_BYTES);
        if (!plausible(sig.ext, head)) continue;
        seen.add(offset);
        hits.push({ offset, ext: sig.ext });
      }
    }
    onProgress?.(Math.min(reader.size, start + WINDOW));
  }
  return hits.sort((a, b) => a.offset - b.offset);
}

/** How long the file at this spot is – or null when it doesn't hold up. */
async function measure(
  reader: ByteReader,
  hit: Hit,
): Promise<{ length: number; structure: FileStructure | null } | null> {
  const sub = sliceReader(reader, hit.offset);
  if (!PARSED.has(hit.ext)) return { length: sub.size, structure: null };
  const structure = await parseStructure(sub, hit.ext);
  if (!structure) return hit.ext === 'zip' ? { length: sub.size, structure: null } : null;
  // Too short or broken off: a chance match, not a real file.
  if (structure.regions.length < 2 || structure.truncated) return null;
  return { length: structure.appendedAt ?? sub.size, structure };
}

async function zipEntriesAt(reader: ByteReader, offset: number, length: number) {
  const sub = sliceReader(reader, offset, length);
  const end = await findZipEnd(sub);
  return end ? readZipEntries(sub, end) : undefined;
}

const latin1 = new TextDecoder('latin1');
const utf8 = new TextDecoder();

/** The text of a PNG text chunk, a JPEG comment or a GIF comment. */
async function textNote(
  reader: ByteReader,
  region: FileRegion,
): Promise<{ text: string; keyword?: string } | null> {
  const clip = (s: string) => s.slice(0, MAX_TEXT_NOTE);
  if (region.key.startsWith('png.chunks.')) {
    const length = Number(region.values?.['bytes'] ?? 0);
    const data = await reader.read(region.end, Math.min(length, 256 * 1024));
    const zero = data.indexOf(0);
    if (zero < 0) return null;
    const keyword = latin1.decode(data.subarray(0, zero));
    try {
      if (region.label === 'tEXt')
        return { keyword, text: clip(latin1.decode(data.subarray(zero + 1))) };
      if (region.label === 'zTXt') {
        return { keyword, text: clip(latin1.decode(unzlibSync(data.subarray(zero + 2)))) };
      }
      // iTXt: keyword, compression flag + method, language, translated keyword, text.
      const compressed = data[zero + 1] === 1;
      const lang = data.indexOf(0, zero + 3);
      const translated = lang < 0 ? -1 : data.indexOf(0, lang + 1);
      if (translated < 0) return null;
      const body = data.subarray(translated + 1);
      return { keyword, text: clip(utf8.decode(compressed ? unzlibSync(body) : body)) };
    } catch {
      return null;
    }
  }
  if (region.key === 'jpg.markers.com') {
    const length = Number(region.values?.['bytes'] ?? 0);
    return {
      text: clip(utf8.decode(await reader.read(region.end, Math.min(length, MAX_TEXT_NOTE)))),
    };
  }
  if (region.key === 'gif.comment') {
    const block = await reader.read(
      region.start + 2,
      Math.min(region.end - region.start - 2, 64 * 1024),
    );
    const parts: Uint8Array[] = [];
    for (let p = 0; p < block.length && block[p]; p += 1 + (block[p] ?? 0)) {
      parts.push(block.subarray(p + 1, p + 1 + (block[p] ?? 0)));
    }
    return { text: clip(latin1.decode(Uint8Array.from(parts.flatMap((x) => [...x])))) };
  }
  return null;
}

const TEXT_NOTE_KEYS = new Set([
  'png.chunks.tEXt',
  'png.chunks.zTXt',
  'png.chunks.iTXt',
  'jpg.markers.com',
  'gif.comment',
]);

/** Zero-width characters: invisible in any editor, but they can carry a message. */
const ZERO_WIDTH_CODES = [
  0x200b, 0x200c, 0x200d, 0x2060, 0x2061, 0x2062, 0x2063, 0x2064, 0x180e, 0xfeff,
];
// An alternation, not a character class: joiners in a class confuse the regex linter.
const ZERO_WIDTH = new RegExp(ZERO_WIDTH_CODES.map((c) => String.fromCharCode(c)).join('|'), 'g');

async function zeroWidth(reader: ByteReader): Promise<Finding | null> {
  const bytes = await reader.read(0, Math.min(reader.size, MAX_ZERO_WIDTH_SCAN));
  const text = utf8.decode(bytes);
  let count = 0;
  let first = -1;
  for (const match of text.matchAll(ZERO_WIDTH)) {
    // A byte order mark at the very start is normal.
    if (match.index === 0 && match[0] === String.fromCharCode(0xfeff)) continue;
    count++;
    if (first < 0) first = match.index;
  }
  if (count === 0) return null;
  const offset = new TextEncoder().encode(text.slice(0, first)).length;
  return {
    kind: 'zero-width',
    hidden: true,
    offset,
    length: 3,
    format: null,
    key: 'zeroWidth',
    values: { count },
  };
}

/**
 * Searches the file. `ext` is its real type (from the magic bytes), so the
 * scan knows what belongs to the file and what doesn't.
 */
export async function detectiveScan(
  reader: ByteReader,
  ext: string | null,
  onProgress?: (bytesDone: number) => void,
): Promise<DetectiveReport> {
  const findings: Finding[] = [];
  const claimed: [number, number][] = [];
  const isClaimed = (offset: number) => claimed.some(([a, b]) => offset >= a && offset < b);
  const add = (f: Finding) => {
    findings.push(f);
    claimed.push([f.offset, f.offset + f.length]);
  };
  const structure = ext ? await parseStructure(reader, ext) : null;
  const regions = structure?.regions ?? [];

  // Something in front of an archive (a picture whose end hides a ZIP, read as ZIP).
  const prefix = regions[0]?.key.startsWith('zip.prefix') ? regions[0] : null;
  if (prefix) {
    const format = typeof prefix.values?.['format'] === 'string' ? prefix.values['format'] : null;
    add({
      kind: 'prefix',
      hidden: true,
      offset: 0,
      length: prefix.end,
      format,
      key: format ? 'prefixKnown' : 'prefix',
      values: { bytes: prefix.end },
    });
  }

  // Data behind the format's end.
  if (structure?.appendedAt != null) {
    const at = structure.appendedAt;
    const length = reader.size - at;
    const head = await reader.read(at, 4096);
    const found = findSignature(head);
    const padding = !found && head.every((b) => b === 0 || b === 0xff);
    const format = found?.ext ?? null;
    add({
      kind: 'appended',
      hidden: !padding,
      offset: at,
      length,
      format,
      key: padding
        ? 'appendedPadding'
        : format === 'mp4' && ext === 'jpg'
          ? 'motionPhoto'
          : format
            ? 'appendedKnown'
            : 'appended',
      values: { bytes: length },
      ...(format === 'zip' && { entries: await zipEntriesAt(reader, at, length) }),
    });
  }

  // Other files inside this one.
  const hits = await signatureHits(reader, onProgress);
  for (const hit of hits) {
    if (findings.length >= MAX_FINDINGS) break;
    if (hit.offset === 0 || isClaimed(hit.offset)) continue;
    const region = regionAt(regions, hit.offset);
    // Members of an archive are its normal content.
    if (region && (region.key === 'zip.local' || region.key.startsWith('zip.data'))) continue;
    // EXIF metadata is stored in TIFF layout – that's how EXIF works, not a hidden file.
    if (hit.ext === 'tiff' && /exif/i.test(region?.label ?? '')) continue;
    const size = await measure(reader, hit);
    if (!size) continue;
    const exifThumb = hit.ext === 'jpg' && region?.label === 'APP1 EXIF';
    // A PDF is full of embedded pictures and fonts – but a ZIP in it is out of place.
    const inPdf = structure?.format === 'pdf' && region?.key === 'pdf.body' && hit.ext !== 'zip';
    add({
      kind: exifThumb ? 'thumbnail' : inPdf ? 'part' : 'embedded',
      hidden: !exifThumb && !inPdf,
      offset: hit.offset,
      length: size.length,
      format: hit.ext,
      key: exifThumb ? 'thumbnail' : inPdf ? 'pdfObject' : 'embedded',
      values: { bytes: size.length },
      ...(hit.ext === 'zip' && { entries: size.structure?.entries }),
    });
  }

  // Text notes in pictures.
  for (const region of regions) {
    if (findings.length >= MAX_FINDINGS) break;
    if (region.kind !== 'chunk' || !TEXT_NOTE_KEYS.has(region.key)) continue;
    const note = await textNote(reader, region);
    if (!note || note.text.trim() === '') continue;
    findings.push({
      kind: 'text-note',
      hidden: false,
      offset: region.start,
      length: region.end - region.start + Number(region.values?.['bytes'] ?? 0),
      format: null,
      key: 'textNote',
      values: { keyword: note.keyword ?? region.label ?? '' },
      text: note.text,
    });
  }

  // Invisible characters in text files – a whole Conbert message, or just characters.
  if (!structure && sniffText(await reader.read(0, 4096))) {
    const text = utf8.decode(await reader.read(0, Math.min(reader.size, MAX_ZERO_WIDTH_SCAN)));
    const message = textSecrets(text);
    if (message.length > 0) {
      for (const m of message) findings.push({ ...m, hidden: true, format: null });
    } else {
      const zw = await zeroWidth(reader);
      if (zw) findings.push(zw);
    }
  }

  // Traces of the workshop's hiding tricks: LSB steganography in pictures and
  // sound, locked messages in metadata.
  const secrets = [
    ...(ext === 'png' || ext === 'bmp' ? await pictureSecrets(reader) : []),
    ...(ext === 'wav' ? await audioSecrets(reader) : []),
    ...(await sealedSecrets(reader)),
  ];
  for (const secret of secrets) findings.push({ ...secret, hidden: true, format: null });

  findings.sort((a, b) => Number(b.hidden) - Number(a.hidden) || a.offset - b.offset);
  return { findings, truncated: findings.length >= MAX_FINDINGS };
}
