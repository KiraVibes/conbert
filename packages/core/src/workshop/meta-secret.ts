import { packContent, StegoError, unpackContent } from './stego';

/**
 * Secret message in metadata: a text in a comment field of the file
 * (EXIF user comment, PNG/GIF comment, PDF subject, MP4 or audio comment).
 * Not invisible – anyone who opens the file properties can see it – but
 * hardly anyone looks there. With a password the field only holds a
 * scrambled-looking "CNBZ1:…" text.
 */

export const META_SPOTS = ['exif', 'png', 'gif', 'pdf', 'quicktime', 'audio'] as const;
export type MetaSpot = (typeof META_SPOTS)[number];

const SPOTS: Record<string, MetaSpot> = {
  jpg: 'exif',
  jpeg: 'exif',
  tif: 'exif',
  tiff: 'exif',
  webp: 'exif',
  heic: 'exif',
  png: 'png',
  gif: 'gif',
  pdf: 'pdf',
  mp4: 'quicktime',
  m4a: 'quicktime',
  mov: 'quicktime',
  mp3: 'audio',
  flac: 'audio',
  ogg: 'audio',
  opus: 'audio',
  wav: 'audio',
};

/** Where the message goes for this file type (null: not supported). */
export const metaSpotFor = (ext: string): MetaSpot | null => SPOTS[ext.toLowerCase()] ?? null;

/** File types the trick can write, for the help text. */
export const META_SECRET_EXTS = Object.keys(SPOTS).filter((e) => e !== 'jpeg' && e !== 'tif');

/** Spots ExifTool writes (PDF goes through pdf-lib, audio through ffmpeg). */
export type ExiftoolSpot = Exclude<MetaSpot, 'audio' | 'pdf'>;

const TAGS: Record<ExiftoolSpot, string> = {
  exif: 'EXIF:UserComment',
  png: 'PNG:Comment',
  // GIF keeps its comment in a block of its own, which ExifTool names just "Comment".
  gif: 'Comment',
  quicktime: 'ItemList:Comment',
};

/** ExifTool tags and arguments that write the message. */
export function exiftoolSecretWrite(
  spot: ExiftoolSpot,
  value: string,
): { tags: Record<string, string>; args: string[] } {
  return { tags: { [TAGS[spot]]: value }, args: ['-m'] };
}

/**
 * ffmpeg arguments for audio: copy every stream unchanged, only set the
 * comment (ID3 for MP3, Vorbis comment for FLAC/Ogg, INFO chunk for WAV).
 */
export function ffmpegCommentArgs(input: string, output: string, value: string): string[] {
  return [
    '-hide_banner',
    '-nostdin',
    '-y',
    '-loglevel',
    'error',
    '-i',
    input,
    '-map',
    '0',
    '-c',
    'copy',
    '-map_metadata',
    '0',
    '-metadata',
    `comment=${value}`,
    ...(output.endsWith('.mp3') ? ['-id3v2_version', '3'] : []),
    output,
  ];
}

export const SEALED_PREFIX = 'CNBZ1:';

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** The value to write: the text itself, or with a password the locked "CNBZ1:…" form. */
export async function sealMessage(text: string, password?: string): Promise<string> {
  if (!password) return text;
  const { flags, body } = await packContent({ kind: 'text', text }, password);
  const bytes = new Uint8Array(1 + body.length);
  bytes[0] = flags;
  bytes.set(body, 1);
  return SEALED_PREFIX + toBase64(bytes);
}

export const isSealed = (value: string) => value.trim().startsWith(SEALED_PREFIX);

/** Opens a locked message. */
export async function openMessage(value: string, password: string): Promise<string> {
  let bytes: Uint8Array;
  try {
    bytes = fromBase64(value.trim().slice(SEALED_PREFIX.length));
  } catch {
    throw new StegoError('damaged');
  }
  if (bytes.length < 2) throw new StegoError('damaged');
  const content = await unpackContent(bytes[0] ?? 0, bytes.subarray(1), password);
  if (content.kind !== 'text') throw new StegoError('damaged');
  return content.text;
}

export interface MessageField {
  /** ExifTool's "Group:Tag". */
  key: string;
  value: string;
  sealed: boolean;
}

// Fields people use for free text (where a message would hide).
const TEXT_FIELD =
  /comment|description|subject|keywords|title|caption|lyrics|notes?$|instructions|parameters|headline|label|text$/i;
// Technical groups that only describe the file itself (but JPEG and GIF
// comments are listed under "File").
const SKIP_GROUP = /^(System|ExifTool|Composite):|^File:(?!Comment$)/;

/**
 * Text fields from ExifTool's output (`-json -G1`): every field that can
 * hold free text, plus locked Conbert messages wherever they are.
 */
export function messageFields(tags: Record<string, unknown>): MessageField[] {
  const out: MessageField[] = [];
  for (const [key, raw] of Object.entries(tags)) {
    if (SKIP_GROUP.test(key)) continue;
    const value = Array.isArray(raw) ? raw.join(', ') : typeof raw === 'string' ? raw : null;
    if (!value?.trim()) continue;
    const sealed = isSealed(value);
    const tag = key.slice(key.indexOf(':') + 1);
    if (sealed || TEXT_FIELD.test(tag)) out.push({ key, value, sealed });
  }
  // Locked messages first.
  return out.sort((a, b) => Number(b.sealed) - Number(a.sealed));
}
