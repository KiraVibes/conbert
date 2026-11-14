import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  addOutline,
  exifBasics,
  makeCbz,
  makeImageEpub,
  naturalSort,
  opaqueBox,
  removeFlatBackground,
  renameFiles,
} from './makers';

function square(w: number, h: number): Uint8ClampedArray {
  // White background, a red square in the middle.
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const inside = x >= 10 && x < 20 && y >= 10 && y < 20;
      px.set(inside ? [220, 30, 30, 255] : [250, 250, 250, 255], (y * w + x) * 4);
    }
  return px;
}

describe('sticker', () => {
  it('removes a plain background, finds the shape and draws an edge', () => {
    const px = square(30, 30);
    removeFlatBackground(px, 30, 30);
    expect(px[3]).toBe(0);
    expect(px[(15 * 30 + 15) * 4 + 3]).toBe(255);
    expect(opaqueBox(px, 30, 30)).toEqual({ x: 10, y: 10, w: 10, h: 10 });
    const out = addOutline(px, 30, 30, 3);
    // 2 px outside the square: white edge; 6 px outside: still transparent.
    expect([...out.subarray((15 * 30 + 8) * 4, (15 * 30 + 8) * 4 + 4)]).toEqual([
      255, 255, 255, 255,
    ]);
    expect(out[(15 * 30 + 4) * 4 + 3]).toBe(0);
    expect(out[(15 * 30 + 15) * 4]).toBe(220);
  });
});

describe('comics', () => {
  const pages = ['Seite 10.jpg', 'Seite 2.jpg', 'Seite 1.jpg'].map((name) => ({
    name,
    data: new Uint8Array([0xff, 0xd8, 0xff]),
    ext: 'jpg',
    width: 800,
    height: 1200,
  }));

  it('sorts pages like people count', () => {
    expect(naturalSort(pages, (p) => p.name).map((p) => p.name)).toEqual([
      'Seite 1.jpg',
      'Seite 2.jpg',
      'Seite 10.jpg',
    ]);
  });

  it('makes a CBZ and an EPUB', () => {
    const cbz = unzipSync(makeCbz(pages, 'Mein Comic'));
    expect(Object.keys(cbz).sort()).toEqual(['001.jpg', '002.jpg', '003.jpg', 'ComicInfo.xml']);
    const epub = makeImageEpub(pages, 'Mein <Comic>', '1234');
    // "mimetype" must be the first file, uncompressed.
    expect(strFromU8(epub.subarray(30, 38))).toBe('mimetype');
    const files = unzipSync(epub);
    expect(strFromU8(files['OEBPS/content.opf'] ?? new Uint8Array())).toContain(
      'Mein &lt;Comic&gt;',
    );
    expect(Object.keys(files).filter((n) => n.endsWith('.xhtml'))).toHaveLength(4);
  });
});

describe('batch rename', () => {
  const d = new Date(2024, 6, 14, 9, 5, 7);
  it('fills the pattern and keeps names apart', () => {
    const names = renameFiles(
      [
        { name: 'IMG_1.JPG', date: d, camera: 'Pixel 8' },
        { name: 'IMG_2.JPG', date: d, camera: 'Pixel 8' },
        { name: 'notiz.txt', date: d, camera: null },
      ],
      '{datum}_{kamera}_{nr}',
    );
    expect(names).toEqual([
      '2024-07-14_Pixel-8_01.JPG',
      '2024-07-14_Pixel-8_02.JPG',
      '2024-07-14_03.txt',
    ]);
    expect(
      renameFiles(
        [
          { name: 'a.jpg', date: d, camera: null },
          { name: 'b.jpg', date: d, camera: null },
        ],
        'Urlaub',
      ),
    ).toEqual(['Urlaub.jpg', 'Urlaub-2.jpg']);
    expect(
      renameFiles([{ name: 'a.jpg', date: d, camera: null }], '{jahr}/{monat}:{zeit}'),
    ).toEqual(['2024_07_09-05-07.jpg']);
  });

  it('reads date and camera from EXIF', () => {
    const tiff = [0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 2, 0,
      0x10, 0x01, 2, 0, 4, 0, 0, 0, 0x53, 0x6f, 0x6e, 0x79,
      0x32, 0x01, 2, 0, 20, 0, 0, 0, 38, 0, 0, 0,
      0, 0, 0, 0,
      ...new TextEncoder().encode('2023:12:24 18:30:00'), 0]; // prettier-ignore
    const jpg = new Uint8Array([
      0xff,
      0xd8,
      0xff,
      0xe1,
      0,
      2 + 6 + tiff.length,
      0x45,
      0x78,
      0x69,
      0x66,
      0,
      0,
      ...tiff,
    ]);
    const r = exifBasics(jpg);
    expect(r.camera).toBe('Sony');
    expect(r.date?.getFullYear()).toBe(2023);
    expect(r.date?.getHours()).toBe(18);
  });
});
