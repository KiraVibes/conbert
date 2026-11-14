/**
 * JPG origin: every JPEG carries the tables it was compressed with
 * (quantization tables) and a few markers of the program that wrote it.
 * Cameras use their own tables, programs and messengers mostly the standard
 * libjpeg tables at some quality – that, the size and the markers hint at
 * where a picture came from.
 */

/** The standard tables of the JPEG specification (Annex K), in zigzag order. */
const STD_LUMA = [
  16, 11, 12, 14, 12, 10, 16, 14, 13, 14, 18, 17, 16, 19, 24, 40, 26, 24, 22, 22, 24, 49, 35, 37,
  29, 40, 58, 51, 61, 60, 57, 51, 56, 55, 64, 72, 92, 78, 64, 68, 87, 69, 55, 56, 80, 109, 81, 87,
  95, 98, 103, 104, 103, 62, 77, 113, 121, 112, 100, 120, 92, 101, 103, 99,
];

/** libjpeg's scaling of the standard table for quality 1–100. */
export function scaledTable(quality: number): number[] {
  const q = Math.max(1, Math.min(100, quality));
  const scale = q < 50 ? 5000 / q : 200 - q * 2;
  return STD_LUMA.map((v) => Math.max(1, Math.min(255, Math.floor((v * scale + 50) / 100))));
}

export type JpegOrigin = 'camera' | 'editor' | 'messenger' | 'program' | 'unknown';

export const JPEG_CLUES = [
  'standardTables',
  'customTables',
  'quality',
  'cameraExif',
  'noExif',
  'photoshop',
  'adobe',
  'software',
  'progressive',
  'subsampling',
  'messengerSize',
  'jfif',
] as const;
export type JpegClueKey = (typeof JPEG_CLUES)[number];

export interface JpegClue {
  key: JpegClueKey;
  values?: Record<string, string | number>;
}

export interface JpegOriginReport {
  origin: JpegOrigin;
  /** Estimated quality 1–100 (exact when the standard tables were used). */
  quality: number | null;
  standard: boolean;
  width: number;
  height: number;
  clues: JpegClue[];
}

const ascii = (b: Uint8Array, at: number, n: number) =>
  String.fromCharCode(...b.subarray(at, Math.min(b.length, at + n)));

/** Typical longest sides after a messenger or social network re-saved a picture. */
const MESSENGER_SIDES = new Set([800, 1080, 1280, 1440, 1600, 2048, 2560]);

export function jpegOrigin(b: Uint8Array): JpegOriginReport | null {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  const tables: number[][] = [];
  let width = 0;
  let height = 0;
  let progressive = false;
  let sampling = '';
  let exifMake = '';
  let software = '';
  let photoshop = false;
  let adobe = false;
  let jfif = false;
  let exif = false;
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) break;
    const marker = b[i + 1] ?? 0;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const len = ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0);
    const body = i + 4;
    const end = Math.min(b.length, i + 2 + len);
    if (marker === 0xdb) {
      for (let p = body; p < end;) {
        const pq = (b[p] ?? 0) >> 4;
        const table: number[] = [];
        for (let k = 0; k < 64; k++)
          table.push(
            pq ? ((b[p + 1 + k * 2] ?? 0) << 8) | (b[p + 2 + k * 2] ?? 0) : (b[p + 1 + k] ?? 0),
          );
        tables.push(table);
        p += 1 + (pq ? 128 : 64);
      }
    } else if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    ) {
      progressive = marker === 0xc2 || marker === 0xc6 || marker === 0xca || marker === 0xce;
      height = ((b[body + 1] ?? 0) << 8) | (b[body + 2] ?? 0);
      width = ((b[body + 3] ?? 0) << 8) | (b[body + 4] ?? 0);
      const components = b[body + 5] ?? 0;
      if (components >= 3) {
        const f = b[body + 7] ?? 0x11;
        const h = f >> 4;
        const v = f & 15;
        sampling =
          h === 1 && v === 1
            ? '4:4:4'
            : h === 2 && v === 1
              ? '4:2:2'
              : h === 2 && v === 2
                ? '4:2:0'
                : `${h}x${v}`;
      }
    } else if (marker === 0xe0 && ascii(b, body, 4) === 'JFIF') {
      jfif = true;
    } else if (marker === 0xe1 && ascii(b, body, 4) === 'Exif') {
      exif = true;
      const tiff = body + 6;
      const le = b[tiff] === 0x49;
      const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
      const u16 = (o: number) => (o + 2 <= end ? v.getUint16(o, le) : 0);
      const u32 = (o: number) => (o + 4 <= end ? v.getUint32(o, le) : 0);
      const ifd = tiff + u32(tiff + 4);
      for (let k = 0; k < Math.min(u16(ifd), 64); k++) {
        const e = ifd + 2 + k * 12;
        const tag = u16(e);
        const count = u32(e + 4);
        const at = count > 4 ? tiff + u32(e + 8) : e + 8;
        const text = ascii(b, at, Math.min(count, 64)).replace(/\0.*$/, '').trim();
        if (tag === 0x010f) exifMake = text;
        if (tag === 0x0131) software = text;
      }
    } else if (marker === 0xed && ascii(b, body, 13) === 'Photoshop 3.0') {
      photoshop = true;
    } else if (marker === 0xee && ascii(b, body, 5) === 'Adobe') {
      adobe = true;
    } else if (marker === 0xda) {
      break;
    }
    i += 2 + len;
  }

  const luma = tables[0];
  let quality: number | null = null;
  let standard = false;
  if (luma) {
    let best = Infinity;
    for (let q = 1; q <= 100; q++) {
      const t = scaledTable(q);
      const diff = t.reduce((n, v, k) => n + Math.abs(v - (luma[k] ?? 0)), 0);
      if (diff < best) {
        best = diff;
        quality = q;
      }
    }
    standard = best === 0;
  }

  const clues: JpegClue[] = [];
  clues.push({ key: standard ? 'standardTables' : 'customTables' });
  if (quality !== null) clues.push({ key: 'quality', values: { quality } });
  if (exifMake) clues.push({ key: 'cameraExif', values: { make: exifMake } });
  else if (!exif) clues.push({ key: 'noExif' });
  if (photoshop) clues.push({ key: 'photoshop' });
  if (adobe) clues.push({ key: 'adobe' });
  if (software) clues.push({ key: 'software', values: { software } });
  if (progressive) clues.push({ key: 'progressive' });
  if (sampling) clues.push({ key: 'subsampling', values: { sampling } });
  const longest = Math.max(width, height);
  const messengerSize = MESSENGER_SIDES.has(longest);
  if (messengerSize && !exif) clues.push({ key: 'messengerSize', values: { side: longest } });
  if (jfif && !exif) clues.push({ key: 'jfif' });

  const editor =
    photoshop ||
    adobe ||
    /photoshop|lightroom|gimp|affinity|pixelmator|snapseed|canva|paint\.net|picsart/i.test(
      software,
    );
  const origin: JpegOrigin = editor
    ? 'editor'
    : exifMake && !standard
      ? 'camera'
      : standard && !exif && messengerSize
        ? 'messenger'
        : standard
          ? 'program'
          : exifMake
            ? 'camera'
            : 'unknown';
  return { origin, quality, standard, width, height, clues };
}
