import { describe, expect, it } from 'vitest';
import { copyMove, forensicFilter, luminance } from './image-forensics';
import { jpegOrigin, scaledTable } from './jpeg-origin';

function jpegHeader(table: number[], w: number, h: number, extra: number[][] = []): Uint8Array {
  const seg = (m: number, body: number[]) => [
    0xff,
    m,
    (body.length + 2) >> 8,
    (body.length + 2) & 255,
    ...body,
  ];
  return new Uint8Array([
    0xff,
    0xd8,
    ...extra.flat(),
    ...seg(0xdb, [0, ...table]),
    ...seg(0xc0, [8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]),
    ...seg(0xda, [0]),
  ]);
}

describe('JPG origin', () => {
  it('recognises the standard tables, their quality and a messenger size', () => {
    const r = jpegOrigin(jpegHeader(scaledTable(78), 1600, 1200));
    expect(r).toMatchObject({ standard: true, quality: 78, origin: 'messenger', width: 1600 });
    expect(r?.clues.map((c) => c.key)).toEqual(
      expect.arrayContaining(['standardTables', 'noExif', 'messengerSize', 'subsampling']),
    );
  });

  it('sees a camera by its own tables and EXIF make', () => {
    const custom = scaledTable(92).map((v, i) => v + (i % 3));
    // IFD0 with one entry: Make = "Sony" (4 bytes, stored inline).
    const tiff = [0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 1, 0, 0x0f, 0x01, 2, 0, 4, 0, 0, 0, 0x53, 0x6f, 0x6e, 0x79, 0, 0, 0, 0]; // prettier-ignore
    const exif = [0xff, 0xe1, 0, 2 + 6 + tiff.length, 0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
    const r = jpegOrigin(jpegHeader(custom, 6000, 4000, [exif]));
    expect(r?.origin).toBe('camera');
    expect(r?.clues).toContainEqual({ key: 'cameraExif', values: { make: 'Sony' } });
  });

  it('is null for other files', () => {
    expect(jpegOrigin(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

describe('copied areas', () => {
  it('finds a patch copied to another place', () => {
    const w = 128;
    const h = 96;
    let seed = 3;
    const rand = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) >>> 24;
    const g = new Float32Array(w * h).map(() => rand());
    // Copy a 24×24 patch from (10,10) to (80,50).
    for (let y = 0; y < 24; y++)
      for (let x = 0; x < 24; x++) g[(50 + y) * w + 80 + x] = g[(10 + y) * w + 10 + x] ?? 0;
    const r = copyMove(g, w, h);
    expect(r.regions[0]).toMatchObject({ dx: 70, dy: 40 });
    expect(r.mask[60 * w + 90]).toBe(2);
    expect(r.mask[20 * w + 20]).toBe(1);
  });

  it('finds nothing in plain noise', () => {
    let seed = 9;
    const rand = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) >>> 24;
    const g = new Float32Array(100 * 80).map(() => rand());
    expect(copyMove(g, 100, 80).regions).toEqual([]);
  });
});

describe('forensic filters', () => {
  it('turn a picture into a grey map of the same size', () => {
    const rgba = new Uint8ClampedArray(4 * 4 * 4).map((_, i) => (i % 4 === 3 ? 255 : i * 7));
    expect(luminance(rgba, 4, 4)).toHaveLength(16);
    for (const f of ['noise', 'edges', 'levels'] as const) {
      const out = forensicFilter(rgba, 4, 4, f, 10);
      expect(out).toHaveLength(64);
      expect(out[3]).toBe(255);
    }
  });
});
