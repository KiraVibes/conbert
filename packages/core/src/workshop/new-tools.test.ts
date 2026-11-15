import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { bytesReader } from './reader';
import { extractPalette, paletteFile } from './palette';
import { fileMap, fileMapOffset, hilbertIndex, hilbertPoint } from './file-map';
import { shrinkZipImages, sizeReport } from './size-report';
import { hiddenTextKind } from './hidden-text';
import { addFrame, heightfieldStl, reliefHeights, DEFAULT_RELIEF } from './lithophane';
import {
  openPackageHtml,
  packageHtml,
  PACKAGE_OPEN_JS,
  sealContent,
  type PackageTexts,
} from './password-package';
import {
  cellWritingArea,
  findCornerMarkers,
  glyphFromCell,
  markerCenters,
  SHEET,
  traceOutlines,
} from './handwriting';

let seed = 7;
const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32;
const random = (n: number) => Uint8Array.from({ length: n }, () => Math.floor(rnd() * 256));

describe('colour palette', () => {
  it('finds the main colours with their share; transparent pixels do not count', () => {
    const px = new Uint8ClampedArray(1000 * 4);
    for (let i = 0; i < 1000; i++) {
      const c = i < 600 ? [220, 30, 30, 255] : i < 900 ? [20, 40, 200, 255] : [0, 255, 0, 0];
      px.set(c, i * 4);
    }
    const p = extractPalette(px, 4);
    expect(p[0]?.hex).toBe('#dc1e1e');
    expect(p[0]?.share).toBeCloseTo(600 / 900, 2);
    expect(p[1]?.hex).toBe('#1428c8');
    expect(p.some((c) => c.g === 255)).toBe(false);
    expect(paletteFile(p, 'css')).toContain('--color-1: #dc1e1e;');
    expect(paletteFile(p, 'gpl')).toMatch(/^GIMP Palette/);
  });
});

describe('file map', () => {
  it('Hilbert curve and its inverse match', () => {
    for (let d = 0; d < 256; d++) {
      const { x, y } = hilbertPoint(16, d);
      expect(hilbertIndex(16, x, y)).toBe(d);
    }
  });
  it('colours by byte kind and finds the bytes behind a pixel', () => {
    const bytes = new Uint8Array(512);
    bytes.fill(0x41, 256);
    const m = fileMap(bytes, 'kind');
    expect(m.side).toBe(32);
    expect(m.shares.zero).toBeCloseTo(0.5);
    expect(m.shares.text).toBeCloseTo(0.5);
    const { x, y } = hilbertPoint(m.side, 300);
    expect(fileMapOffset(m, bytes.length, x, y)).toEqual({ from: 300, to: 301 });
    const { x: ex, y: ey } = hilbertPoint(m.side, 900);
    expect(fileMapOffset(m, bytes.length, ex, ey)).toBeNull();
    expect(fileMap(random(4096), 'entropy').rgba[3]).toBe(255);
  });
});

const box = (type: string, ...parts: Uint8Array[]) => {
  const len = 8 + parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(len);
  new DataView(out.buffer).setUint32(0, len);
  out.set(new TextEncoder().encode(type), 4);
  let p = 8;
  for (const x of parts) {
    out.set(x, p);
    p += x.length;
  }
  return out;
};
const u32 = (...v: number[]) => {
  const o = new Uint8Array(v.length * 4);
  v.forEach((n, i) => new DataView(o.buffer).setUint32(i * 4, n));
  return o;
};

describe('why is my file so big', () => {
  it('Office: the pictures are the big part – and can be shrunk in place', async () => {
    const zip = zipSync({
      '[Content_Types].xml': new TextEncoder().encode('<Types/>'),
      'word/document.xml': new TextEncoder().encode('<w:document>Hallo</w:document>'),
      'word/media/image1.png': [random(600_000), { level: 0 }],
    });
    const r = await sizeReport(bytesReader(zip));
    expect(r.kind).toBe('office');
    expect(r.parts[0]?.kind).toBe('images');
    expect(r.parts[0]?.items[0]?.name).toBe('word/media/image1.png');
    expect(r.tips.map((t) => t.key)).toContain('shrinkImages');
    const small = await shrinkZipImages(bytesReader(zip), async () => new Uint8Array(1000));
    expect(small.replaced).toBe(1);
    expect(small.bytes.length).toBeLessThan(10_000);
  });

  it('JPEG: metadata, picture and a video glued to the end (motion photo)', async () => {
    const exif = new Uint8Array([
      0xff,
      0xe1,
      0x00,
      0x0a,
      ...new TextEncoder().encode('Exif'),
      0,
      0,
      0,
      0,
    ]);
    const pic = new Uint8Array([
      0xff,
      0xda,
      0,
      4,
      1,
      2,
      ...random(5000).map((b) => (b === 0xff ? 0 : b)),
      0xff,
      0xd9,
    ]);
    const video = box('ftyp', random(4000));
    const file = new Uint8Array([0xff, 0xd8, ...exif.subarray(0, 12), ...pic, ...video]);
    const r = await sizeReport(bytesReader(file));
    expect(r.kind).toBe('jpeg');
    expect(r.parts.find((p) => p.kind === 'appended')?.bytes).toBe(video.length);
    expect(r.appendedAt).toBe(file.length - video.length);
    expect(r.tips[0]).toMatchObject({ key: 'motionPhoto', action: 'stripAppended' });
  });

  it('PDF: pictures and fonts by their streams', async () => {
    const img = 'X'.repeat(800_000);
    const pdf =
      `%PDF-1.7\n1 0 obj\n<< /Type /XObject /Subtype /Image /Width 2000 /Height 1500 /Filter /DCTDecode /Length ${img.length} >>\nstream\n${img}\nendstream\nendobj\n` +
      `2 0 obj\n<< /Length1 9000 /Length 9000 >>\nstream\n${'F'.repeat(9000)}\nendstream\nendobj\n%%EOF\n`;
    const r = await sizeReport(bytesReader(new TextEncoder().encode(pdf)));
    expect(r.kind).toBe('pdf');
    expect(r.parts[0]).toMatchObject({ kind: 'images' });
    expect(r.parts[0]?.items[0]?.note).toBe('2000×1500 JPEG');
    expect(r.parts.find((p) => p.kind === 'fonts')?.bytes).toBeGreaterThan(9000);
    expect(r.tips[0]?.key).toBe('compressPdf');
  });

  it('MP4: bytes per track from the sample sizes, high bitrate gets a tip', async () => {
    const hdlr = (t: string) =>
      box('hdlr', u32(0, 0), new TextEncoder().encode(t), new Uint8Array(13));
    const mdhd = box('mdhd', u32(0, 0, 0, 1000, 10_000));
    const stsdVideo = box(
      'stsd',
      u32(0, 1),
      box('avc1', new Uint8Array(24), new Uint8Array([7, 128, 4, 56]), new Uint8Array(50)),
    );
    const stsz = (n: number, size: number) => box('stsz', u32(0, size, n));
    const trak = (t: string, stsd: Uint8Array, sz: Uint8Array) =>
      box('trak', box('mdia', mdhd, hdlr(t), box('minf', box('stbl', stsd, sz))));
    const moov = box(
      'moov',
      trak('vide', stsdVideo, stsz(300, 200_000)),
      trak('soun', box('stsd', u32(0, 1), box('lpcm', new Uint8Array(28))), stsz(1, 8_000_000)),
    );
    const file = new Uint8Array([
      ...box('ftyp', new TextEncoder().encode('isom')),
      ...moov,
      ...box('mdat', new Uint8Array(100)),
    ]);
    const r = await sizeReport({
      size: file.length + 68_000_000,
      read: async (o, l) => file.subarray(o, o + l),
    });
    expect(r.kind).toBe('mp4');
    expect(r.parts[0]).toMatchObject({ kind: 'video', bytes: 60_000_000 });
    expect(r.parts[0]?.items[0]?.note).toBe('1920×1080 · 48.0 Mbit/s');
    expect(r.tips.map((t) => t.key)).toEqual(['compressVideo', 'pcmAudio']);
  });

  it('WAV: estimates FLAC and MP3; packed data gets "already packed"', async () => {
    const data = 10 * 1024 * 1024;
    const wav = new Uint8Array(44 + 64);
    const dv = new DataView(wav.buffer);
    wav.set(new TextEncoder().encode('RIFF'), 0);
    wav.set(new TextEncoder().encode('WAVEfmt '), 8);
    dv.setUint32(16, 16, true);
    dv.setUint16(20, 1, true);
    dv.setUint16(22, 2, true);
    dv.setUint32(24, 44100, true);
    dv.setUint16(34, 16, true);
    wav.set(new TextEncoder().encode('data'), 36);
    dv.setUint32(40, data, true);
    const r = await sizeReport({ size: 44 + data, read: async (o, l) => wav.subarray(o, o + l) });
    expect(r.kind).toBe('wav');
    expect(r.tips[0]).toMatchObject({ key: 'wavToSmaller', values: { flac: 6, mp3: 1 } });
    const g = await sizeReport(bytesReader(random(300_000)));
    expect(g.tips[0]?.key).toBe('alreadyPacked');
  });
});

describe('hidden text', () => {
  const page = (w: number, h: number, v: number) => new Uint8ClampedArray(w * h * 4).fill(v);
  it('tells visible, invisible, pale, tiny and off-page text apart', () => {
    const px = page(100, 40, 255);
    const b = { x: 10, y: 10, w: 60, h: 12 };
    expect(hiddenTextKind(px, 100, 40, b, 11)).toBe('invisible');
    for (let x = 20; x < 30; x++)
      for (let y = 12; y < 20; y++) px.set([0, 0, 0, 255], (y * 100 + x) * 4);
    expect(hiddenTextKind(px, 100, 40, b, 11)).toBeNull();
    const pale = page(100, 40, 255);
    for (let x = 20; x < 30; x++)
      for (let y = 12; y < 20; y++) pale.set([235, 235, 235, 255], (y * 100 + x) * 4);
    expect(hiddenTextKind(pale, 100, 40, b, 11)).toBe('faint');
    expect(hiddenTextKind(px, 100, 40, b, 1)).toBe('tiny');
    expect(hiddenTextKind(px, 100, 40, { x: -80, y: 10, w: 60, h: 12 }, 11)).toBe('offpage');
  });
});

describe('lithophane / relief', () => {
  it('writes a closed STL: every edge twice, in opposite directions, positive volume', () => {
    const cols = 6;
    const rows = 4;
    const heights = new Float32Array(cols * rows).fill(2);
    const stl = heightfieldStl(heights, cols, rows, 0.5);
    const dv = new DataView(stl.buffer);
    const n = dv.getUint32(80, true);
    expect(stl.length).toBe(84 + n * 50);
    const edges = new Map<string, number>();
    let volume = 0;
    for (let t = 0; t < n; t++) {
      const v = [0, 1, 2].map((k) =>
        [0, 1, 2].map((c) => dv.getFloat32(84 + t * 50 + 12 + k * 12 + c * 4, true)),
      ) as [number, number, number][];
      const key = (p: number[]) => p.map((x) => x.toFixed(3)).join(',');
      for (let k = 0; k < 3; k++) {
        const e = `${key(v[k] ?? [])}>${key(v[(k + 1) % 3] ?? [])}`;
        edges.set(e, (edges.get(e) ?? 0) + 1);
      }
      const [a, b, c] = v as unknown as [number[], number[], number[]];
      volume +=
        ((a[0] ?? 0) * ((b[1] ?? 0) * (c[2] ?? 0) - (b[2] ?? 0) * (c[1] ?? 0)) -
          (a[1] ?? 0) * ((b[0] ?? 0) * (c[2] ?? 0) - (b[2] ?? 0) * (c[0] ?? 0)) +
          (a[2] ?? 0) * ((b[0] ?? 0) * (c[1] ?? 0) - (b[1] ?? 0) * (c[0] ?? 0))) /
        6;
    }
    for (const [e, count] of edges) {
      expect(count).toBe(1);
      const [from, to] = e.split('>');
      expect(edges.get(`${to}>${from}`)).toBe(1);
    }
    expect(volume).toBeCloseTo((cols - 1) * 0.5 * (rows - 1) * 0.5 * 2, 3);
  });
  it('dark is thick in a lithophane, the shape stands out in a relief, frame around', () => {
    const gray = new Uint8Array([0, 255]);
    const l = reliefHeights(gray, null, 2, 1, DEFAULT_RELIEF);
    expect(l[0]).toBeCloseTo(DEFAULT_RELIEF.maxMm);
    expect(l[1]).toBeCloseTo(DEFAULT_RELIEF.minMm);
    const r = reliefHeights(gray, null, 2, 1, { ...DEFAULT_RELIEF, mode: 'relief' });
    expect(r[0]).toBeCloseTo(DEFAULT_RELIEF.baseMm + DEFAULT_RELIEF.raiseMm);
    const f = addFrame(l, 2, 1, 2, 5);
    expect(f.cols).toBe(6);
    expect(f.heights[0]).toBe(5);
  });
});

describe('password package', () => {
  const texts: PackageTexts = {
    lang: 'de',
    heading: 'Paket',
    intro: 'i',
    hintLabel: 'Hinweis:',
    password: 'Passwort',
    open: 'Öffnen',
    opening: '…',
    wrong: 'falsch',
    noCrypto: 'nein',
    message: 'Nachricht',
    files: 'Dateien',
    save: 'Speichern',
    saveAll: 'Alle',
    footer: 'Conbert',
  };
  it('locks files and a message into one HTML page and opens it again', async () => {
    const content = {
      message: 'Viel Spaß </script>',
      files: [
        { name: 'a.txt', type: 'text/plain', bytes: new TextEncoder().encode('hallo') },
        { name: 'b.bin', type: '', bytes: random(3000) },
      ],
    };
    const sealed = await sealContent(content, 'geheim123', 1000);
    const html = packageHtml(sealed, texts, '<b>Fotos</b>', 'Name vom Hund');
    expect(html).toContain('&#60;b&#62;Fotos');
    expect(html).not.toContain('Viel Spaß');
    expect(html).not.toMatch(/https?:\/\//);
    const back = await openPackageHtml(html, 'geheim123');
    expect(back.message).toBe(content.message);
    expect(back.files[1]?.bytes).toEqual(content.files[1]?.bytes);
    await expect(openPackageHtml(html, 'falsch')).rejects.toThrow();
    // The code inside the page opens it the same way.
    const cbOpen = new Function(`${PACKAGE_OPEN_JS}; return cbOpen;`)() as (
      ...a: unknown[]
    ) => Promise<{ message: string; files: { name: string; bytes: Uint8Array }[] }>;
    const viaPage = await cbOpen(
      sealed.data,
      sealed.salt,
      sealed.iv,
      sealed.iterations,
      'geheim123',
    );
    expect(viaPage.message).toBe(content.message);
    expect(viaPage.files[0]?.name).toBe('a.txt');
    expect(new TextDecoder().decode(viaPage.files[0]?.bytes)).toBe('hallo');
  });
});

describe('handwriting font', () => {
  const PX = 4;
  /** A clean "scan" of the sheet: markers, and ink in some boxes. */
  function sheet(draw: (set: (xMm: number, yMm: number) => void) => void) {
    const w = SHEET.width * PX;
    const h = SHEET.height * PX;
    const g = new Uint8Array(w * h).fill(245);
    const set = (x: number, y: number) => {
      const xi = Math.round(x * PX);
      const yi = Math.round(y * PX);
      if (xi >= 0 && yi >= 0 && xi < w && yi < h) g[yi * w + xi] = 20;
    };
    for (const [mx, my] of SHEET.markers)
      for (let y = my; y < my + SHEET.marker; y += 1 / PX)
        for (let x = mx; x < mx + SHEET.marker; x += 1 / PX) set(x, y);
    draw(set);
    return { g, w, h };
  }
  function crop(g: Uint8Array, w: number, i: number) {
    const a = cellWritingArea(i);
    const cw = Math.round(a.w * PX);
    const ch = Math.round(a.h * PX);
    const out = new Uint8Array(cw * ch);
    for (let y = 0; y < ch; y++)
      for (let x = 0; x < cw; x++)
        out[y * cw + x] = g[(Math.round(a.y * PX) + y) * w + Math.round(a.x * PX) + x] ?? 255;
    return { out, cw, ch };
  }

  it('finds the four corner squares', () => {
    const { g, w, h } = sheet(() => {});
    const m = findCornerMarkers(g, w, h);
    expect(m).not.toBeNull();
    markerCenters().forEach(([x, y], i) => {
      expect(m?.[i]?.x).toBeCloseTo(x * PX, -1);
      expect(m?.[i]?.y).toBeCloseTo(y * PX, -1);
    });
  });

  it('a written "O" becomes an outline with a hole; an empty box stays empty', () => {
    const a = cellWritingArea(0);
    const cx = a.x + a.w / 2;
    const cy = a.y + a.h * 0.45;
    const { g, w } = sheet((set) => {
      for (let y = a.y; y < a.y + a.h; y += 1 / PX)
        for (let x = a.x; x < a.x + a.w; x += 1 / PX) {
          const r = Math.hypot(x - cx, (y - cy) * 0.8);
          if (r > 4 && r < 5.5) set(x, y);
        }
    });
    const c = crop(g, w, 0);
    const glyph = glyphFromCell(c.out, c.cw, c.ch, PX);
    expect(glyph).not.toBeNull();
    expect(glyph?.commands.filter((x) => x.type === 'M')).toHaveLength(2);
    expect(glyph?.advance).toBeGreaterThan(400);
    const empty = crop(g, w, 5);
    expect(glyphFromCell(empty.out, empty.cw, empty.ch, PX)).toBeNull();
  });

  it('outer outline and hole run opposite ways', () => {
    const w = 20;
    const mask = new Uint8Array(w * w);
    for (let y = 3; y < 17; y++) for (let x = 3; x < 17; x++) mask[y * w + x] = 1;
    for (let y = 8; y < 12; y++) for (let x = 8; x < 12; x++) mask[y * w + x] = 0;
    const loops = traceOutlines(mask, w, w);
    expect(loops).toHaveLength(2);
    const area = (l: { x: number; y: number }[]) =>
      l.reduce((s, p, i) => {
        const q = l[(i + 1) % l.length] ?? p;
        return s + p.x * q.y - q.x * p.y;
      }, 0);
    expect(Math.sign(area(loops[0] ?? []))).toBe(-Math.sign(area(loops[1] ?? [])));
  });
});
