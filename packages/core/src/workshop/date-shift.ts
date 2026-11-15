/**
 * Fix a wrong camera clock: find every "when was this taken" inside a photo
 * (EXIF, XMP) or video (MP4/MOV: mvhd, tkhd, mdhd, Apple/©day text dates)
 * and shift it. Every date is overwritten in place with one of the same
 * length, so the file keeps its structure – only a few bytes change.
 */
import type { ByteReader } from './reader';

export type DateSpot =
  /** "2024:05:01 12:00:00" (EXIF) or "2024-05-01T12:00:00…" (XMP, video text). */
  | { kind: 'text'; offset: number; text: string }
  /** Seconds since 1904 (MP4/MOV boxes), 4 or 8 bytes big-endian. */
  | { kind: 'mp4'; offset: number; size: 4 | 8; value: number };

export interface MediaDates {
  kind: 'jpeg' | 'mp4' | 'none';
  /** When it was taken, as the camera wrote it (local clock time, read as UTC). */
  taken: Date | null;
  /** true: `taken` is a real moment (MP4 box time, UTC); false: a camera clock time. */
  utc: boolean;
  camera: string | null;
  spots: DateSpot[];
}

export interface BytePatch {
  offset: number;
  bytes: Uint8Array;
}

const latin1 = (b: Uint8Array) => {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return s;
};
const u16be = (b: Uint8Array, o: number) => ((b[o] ?? 0) << 8) | (b[o + 1] ?? 0);
const u32be = (b: Uint8Array, o: number) =>
  ((b[o] ?? 0) * 0x1000000 +
    (((b[o + 1] ?? 0) << 16) | ((b[o + 2] ?? 0) << 8) | (b[o + 3] ?? 0))) >>>
  0;

/** Seconds between 1904-01-01 (MP4) and 1970-01-01 (JavaScript). */
const MP4_EPOCH = 2_082_844_800;

const EXIF_DATE = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/;

/** A date text as a moment (its clock time read as UTC, the zone suffix ignored). */
export function parseDateText(text: string): Date | null {
  const m = EXIF_DATE.exec(text) ?? ISO_DATE.exec(text);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const t = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? 0));
  // "0000:00:00 00:00:00" means "unknown".
  return Number(y) < 1900 || Number.isNaN(t) ? null : new Date(t);
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** The same date text, `seconds` later, in exactly the same format and length. */
export function shiftDateText(text: string, seconds: number): string {
  const date = parseDateText(text);
  if (!date) return text;
  const d = new Date(date.getTime() + seconds * 1000);
  const Y = pad(d.getUTCFullYear(), 4);
  const M = pad(d.getUTCMonth() + 1);
  const D = pad(d.getUTCDate());
  const h = pad(d.getUTCHours());
  const m = pad(d.getUTCMinutes());
  const s = pad(d.getUTCSeconds());
  if (EXIF_DATE.test(text)) return `${Y}:${M}:${D} ${h}:${m}:${s}`;
  const iso = ISO_DATE.exec(text);
  if (!iso) return text;
  const head = iso[6] !== undefined ? `${Y}-${M}-${D}T${h}:${m}:${s}` : `${Y}-${M}-${D}T${h}:${m}`;
  // Fractions and time zone stay as they were.
  return head + text.slice(iso[0].length);
}

/* ---------------------------------------------------------------- JPEG */

function jpegDates(b: Uint8Array): MediaDates {
  const spots: DateSpot[] = [];
  let camera: string | null = null;
  let original: string | null = null;
  let other: string | null = null;
  let p = 2;
  while (p + 4 <= b.length && b[p] === 0xff) {
    const marker = b[p + 1] ?? 0;
    if (marker === 0xda || marker === 0xd9) break;
    const len = u16be(b, p + 2);
    const end = Math.min(b.length, p + 2 + len);
    const id = latin1(b.subarray(p + 4, p + 10));
    if (marker === 0xe1 && id.startsWith('Exif')) {
      const tiff = p + 10;
      const le = b[tiff] === 0x49;
      const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
      const r16 = (o: number) => (o + 2 <= end ? v.getUint16(o, le) : 0);
      const r32 = (o: number) => (o + 4 <= end ? v.getUint32(o, le) : 0);
      const text = (e: number) => {
        const count = r32(e + 4);
        const at = count > 4 ? tiff + r32(e + 8) : e + 8;
        return {
          at,
          value: latin1(b.subarray(at, Math.min(end, at + count))).replace(/\0.*$/s, ''),
        };
      };
      const walk = (ifd: number, depth: number) => {
        if (ifd <= tiff || ifd + 2 > end || depth > 2) return;
        const n = Math.min(r16(ifd), 300);
        for (let k = 0; k < n; k++) {
          const e = ifd + 2 + k * 12;
          const tag = r16(e);
          if (tag === 0x0110) camera = text(e).value.trim() || camera;
          if (tag === 0x0132 || tag === 0x9003 || tag === 0x9004) {
            const t = text(e);
            if (EXIF_DATE.test(t.value)) {
              spots.push({ kind: 'text', offset: t.at, text: t.value });
              if (tag === 0x9003) original = t.value;
              else other ??= t.value;
            }
          }
          if (tag === 0x8769) walk(tiff + r32(e + 8), depth + 1);
        }
      };
      walk(tiff + r32(tiff + 4), 0);
    } else if (
      marker === 0xe1 &&
      latin1(b.subarray(p + 4, p + 33)) === 'http://ns.adobe.com/xap/1.0/\0'
    ) {
      // XMP: ISO dates in the usual date fields, as attribute or element.
      const xmp = latin1(b.subarray(p + 33, end));
      const re =
        /(?:xmp:CreateDate|xmp:ModifyDate|xmp:MetadataDate|photoshop:DateCreated|exif:DateTimeOriginal|exif:DateTimeDigitized)(?:="|>)(\d{4}-\d{2}-\d{2}T[^"<]*)/g;
      for (const m of xmp.matchAll(re)) {
        const value = m[1] ?? '';
        if (ISO_DATE.test(value))
          spots.push({
            kind: 'text',
            offset: p + 33 + (m.index ?? 0) + m[0].length - value.length,
            text: value,
          });
      }
    }
    p += 2 + len;
  }
  const best = original ?? other;
  return { kind: 'jpeg', taken: best ? parseDateText(best) : null, utc: false, camera, spots };
}

/* ----------------------------------------------------------------- MP4 */

async function mp4Dates(reader: ByteReader): Promise<MediaDates> {
  const none: MediaDates = { kind: 'mp4', taken: null, utc: false, camera: null, spots: [] };
  // Find moov at the top level (it can be at the start or at the end).
  let p = 0;
  let moov: { start: number; size: number } | null = null;
  while (p + 8 <= reader.size) {
    const h = await reader.read(p, 16);
    let size = u32be(h, 0);
    const type = latin1(h.subarray(4, 8));
    if (size === 1) size = u32be(h, 8) * 0x100000000 + u32be(h, 12);
    else if (size === 0) size = reader.size - p;
    if (size < 8) break;
    if (type === 'moov') {
      moov = { start: p, size };
      break;
    }
    p += size;
  }
  if (!moov || moov.size > 64 * 1024 * 1024) return none;
  const b = await reader.read(moov.start, moov.size);
  const spots: DateSpot[] = [];
  let taken: Date | null = null;
  let utc = true;
  let camera: string | null = null;
  const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'udta', 'meta', 'ilst', 'edts']);
  const walk = (from: number, to: number) => {
    let q = from;
    while (q + 8 <= to) {
      const size = u32be(b, q);
      const type = latin1(b.subarray(q + 4, q + 8));
      if (size < 8 || q + size > to) break;
      if (type === 'mvhd' || type === 'tkhd' || type === 'mdhd') {
        const v1 = b[q + 8] === 1;
        for (const at of v1 ? [q + 12, q + 20] : [q + 12, q + 16]) {
          const value = v1 ? u32be(b, at) * 0x100000000 + u32be(b, at + 4) : u32be(b, at);
          // 0 = "not set" – leave it alone.
          if (value === 0) continue;
          spots.push({ kind: 'mp4', offset: moov.start + at, size: v1 ? 8 : 4, value });
          if (type === 'mvhd' && at === q + 12) taken = new Date((value - MP4_EPOCH) * 1000);
        }
      }
      // "meta" boxes have 4 bytes of version/flags before their children (ISO), QuickTime's not.
      if (CONTAINERS.has(type)) {
        const inner = type === 'meta' && u32be(b, q + 8) === 0 ? q + 12 : q + 8;
        walk(inner, q + size);
      }
      q += size;
    }
  };
  walk(8, b.length);
  // Text dates (Apple "creationdate", ©day): same-length ISO strings.
  const text = latin1(b);
  for (const m of text.matchAll(
    /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g,
  )) {
    spots.push({ kind: 'text', offset: moov.start + (m.index ?? 0), text: m[0] });
    // Apple's own date is local clock time – best for "taken".
    if (text.slice(Math.max(0, (m.index ?? 0) - 64), m.index).includes('creationdate')) {
      taken = parseDateText(m[0]);
      utc = false;
    }
  }
  const model = /com\.apple\.quicktime\.model[\s\S]{0,40}?data[\s\S]{8}([\x20-\x7e]{2,40})/.exec(
    text,
  );
  if (model?.[1]) camera = model[1].trim();
  return { kind: 'mp4', taken, utc: taken ? utc : false, camera, spots };
}

/** All dates in a photo (JPEG) or video (MP4/MOV), or kind 'none'. */
export async function findMediaDates(reader: ByteReader): Promise<MediaDates> {
  const head = await reader.read(0, Math.min(reader.size, 1024 * 1024));
  if (head[0] === 0xff && head[1] === 0xd8) return jpegDates(head);
  if (latin1(head.subarray(4, 8)) === 'ftyp') return mp4Dates(reader);
  return { kind: 'none', taken: null, utc: false, camera: null, spots: [] };
}

/** The byte changes that move every date by `seconds`. */
export function datePatches(spots: readonly DateSpot[], seconds: number): BytePatch[] {
  return spots.map((s) => {
    if (s.kind === 'text') {
      const t = shiftDateText(s.text, seconds);
      return { offset: s.offset, bytes: Uint8Array.from(t, (c) => c.charCodeAt(0)) };
    }
    const v = Math.max(0, Math.round(s.value + seconds));
    const bytes = new Uint8Array(s.size);
    const dv = new DataView(bytes.buffer);
    if (s.size === 8) {
      dv.setUint32(0, Math.floor(v / 0x100000000));
      dv.setUint32(4, v % 0x100000000);
    } else dv.setUint32(0, Math.min(v, 0xffffffff));
    return { offset: s.offset, bytes };
  });
}

/** Applies patches to a copy of the bytes (for small files and tests). */
export function applyPatches(bytes: Uint8Array, patches: readonly BytePatch[]): Uint8Array {
  const out = bytes.slice();
  for (const p of patches) out.set(p.bytes, p.offset);
  return out;
}

/** "+1 d 2 h 3 min 4 s" style parts of a shift (for showing it). */
export function splitSeconds(seconds: number) {
  const sign = seconds < 0 ? -1 : 1;
  let s = Math.abs(Math.round(seconds));
  const days = Math.floor(s / 86400);
  s -= days * 86400;
  const hours = Math.floor(s / 3600);
  s -= hours * 3600;
  const minutes = Math.floor(s / 60);
  return { sign, days, hours, minutes, seconds: s - minutes * 60 };
}
