import { WorkshopError } from './zip-tools';

/**
 * The small preview picture many JPEGs carry inside their EXIF data (IFD1).
 * Some file explorers and camera apps show it instead of the picture itself –
 * so it can differ from the real picture: after cropping or retouching (a
 * forensic clue), or on purpose (the preview prank).
 */

/** An APP1 segment holds at most 65535 bytes including its length field. */
const MAX_APP1 = 0xffff;
const EXIF_ID = [0x45, 0x78, 0x69, 0x66, 0, 0]; // "Exif\0\0"

interface Segment {
  marker: number;
  /** Offset of the 0xFF of the marker. */
  start: number;
  /** Offset after the segment. */
  end: number;
}

const isJpeg = (b: Uint8Array) => b.length > 4 && b[0] === 0xff && b[1] === 0xd8;

/** The segments before the image data (SOS), each with its marker. */
function headerSegments(b: Uint8Array): Segment[] {
  const out: Segment[] = [];
  let i = 2;
  while (i + 4 <= b.length && b[i] === 0xff) {
    const marker = b[i + 1] ?? 0;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    if (marker === 0xff) {
      i += 1; // fill byte
      continue;
    }
    const len = ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0);
    if (len < 2) break;
    out.push({ marker, start: i, end: Math.min(b.length, i + 2 + len) });
    if (marker === 0xda) break; // start of scan – picture data follows
    i += 2 + len;
  }
  return out;
}

function isExifSegment(b: Uint8Array, s: Segment): boolean {
  return s.marker === 0xe1 && EXIF_ID.every((v, k) => b[s.start + 4 + k] === v);
}

/** The EXIF preview picture of a JPEG, or null when there is none. */
export function readExifThumbnail(bytes: Uint8Array): Uint8Array | null {
  if (!isJpeg(bytes)) return null;
  const seg = headerSegments(bytes).find((s) => isExifSegment(bytes, s));
  if (!seg) return null;
  const tiff = seg.start + 10;
  const end = seg.end;
  const little = bytes[tiff] === 0x49;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (o: number) => (o + 2 <= end ? view.getUint16(o, little) : 0);
  const u32 = (o: number) => (o + 4 <= end ? view.getUint32(o, little) : 0);
  const ifd0 = tiff + u32(tiff + 4);
  if (ifd0 + 2 > end) return null;
  const ifd1Offset = u32(ifd0 + 2 + u16(ifd0) * 12);
  if (!ifd1Offset) return null;
  const ifd1 = tiff + ifd1Offset;
  if (ifd1 + 2 > end) return null;
  let offset = 0;
  let length = 0;
  for (let k = 0; k < u16(ifd1); k++) {
    const e = ifd1 + 2 + k * 12;
    const tag = u16(e);
    const type = u16(e + 2);
    const value = type === 3 ? u16(e + 8) : u32(e + 8);
    if (tag === 0x0201) offset = value;
    if (tag === 0x0202) length = value;
  }
  const from = tiff + offset;
  if (!offset || !length || from + length > end) return null;
  const thumb = bytes.slice(from, from + length);
  return isJpeg(thumb) ? thumb : null;
}

/** Minimal little-endian EXIF block: IFD0 (orientation "normal") and IFD1 with the preview. */
function exifApp1(thumb: Uint8Array): Uint8Array {
  const ifd0 = 8;
  const ifd1 = ifd0 + 2 + 12 + 4;
  const data = ifd1 + 2 + 3 * 12 + 4;
  const tiff = new Uint8Array(data + thumb.length);
  const v = new DataView(tiff.buffer);
  tiff.set([0x49, 0x49, 0x2a, 0x00]);
  v.setUint32(4, ifd0, true);
  const entry = (at: number, tag: number, type: number, value: number) => {
    v.setUint16(at, tag, true);
    v.setUint16(at + 2, type, true);
    v.setUint32(at + 4, 1, true);
    if (type === 3) v.setUint16(at + 8, value, true);
    else v.setUint32(at + 8, value, true);
  };
  v.setUint16(ifd0, 1, true);
  entry(ifd0 + 2, 0x0112, 3, 1); // Orientation: normal
  v.setUint32(ifd0 + 14, ifd1, true);
  v.setUint16(ifd1, 3, true);
  entry(ifd1 + 2, 0x0103, 3, 6); // Compression: JPEG
  entry(ifd1 + 14, 0x0201, 4, data); // where the preview starts
  entry(ifd1 + 26, 0x0202, 4, thumb.length); // how long it is
  v.setUint32(ifd1 + 38, 0, true);
  tiff.set(thumb, data);

  const size = 2 + EXIF_ID.length + tiff.length;
  const seg = new Uint8Array(2 + size);
  seg.set([0xff, 0xe1, size >> 8, size & 0xff]);
  seg.set(EXIF_ID, 4);
  seg.set(tiff, 4 + EXIF_ID.length);
  return seg;
}

/** The largest preview that still fits into the EXIF block. */
export const MAX_EXIF_THUMB_BYTES = MAX_APP1 - 2 - EXIF_ID.length - 68;

/**
 * Puts `thumb` (a JPEG) into `main` (a JPEG) as its EXIF preview. Any EXIF
 * block of `main` is replaced; everything else stays as it was.
 */
export function withExifThumbnail(main: Uint8Array, thumb: Uint8Array): Uint8Array {
  if (!isJpeg(main) || !isJpeg(thumb)) throw new WorkshopError('broken', 'not a JPEG');
  if (thumb.length > MAX_EXIF_THUMB_BYTES) throw new WorkshopError('too-big', 'preview too big');
  const kept: Uint8Array[] = [];
  let pos = 0;
  for (const seg of headerSegments(main).filter((x) => isExifSegment(main, x))) {
    kept.push(main.subarray(pos, seg.start));
    pos = seg.end;
  }
  kept.push(main.subarray(pos));
  const stripped = concat(kept);
  // After a JFIF block (APP0) if there is one, else right after the start marker.
  const first = headerSegments(stripped)[0];
  const at = first?.marker === 0xe0 ? first.end : 2;
  return concat([stripped.subarray(0, at), exifApp1(thumb), stripped.subarray(at)]);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export type ThumbVerdict = 'none' | 'same' | 'cropped' | 'different';

/**
 * How well the preview matches the picture. `changed` = share of differing
 * pixels after both were scaled to the preview's size (0–1); `aspectGap` =
 * how far the side ratios are apart (0 = equal).
 */
export function thumbVerdict(changed: number, aspectGap: number): ThumbVerdict {
  if (changed > 0.25) return 'different';
  if (aspectGap > 0.04) return 'cropped';
  return 'same';
}
