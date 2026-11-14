import { describe, expect, it } from 'vitest';
import {
  MAX_EXIF_THUMB_BYTES,
  readExifThumbnail,
  thumbVerdict,
  withExifThumbnail,
} from './exif-thumb';
import { WorkshopError } from './zip-tools';

const seg = (marker: number, body: number[]) => [
  0xff,
  marker,
  (body.length + 2) >> 8,
  (body.length + 2) & 0xff,
  ...body,
];

/** A JPEG-shaped file: start, optional blocks, scan header, "picture data", end. */
function jpeg(blocks: number[][], data: number[] = [1, 2, 3, 4]): Uint8Array {
  return new Uint8Array([
    0xff,
    0xd8,
    ...blocks.flat(),
    ...seg(0xda, [0, 0, 0]),
    ...data,
    0xff,
    0xd9,
  ]);
}

const jfif = seg(0xe0, [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
const dqt = seg(0xdb, [0, 9, 9, 9]);

describe('EXIF preview picture', () => {
  it('puts a preview in and reads it back, the picture stays the same', () => {
    const main = jpeg([jfif, dqt], [7, 7, 7]);
    const thumb = jpeg([], [42, 43]);
    const out = withExifThumbnail(main, thumb);
    expect(readExifThumbnail(out)).toEqual(thumb);
    // JFIF stays first, the EXIF block follows it.
    expect([...out.subarray(2, 2 + jfif.length)]).toEqual(jfif);
    expect(out[2 + jfif.length + 1]).toBe(0xe1);
    expect([...out.subarray(out.length - 5)]).toEqual([7, 7, 7, 0xff, 0xd9]);
  });

  it('replaces an EXIF block that was there before', () => {
    const once = withExifThumbnail(jpeg([dqt]), jpeg([], [1]));
    const twice = withExifThumbnail(once, jpeg([], [2, 2]));
    expect(readExifThumbnail(twice)).toEqual(jpeg([], [2, 2]));
    const app1 = [...twice].filter((b, i) => b === 0xff && twice[i + 1] === 0xe1).length;
    expect(app1).toBe(1);
  });

  it('has no preview without EXIF, and refuses non-JPEGs or a too big preview', () => {
    expect(readExifThumbnail(jpeg([jfif]))).toBeNull();
    expect(readExifThumbnail(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(() => withExifThumbnail(new Uint8Array([1, 2, 3, 4, 5]), jpeg([]))).toThrow(
      WorkshopError,
    );
    const big = jpeg([], new Array<number>(MAX_EXIF_THUMB_BYTES).fill(0));
    expect(() => withExifThumbnail(jpeg([]), big)).toThrow(/too-big/);
  });

  it('reads big-endian EXIF too', () => {
    const thumb = jpeg([], [5]);
    // TIFF "MM": IFD0 with 0 entries → IFD1 with offset/length tags.
    const tiff = [
      0x4d,
      0x4d,
      0,
      0x2a,
      0,
      0,
      0,
      8,
      0,
      0,
      0,
      0,
      0,
      14,
      0,
      2,
      0x02,
      0x01,
      0,
      4,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      44,
      0x02,
      0x02,
      0,
      4,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      thumb.length,
      0,
      0,
      0,
      0,
      ...thumb,
    ];
    const file = jpeg([seg(0xe1, [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff])]);
    expect(readExifThumbnail(file)).toEqual(thumb);
  });

  it('judges how well the preview matches', () => {
    expect(thumbVerdict(0.02, 0)).toBe('same');
    expect(thumbVerdict(0.05, 0.2)).toBe('cropped');
    expect(thumbVerdict(0.6, 0)).toBe('different');
  });
});
