import { zipSync, type Zippable } from 'fflate';

/**
 * Small makers: stickers (free-standing picture with a white edge), comics
 * (CBZ / EPUB from pictures) and batch renaming with EXIF details.
 */

// ---------------------------------------------------------------- sticker

/**
 * Removes a plain background: starting at the picture's border, every
 * connected pixel close to the border colour becomes transparent (works for
 * logos, screenshots, photos on a plain wall – not for busy backgrounds).
 */
export function removeFlatBackground(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  tolerance = 40,
): void {
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  const corner = (x: number, y: number) => {
    const o = (y * w + x) * 4;
    return [rgba[o] ?? 0, rgba[o + 1] ?? 0, rgba[o + 2] ?? 0];
  };
  const refs = [corner(0, 0), corner(w - 1, 0), corner(0, h - 1), corner(w - 1, h - 1)];
  const close = (p: number) => {
    const o = p * 4;
    if ((rgba[o + 3] ?? 0) < 16) return true;
    return refs.some(
      (c) =>
        Math.abs((rgba[o] ?? 0) - (c[0] ?? 0)) +
          Math.abs((rgba[o + 1] ?? 0) - (c[1] ?? 0)) +
          Math.abs((rgba[o + 2] ?? 0) - (c[2] ?? 0)) <
        tolerance,
    );
  };
  for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
  while (stack.length > 0) {
    const p = stack.pop() ?? 0;
    if (seen[p] || !close(p)) continue;
    seen[p] = 1;
    rgba[p * 4 + 3] = 0;
    const x = p % w;
    if (x > 0) stack.push(p - 1);
    if (x < w - 1) stack.push(p + 1);
    if (p >= w) stack.push(p - w);
    if (p < w * (h - 1)) stack.push(p + w);
  }
}

/** The box around everything that isn't transparent (null when nothing is left). */
export function opaqueBox(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
): { x: number; y: number; w: number; h: number } | null {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if ((rgba[(y * w + x) * 4 + 3] ?? 0) > 16) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * Puts an edge of `radius` pixels in `color` around the visible shape (the
 * classic sticker look). Distances come from a quick two-pass chamfer map.
 */
export function addOutline(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  radius: number,
  color: [number, number, number] = [255, 255, 255],
): Uint8ClampedArray<ArrayBuffer> {
  const INF = 1e9;
  const d = new Float32Array(w * h);
  for (let p = 0; p < w * h; p++) d[p] = (rgba[p * 4 + 3] ?? 0) > 128 ? 0 : INF;
  const D = 1;
  const DD = Math.SQRT2;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      let v = d[p] ?? INF;
      if (x > 0) v = Math.min(v, (d[p - 1] ?? INF) + D);
      if (y > 0) {
        v = Math.min(v, (d[p - w] ?? INF) + D);
        if (x > 0) v = Math.min(v, (d[p - w - 1] ?? INF) + DD);
        if (x < w - 1) v = Math.min(v, (d[p - w + 1] ?? INF) + DD);
      }
      d[p] = v;
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const p = y * w + x;
      let v = d[p] ?? INF;
      if (x < w - 1) v = Math.min(v, (d[p + 1] ?? INF) + D);
      if (y < h - 1) {
        v = Math.min(v, (d[p + w] ?? INF) + D);
        if (x < w - 1) v = Math.min(v, (d[p + w + 1] ?? INF) + DD);
        if (x > 0) v = Math.min(v, (d[p + w - 1] ?? INF) + DD);
      }
      d[p] = v;
    }
  const out = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p++) {
    const o = p * 4;
    // Edge alpha, smooth over the last pixel.
    const edge = Math.max(0, Math.min(1, radius + 0.5 - (d[p] ?? INF)));
    const a = (rgba[o + 3] ?? 0) / 255;
    const outA = a + edge * (1 - a);
    for (let c = 0; c < 3; c++)
      out[o + c] =
        outA > 0 ? ((rgba[o + c] ?? 0) * a + (color[c] ?? 0) * edge * (1 - a)) / outA : 0;
    out[o + 3] = Math.round(outA * 255);
  }
  return out;
}

// ---------------------------------------------------------------- comics

export interface ComicPage {
  name: string;
  data: Uint8Array;
  /** 'jpg', 'png', 'webp', 'gif' */
  ext: string;
  width: number;
  height: number;
}

const MEDIA: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

const xml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** "Seite 2" before "Seite 10": names sorted like people count. */
export function naturalSort<T>(items: readonly T[], name: (t: T) => string): T[] {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  return [...items].sort((a, b) => collator.compare(name(a), name(b)));
}

/** A comic book archive (CBZ): the pictures, numbered, plus ComicInfo.xml. */
export function makeCbz(pages: readonly ComicPage[], title: string): Uint8Array {
  const files: Zippable = {};
  const digits = String(pages.length).length;
  pages.forEach((p, i) => {
    files[`${String(i + 1).padStart(Math.max(3, digits), '0')}.${p.ext}`] = [p.data, { level: 0 }];
  });
  files['ComicInfo.xml'] = new TextEncoder().encode(
    `<?xml version="1.0" encoding="utf-8"?>\n<ComicInfo><Title>${xml(title)}</Title><PageCount>${pages.length}</PageCount></ComicInfo>\n`,
  );
  return zipSync(files);
}

/** An EPUB 3 with one picture per page (fixed layout – reads like a comic). */
export function makeImageEpub(pages: readonly ComicPage[], title: string, id: string): Uint8Array {
  const first = pages[0];
  const vw = first?.width ?? 1000;
  const vh = first?.height ?? 1500;
  const enc = (s: string) => new TextEncoder().encode(s);
  const files: Zippable = { mimetype: [enc('application/epub+zip'), { level: 0 }] };
  files['META-INF/container.xml'] = enc(
    '<?xml version="1.0"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>\n',
  );
  const manifest: string[] = [];
  const spine: string[] = [];
  const nav: string[] = [];
  pages.forEach((p, i) => {
    const n = String(i + 1).padStart(4, '0');
    const img = `images/p${n}.${p.ext}`;
    files[`OEBPS/${img}`] = [p.data, { level: 0 }];
    files[`OEBPS/p${n}.xhtml`] = enc(
      `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${i + 1}</title><meta name="viewport" content="width=${p.width}, height=${p.height}"/><style>html,body{margin:0;padding:0}img{display:block;width:100%;height:100%;object-fit:contain}</style></head><body><img src="${img}" alt="${i + 1}"/></body></html>\n`,
    );
    manifest.push(
      `<item id="i${n}" href="${img}" media-type="${MEDIA[p.ext] ?? 'image/jpeg'}"${i === 0 ? ' properties="cover-image"' : ''}/>`,
    );
    manifest.push(`<item id="p${n}" href="p${n}.xhtml" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="p${n}"/>`);
    nav.push(`<li><a href="p${n}.xhtml">${i + 1}</a></li>`);
  });
  files['OEBPS/nav.xhtml'] = enc(
    `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>${xml(title)}</title></head><body><nav epub:type="toc"><ol>${nav.join('')}</ol></nav></body></html>\n`,
  );
  const modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  files['OEBPS/content.opf'] = enc(
    `<?xml version="1.0" encoding="utf-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" prefix="rendition: http://www.idpf.org/vocab/rendition/#"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">urn:uuid:${id}</dc:identifier><dc:title>${xml(title)}</dc:title><dc:language>und</dc:language><meta property="dcterms:modified">${modified}</meta><meta property="rendition:layout">pre-paginated</meta><meta property="rendition:spread">auto</meta><meta name="original-resolution" content="${vw}x${vh}"/></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${manifest.join('')}</manifest><spine>${spine.join('')}</spine></package>\n`,
  );
  return zipSync(files);
}

// ---------------------------------------------------------------- batch rename

export interface RenameSource {
  name: string;
  /** Taken / created (EXIF) or the file's own date. */
  date: Date;
  camera: string | null;
}

/** Placeholders the pattern understands. */
export const RENAME_TOKENS = [
  'name',
  'nr',
  'datum',
  'zeit',
  'jahr',
  'monat',
  'tag',
  'kamera',
  'ext',
] as const;

const FORBIDDEN = /[<>:"/\\|?*]/g;
/** Control characters (codes below 32) never belong in a file name. */
const withoutControl = (s: string) => [...s].filter((c) => c.charCodeAt(0) >= 32).join('');

/**
 * New names from a pattern like "{datum}_{kamera}_{nr}". Names that would
 * repeat get "-2", "-3" …; the extension always stays.
 */
export function renameFiles(
  files: readonly RenameSource[],
  pattern: string,
  options: { start?: number; digits?: number } = {},
): string[] {
  const start = options.start ?? 1;
  const digits = options.digits ?? Math.max(2, String(files.length + start - 1).length);
  const used = new Map<string, number>();
  const pad = (n: number, l = 2) => String(n).padStart(l, '0');
  return files.map((f, i) => {
    const dot = f.name.lastIndexOf('.');
    const base = dot > 0 ? f.name.slice(0, dot) : f.name;
    const ext = dot > 0 ? f.name.slice(dot + 1) : '';
    const d = f.date;
    const values: Record<(typeof RENAME_TOKENS)[number], string> = {
      name: base,
      nr: pad(start + i, digits),
      datum: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      zeit: `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`,
      jahr: String(d.getFullYear()),
      monat: pad(d.getMonth() + 1),
      tag: pad(d.getDate()),
      kamera: (f.camera ?? '').trim().replace(/\s+/g, '-'),
      ext,
    };
    let name = withoutControl(pattern)
      .replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? values[k as keyof typeof values] : m))
      .replace(FORBIDDEN, '_')
      .replace(/[-_ ]{2,}/g, (m) => m[0] ?? '')
      .replace(/^[-_ .]+|[-_ .]+$/g, '');
    if (!name) name = base;
    const full = ext ? `${name}.${ext}` : name;
    const key = full.toLowerCase();
    const n = (used.get(key) ?? 0) + 1;
    used.set(key, n);
    return n === 1 ? full : ext ? `${name}-${n}.${ext}` : `${name}-${n}`;
  });
}

/** When a JPEG was taken and with which camera (EXIF), read from its first bytes. */
export function exifBasics(b: Uint8Array): { date: Date | null; camera: string | null } {
  const none = { date: null, camera: null };
  if (b[0] !== 0xff || b[1] !== 0xd8) return none;
  let i = 2;
  while (i + 4 <= b.length && b[i] === 0xff) {
    const marker = b[i + 1] ?? 0;
    const len = ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0);
    if (marker === 0xe1 && String.fromCharCode(...b.subarray(i + 4, i + 8)) === 'Exif') {
      const tiff = i + 10;
      const end = Math.min(b.length, i + 2 + len);
      const le = b[tiff] === 0x49;
      const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
      const u16 = (o: number) => (o + 2 <= end ? v.getUint16(o, le) : 0);
      const u32 = (o: number) => (o + 4 <= end ? v.getUint32(o, le) : 0);
      const text = (e: number) => {
        const count = u32(e + 4);
        const at = count > 4 ? tiff + u32(e + 8) : e + 8;
        return String.fromCharCode(...b.subarray(at, Math.min(end, at + Math.min(count, 64))))
          .replace(/\0.*$/, '')
          .trim();
      };
      let model: string | null = null;
      let date: string | null = null;
      const ifd0 = tiff + u32(tiff + 4);
      let exif = 0;
      for (let k = 0; k < Math.min(u16(ifd0), 100); k++) {
        const e = ifd0 + 2 + k * 12;
        const tag = u16(e);
        if (tag === 0x0110) model = text(e);
        if (tag === 0x0132) date ??= text(e);
        if (tag === 0x8769) exif = tiff + u32(e + 8);
      }
      if (exif)
        for (let k = 0; k < Math.min(u16(exif), 200); k++) {
          const e = exif + 2 + k * 12;
          if (u16(e) === 0x9003) date = text(e);
        }
      const m = date ? /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(date) : null;
      return {
        date: m
          ? new Date(
              Number(m[1]),
              Number(m[2]) - 1,
              Number(m[3]),
              Number(m[4]),
              Number(m[5]),
              Number(m[6]),
            )
          : null,
        camera: model || null,
      };
    }
    if (marker === 0xda) break;
    i += 2 + len;
  }
  return none;
}
