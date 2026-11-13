// @vitest-environment node
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import * as Magick from '@imagemagick/magick-wasm';
import { beforeAll, describe, expect, it } from 'vitest';
import { ConversionError, engineI18nKeys, getFormat } from '@conbert/core';
import { findMissingKeys } from '@conbert/i18n';
import { convertWithMagick } from './magick-convert';
import { MAGICK_FORMATS, MAGICK_META } from './magick-definition';

const require = createRequire(import.meta.url);
const fixture = (name: string) =>
  new Uint8Array(readFileSync(path.join(import.meta.dirname, '__fixtures__', name)));

beforeAll(async () => {
  await Magick.initializeImageMagick(
    readFileSync(require.resolve('@imagemagick/magick-wasm/magick.wasm')),
  );
}, 60_000);

/** Reads back an encoded image and returns its format and size. */
function inspect(data: Uint8Array) {
  return Magick.ImageMagick.read(data, (image) => ({
    format: image.format,
    width: image.width,
    height: image.height,
    hasAlpha: image.hasAlpha,
  }));
}

describe('ImageMagick browser engine definition', () => {
  it('has texts and only registry formats', () => {
    expect(findMissingKeys(engineI18nKeys(MAGICK_META))).toEqual([]);
    for (const f of MAGICK_FORMATS) expect(getFormat(f.ext), f.ext).toBeDefined();
  });
});

describe('convertWithMagick', () => {
  const writable = MAGICK_FORMATS.filter((f) => f.canWrite).map((f) => f.ext);
  for (const to of writable) {
    it(`png → ${to} → png`, () => {
      const out = convertWithMagick(Magick, fixture('sample.png'), 'png', to, {});
      const back = convertWithMagick(Magick, out, to, 'png', {});
      expect(inspect(back)).toMatchObject({ width: 8, height: 8 });
    });
  }

  it('reads iPhone photos (HEIC)', () => {
    const jpg = convertWithMagick(Magick, fixture('sample.heic'), 'heic', 'jpg', {});
    expect(inspect(jpg)).toMatchObject({ format: 'JPEG', width: 8, height: 8 });
  });

  it('turns transparency white for JPG and BMP', () => {
    for (const to of ['jpg', 'bmp']) {
      const out = convertWithMagick(Magick, fixture('sample.png'), 'png', to, {});
      expect(inspect(out).hasAlpha, to).toBe(false);
    }
  });

  it('keeps GIF animations when converting to WebP', () => {
    const webp = convertWithMagick(Magick, fixture('sample-animated.gif'), 'gif', 'webp', {});
    const frames = Magick.ImageMagick.readCollection(
      webp,
      Magick.MagickFormat.WebP,
      (c) => c.length,
    );
    expect(frames).toBe(2);
  });

  it('shrinks the picture for a target size (scalePercent)', () => {
    const jpg = convertWithMagick(Magick, fixture('sample.png'), 'png', 'jpg', {
      scalePercent: 50,
    });
    expect(inspect(jpg)).toMatchObject({ width: 4, height: 4 });
  });

  it('limits icons to 256 px', () => {
    const big = Magick.ImageMagick.read(fixture('sample.png'), Magick.MagickFormat.Png, (image) => {
      image.resize(600, 600);
      return image.write(Magick.MagickFormat.Png, (d) => d.slice());
    });
    const ico = convertWithMagick(Magick, big, 'png', 'ico', {});
    const width = Magick.ImageMagick.read(ico, Magick.MagickFormat.Ico, (image) => image.width);
    expect(width).toBeLessThanOrEqual(256);
  });

  it('reads with the declared format only (never guesses from the content)', () => {
    const mvg = new TextEncoder().encode('viewbox 0 0 10 10 fill red rectangle 0 0 10 10');
    expect(() => convertWithMagick(Magick, mvg, 'png', 'jpg', {})).toThrow(ConversionError);
  });
});
