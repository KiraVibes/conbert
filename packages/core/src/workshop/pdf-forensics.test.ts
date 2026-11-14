import { describe, expect, it } from 'vitest';
import { coverOf, pdfVersions } from './pdf-forensics';

const enc = (s: string) => new TextEncoder().encode(s);

describe('PDF versions', () => {
  it('finds every saved state of an incrementally updated PDF', () => {
    const v1 = '%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n';
    const v2 = '2 0 obj<<>>endobj\ntrailer<</Prev 0>>\n%%EOF\r\n';
    const v3 = '3 0 obj<<>>endobj\n%%EOF';
    const versions = pdfVersions(enc(v1 + v2 + v3));
    expect(versions.map((v) => v.end)).toEqual([
      v1.length,
      v1.length + v2.length,
      v1.length + v2.length + v3.length,
    ]);
    expect(versions.map((v) => v.number)).toEqual([1, 2, 3]);
  });

  it('skips the first-page part of a linearized PDF', () => {
    const pdf = '%PDF-1.7\n1 0 obj<</Linearized 1/L 99>>endobj\n%%EOF\nrest\n%%EOF\n';
    expect(pdfVersions(enc(pdf))).toHaveLength(1);
  });
});

describe('covered text', () => {
  const page = (w: number, h: number, paint: (x: number, y: number) => number) => {
    const px = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const v = paint(x, y);
        px.set([v, v, v, 255], (y * w + x) * 4);
      }
    return px;
  };

  it('sees a black box over text', () => {
    const px = page(100, 40, () => 0);
    expect(coverOf(px, 100, 40, { x: 10, y: 10, w: 60, h: 12 })).toEqual({
      covered: true,
      color: 'dark',
    });
  });

  it('does not flag visible text (letters on paper)', () => {
    const px = page(100, 40, (x, y) => (x % 5 < 2 && y % 4 < 3 ? 20 : 255));
    expect(coverOf(px, 100, 40, { x: 10, y: 10, w: 60, h: 12 }).covered).toBe(false);
  });
});
