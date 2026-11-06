import { describe, expect, it } from 'vitest';
import {
  RETRO_PALETTES,
  asciiArt,
  asciiHtml,
  channelShift,
  deepFry,
  glitchJpeg,
  jpegScanRange,
  pixelArt,
  scaleNearest,
  seededRandom,
  type Pixels,
} from './fun-image';

/** Left half black, right half white. */
function halves(width: number, height: number): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const v = x < width / 2 ? 0 : 255;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

function gradient(width: number, height: number): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const x = i % width;
    data[i * 4] = (x * 255) / (width - 1);
    data[i * 4 + 1] = 100;
    data[i * 4 + 2] = 255 - (x * 255) / (width - 1);
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

describe('ASCII art', () => {
  it('puts heavy characters where the picture is dark', () => {
    const art = asciiArt(halves(40, 40), 20, 'classic', false);
    expect(art.columns).toBe(20);
    // Characters are twice as tall as wide: half as many rows.
    expect(art.rows).toBe(10);
    expect(art.lines[0]).toBe('@'.repeat(10) + ' '.repeat(10));
    const dark = asciiArt(halves(40, 40), 20, 'classic', true);
    expect(dark.lines[0]).toBe(' '.repeat(10) + '@'.repeat(10));
  });

  it('writes a web page with the colours, safely escaped', () => {
    const art = asciiArt(halves(8, 4), 4, 'classic', false);
    const html = asciiHtml({ ...art, lines: ['<&>@'] }, true, false);
    expect(html).toContain('&lt;&amp;</span>');
    expect(html).toContain('>&gt;@</span>');
    expect(html).toContain('color:#000000');
    expect(asciiHtml(art, false, true)).toContain('background:#000');
  });
});

describe('pixel art', () => {
  it('uses only the colours of the palette', () => {
    const allowed = new Set<string>(RETRO_PALETTES.gameboy);
    for (const dither of ['none', 'floyd', 'ordered'] as const) {
      const out = pixelArt(gradient(64, 32), 32, 'gameboy', dither);
      expect(out.width).toBe(32);
      expect(out.height).toBe(16);
      for (let i = 0; i < out.data.length; i += 4) {
        const hex = `#${[0, 1, 2].map((o) => (out.data[i + o] ?? 0).toString(16).padStart(2, '0')).join('')}`;
        expect(allowed.has(hex), `${dither} ${hex}`).toBe(true);
      }
    }
  });

  it('turns black and white into the darkest and lightest colour', () => {
    const out = pixelArt(halves(8, 8), 8, 'mono', 'none');
    expect([...out.data.slice(0, 4)]).toEqual([0, 0, 0, 255]);
    expect([...out.data.slice(28, 32)]).toEqual([255, 255, 255, 255]);
  });

  it('enlarges with sharp edges', () => {
    const big = scaleNearest(halves(2, 1), 3);
    expect(big.width).toBe(6);
    expect(big.height).toBe(3);
    expect(big.data[2 * 4]).toBe(0);
    expect(big.data[3 * 4]).toBe(255);
  });
});

/** A tiny but well-formed JPEG layout: SOI, a header, SOS, data, EOI. */
function fakeJpeg(): Uint8Array {
  const data = Array.from({ length: 400 }, (_, i) => (i * 37) % 0xfe);
  data[100] = 0xff;
  data[101] = 0x00; // byte stuffing
  return new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xdb,
    0x00,
    0x04,
    0x01,
    0x02,
    0xff,
    0xda,
    0x00,
    0x04,
    0x03,
    0x04,
    ...data,
    0xff,
    0xd9,
  ]);
}

describe('glitch art', () => {
  it('only changes picture data, never into 0xFF', () => {
    const jpeg = fakeJpeg();
    const range = jpegScanRange(jpeg);
    expect(range).toEqual({ start: 14, end: 414 });
    const out = glitchJpeg(jpeg, 50, 7);
    expect(out).not.toBeNull();
    if (!out) return;
    expect(out.length).toBe(jpeg.length);
    expect([...out.slice(0, 14)]).toEqual([...jpeg.slice(0, 14)]);
    expect([...out.slice(-2)]).toEqual([0xff, 0xd9]);
    expect(out[114]).toBe(0xff);
    expect(out[115]).toBe(0x00);
    let changed = 0;
    for (let i = 14; i < 414; i++) {
      if (out[i] !== jpeg[i]) {
        changed++;
        expect(out[i]).not.toBe(0xff);
      }
    }
    expect(changed).toBeGreaterThan(0);
    // The same seed gives the same glitch.
    expect([...(glitchJpeg(jpeg, 50, 7) ?? [])]).toEqual([...out]);
    expect(glitchJpeg(new Uint8Array([1, 2, 3]), 5, 1)).toBeNull();
  });

  it('slides red and blue apart', () => {
    const out = channelShift(halves(10, 1), 2);
    // At x = 5 (first white pixel) red still comes from the black side.
    expect(out.data[5 * 4]).toBe(0);
    expect(out.data[5 * 4 + 2]).toBe(255);
  });
});

describe('deep fry', () => {
  it('makes colours stronger and stays repeatable', () => {
    const img: Pixels = { width: 1, height: 1, data: new Uint8ClampedArray([150, 120, 100, 255]) };
    const fried = deepFry(img, 1, 3);
    const spread = (d: Pixels['data']) => (d[0] ?? 0) - (d[2] ?? 0);
    expect(spread(fried.data)).toBeGreaterThan(spread(img.data));
    expect([...deepFry(img, 1, 3).data]).toEqual([...fried.data]);
    expect([...deepFry(img, 0, 3).data]).toEqual([150, 120, 100, 255]);
  });

  it('draws repeatable random numbers', () => {
    const a = seededRandom(42);
    const b = seededRandom(42);
    const values = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(values);
    expect(values.every((v) => v >= 0 && v < 1)).toBe(true);
  });
});
