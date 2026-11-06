import { packContent, StegoError, unpackContent, isEncryptedFlags } from './stego';

/**
 * Invisible text: a secret message written with characters that take up no
 * room (zero-width space, joiners …), tucked into a normal sentence. Plus a
 * finder for such characters in copied text – they also hide in AI prompts,
 * tracking watermarks and "Trojan Source" code.
 *
 * Conbert layout: 4 invisible characters stand for the digits 0–3, so one
 * byte takes 4 characters. Bytes: "ZW" · version · flags · packed content
 * (same packing as the picture steganography: deflate, AES-GCM or CRC-32).
 */

const DIGITS = [0x200b, 0x200c, 0x200d, 0x2060] as const;
const DIGIT_VALUE = new Map<number, number>(DIGITS.map((c, i) => [c, i]));
const MAGIC = [0x5a, 0x57]; // "ZW"
const VERSION = 1;
const HEAD = MAGIC.length + 2;

function bytesToInvisible(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) {
    for (let shift = 6; shift >= 0; shift -= 2)
      out += String.fromCharCode(DIGITS[(byte >> shift) & 3] ?? 0);
  }
  return out;
}

function invisibleToBytes(run: string): Uint8Array {
  const out = new Uint8Array(Math.floor(run.length / 4));
  for (let i = 0; i < out.length; i++) {
    let byte = 0;
    for (let j = 0; j < 4; j++)
      byte = (byte << 2) | (DIGIT_VALUE.get(run.charCodeAt(i * 4 + j)) ?? 0);
    out[i] = byte;
  }
  return out;
}

/** Where the message goes: right after the first word (else at the end). */
function insertAt(cover: string): number {
  const word = /\S\s/u.exec(cover);
  return word ? word.index + 1 : cover.length;
}

/** The cover text with the secret message hidden in it. */
export async function hideInText(
  cover: string,
  secret: string,
  password?: string,
): Promise<string> {
  const { flags, body } = await packContent({ kind: 'text', text: secret }, password || undefined);
  const bytes = new Uint8Array(HEAD + body.length);
  bytes.set(MAGIC);
  bytes[2] = VERSION;
  bytes[3] = flags;
  bytes.set(body, HEAD);
  const at = insertAt(cover);
  return cover.slice(0, at) + bytesToInvisible(bytes) + cover.slice(at);
}

/** Runs of Conbert's 4 digit characters (other tools use the same ones). */
function digitRuns(text: string): string[] {
  return [...text.matchAll(/(?:\u200b|\u200c|\u200d|\u2060)+/g)].map((m) => m[0]);
}

export interface HiddenTextInfo {
  encrypted: boolean;
  /** Invisible characters that carry the message. */
  characters: number;
}

function findConbert(text: string): { flags: number; body: Uint8Array; characters: number } | null {
  for (const run of digitRuns(text)) {
    if (run.length < (HEAD + 4) * 4) continue;
    const bytes = invisibleToBytes(run);
    if (bytes[0] !== MAGIC[0] || bytes[1] !== MAGIC[1] || bytes[2] !== VERSION) continue;
    return { flags: bytes[3] ?? 0, body: bytes.subarray(HEAD), characters: run.length };
  }
  return null;
}

/** Is there a Conbert message in the text? */
export function peekHiddenText(text: string): HiddenTextInfo | null {
  const found = findConbert(text);
  return found && { encrypted: isEncryptedFlags(found.flags), characters: found.characters };
}

/** Reads a Conbert message back. */
export async function revealFromText(text: string, password?: string): Promise<string> {
  const found = findConbert(text);
  if (!found) throw new StegoError('nothing-hidden');
  const content = await unpackContent(found.flags, found.body, password || undefined);
  if (content.kind !== 'text') throw new StegoError('damaged');
  return content.text;
}

const strict = new TextDecoder('utf-8', { fatal: true });
// Letters, digits, punctuation, spaces and line breaks of any script – no control codes.
const READABLE = /^[\p{L}\p{M}\p{N}\p{P}\p{S}\p{Zs}\n\r\t]+$/u;

function readable(bytes: Uint8Array): string | null {
  if (bytes.length === 0) return null;
  try {
    const text = strict.decode(bytes);
    return READABLE.test(text) ? text : null;
  } catch {
    return null;
  }
}

/**
 * Messages from other tools: most write bits with two characters (zero-width
 * space and non-joiner), 8 per letter. Tries both ways round.
 */
export function guessBinaryMessage(text: string): string | null {
  for (const run of digitRuns(text)) {
    const bits = run.replace(/\u2060/g, '');
    if (bits.length < 16 || bits.length % 8 !== 0 || /\u200d/.test(bits)) continue;
    for (const one of [0x200c, 0x200b]) {
      const bytes = new Uint8Array(bits.length / 8);
      for (let i = 0; i < bits.length; i++) {
        if (bits.charCodeAt(i) === one) bytes[i >> 3] = (bytes[i >> 3] ?? 0) | (0x80 >> (i & 7));
      }
      const found = readable(bytes);
      if (found) return found;
    }
  }
  return null;
}

// --- Finding invisible characters ------------------------------------------

export const INVISIBLE_KINDS = [
  'zero-width',
  'tag',
  'variation',
  'bidi',
  'filler',
  'soft-hyphen',
  'space',
] as const;
export type InvisibleKind = (typeof INVISIBLE_KINDS)[number];

/** A stretch of invisible characters of one kind (string indices, end exclusive). */
export interface InvisibleRun {
  kind: InvisibleKind;
  start: number;
  end: number;
  count: number;
  /** The code points, e.g. for "U+200B". */
  codes: number[];
  /** Text that the run spells out (Unicode tags, variation-selector bytes). */
  decoded?: string;
}

const BIDI = new Set([
  0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069,
]);
const ZERO_WIDTH = new Set([
  0x200b, 0x200c, 0x200d, 0x2060, 0x2061, 0x2062, 0x2063, 0x2064, 0x180e, 0xfeff,
]);
const FILLER = new Set([0x034f, 0x115f, 0x1160, 0x2800, 0x3164, 0xffa0]);
const SPACES = new Set([0x00a0, 0x1680, 0x202f, 0x205f, 0x3000]);
const isVariation = (cp: number) =>
  (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef);
const isTag = (cp: number) => cp >= 0xe0000 && cp <= 0xe007f;
const PICTOGRAPHIC = /\p{Extended_Pictographic}/u;
const isEmojiPart = (cp: number | undefined) =>
  cp !== undefined &&
  (PICTOGRAPHIC.test(String.fromCodePoint(cp)) ||
    cp === 0xfe0f ||
    (cp >= 0x1f3fb && cp <= 0x1f3ff));
const BLACK_FLAG = 0x1f3f4;

function kindOf(cp: number): InvisibleKind | null {
  if (ZERO_WIDTH.has(cp)) return 'zero-width';
  if (isTag(cp)) return 'tag';
  if (isVariation(cp)) return 'variation';
  if (BIDI.has(cp)) return 'bidi';
  if (FILLER.has(cp)) return 'filler';
  if (cp === 0x00ad) return 'soft-hyphen';
  if (SPACES.has(cp) || (cp >= 0x2000 && cp <= 0x200a)) return 'space';
  return null;
}

function decodeRun(kind: InvisibleKind, codes: number[]): string | undefined {
  if (kind === 'tag') {
    const ascii = codes
      .filter((c) => c >= 0xe0020 && c <= 0xe007e)
      .map((c) => String.fromCharCode(c - 0xe0000));
    return ascii.length > 0 ? ascii.join('') : undefined;
  }
  if (kind === 'variation') {
    const bytes = Uint8Array.from(codes, (c) => (c <= 0xfe0f ? c - 0xfe00 : c - 0xe0100 + 16));
    return readable(bytes) ?? undefined;
  }
  return undefined;
}

/**
 * Finds invisible characters. Leaves out the ones that belong there: a byte
 * order mark at the start, joiners inside emoji (family emoji), single variation
 * selectors (heart emoji) and the tags of flag emoji (Scotland).
 */
export function findInvisible(text: string): InvisibleRun[] {
  const points: { cp: number; at: number }[] = [];
  for (let i = 0; i < text.length;) {
    const cp = text.codePointAt(i) ?? 0;
    points.push({ cp, at: i });
    i += cp > 0xffff ? 2 : 1;
  }
  const flagged: (InvisibleKind | null)[] = points.map(({ cp }, i) => {
    const kind = kindOf(cp);
    if (!kind) return null;
    if (cp === 0xfeff && i === 0) return null;
    if (cp === 0x200d && isEmojiPart(points[i - 1]?.cp) && isEmojiPart(points[i + 1]?.cp))
      return null;
    return kind;
  });
  // Variation selectors: one after a character is normal, a whole row is not.
  // Tags: fine right after the black flag of a flag emoji.
  for (let i = 0; i < points.length;) {
    const kind = flagged[i];
    if (kind !== 'variation' && kind !== 'tag') {
      i++;
      continue;
    }
    let j = i;
    while (flagged[j] === kind) j++;
    const harmless = kind === 'variation' ? j - i === 1 : points[i - 1]?.cp === BLACK_FLAG;
    if (harmless) for (let k = i; k < j; k++) flagged[k] = null;
    i = j;
  }
  const runs: InvisibleRun[] = [];
  for (let i = 0; i < points.length; i++) {
    const kind = flagged[i];
    if (!kind) continue;
    const last = runs.at(-1);
    const point = points[i];
    if (!point) continue;
    const width = point.cp > 0xffff ? 2 : 1;
    if (last && last.kind === kind && last.end === point.at) {
      last.end += width;
      last.count++;
      last.codes.push(point.cp);
    } else {
      runs.push({ kind, start: point.at, end: point.at + width, count: 1, codes: [point.cp] });
    }
  }
  for (const run of runs) {
    const decoded = decodeRun(run.kind, run.codes);
    if (decoded) run.decoded = decoded;
  }
  return runs;
}

/** Counts per kind (only kinds that occur). */
export function countInvisible(
  runs: readonly InvisibleRun[],
): Partial<Record<InvisibleKind, number>> {
  const out: Partial<Record<InvisibleKind, number>> = {};
  for (const run of runs) out[run.kind] = (out[run.kind] ?? 0) + run.count;
  return out;
}

/** The text without the invisible characters; unusual spaces become normal ones. */
export function stripInvisible(
  text: string,
  runs: readonly InvisibleRun[] = findInvisible(text),
): string {
  let out = '';
  let at = 0;
  for (const run of runs) {
    out += text.slice(at, run.start);
    if (run.kind === 'space') out += ' '.repeat(run.count);
    at = run.end;
  }
  return out + text.slice(at);
}

/** "U+200B" */
export const codePointLabel = (cp: number) => `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
