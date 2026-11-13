// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileTypeFromBuffer } from 'file-type';
import Vips from 'wasm-vips';
import { beforeAll, describe, expect, it } from 'vitest';
import { ConversionError, engineI18nKeys, getFormat } from '@conbert/core';
import { findMissingKeys } from '@conbert/i18n';
import { resolveImageOptions as resolveOptions } from '@conbert/core';
import { convertWithVips, type VipsModule } from './libvips-convert';
import { LIBVIPS_FORMATS, LIBVIPS_META, MODULE_FORMATS } from './libvips-definition';

const FIXTURES: Record<string, string> = {
  png: 'sample.png',
  jpg: 'sample.jpg',
  webp: 'sample.webp',
  gif: 'sample-animated.gif',
  tiff: 'sample.tiff',
  avif: 'sample.avif',
  jxl: 'sample.jxl',
  svg: 'sample.svg',
};

const fixture = (ext: string) =>
  new Uint8Array(readFileSync(path.join(import.meta.dirname, '__fixtures__', FIXTURES[ext] ?? '')));

const readable = LIBVIPS_FORMATS.filter((f) => f.canRead).map((f) => f.ext);
const writable = LIBVIPS_FORMATS.filter((f) => f.canWrite).map((f) => f.ext);

let vips: VipsModule;

beforeAll(async () => {
  vips = await Vips({ dynamicLibraries: [...new Set(Object.values(MODULE_FORMATS))] });
}, 60_000);

function decode(buffer: Uint8Array, options: Record<string, unknown> = {}) {
  const image = vips.Image.newFromBuffer(buffer, '', options);
  const info = {
    width: image.width,
    height: image.height,
    pages: image.getTypeof('n-pages') ? image.getInt('n-pages') : 1,
    hasAlpha: image.hasAlpha(),
    fields: image.getFields(),
  };
  image.delete();
  return info;
}

describe('libvips engine definition', () => {
  it('has a fixture for every readable format', () => {
    for (const ext of readable) expect(FIXTURES[ext], ext).toBeDefined();
  });

  it('only declares formats from the registry', () => {
    for (const f of LIBVIPS_FORMATS) expect(getFormat(f.ext), f.ext).toBeDefined();
  });

  it('has German and English texts for the engine and all options', () => {
    expect(findMissingKeys(engineI18nKeys(LIBVIPS_META))).toEqual([]);
  });
});

describe('convertWithVips – every format combination', () => {
  for (const from of readable) {
    for (const to of writable) {
      if (from === to) continue;
      it(`${from} → ${to}`, async () => {
        const output = convertWithVips(vips, fixture(from), from, to, {});
        const type = await fileTypeFromBuffer(output);
        // file-type reports 'tif' for TIFF; normalize through the registry.
        expect(getFormat(type?.ext ?? '')?.ext).toBe(to);
        const info = decode(output);
        expect(info.width).toBe(8);
        expect(info.height).toBe(8);
      });
    }
  }
});

describe('convertWithVips – behaviour', () => {
  it('turns transparent areas white for JPG', () => {
    const output = convertWithVips(vips, fixture('png'), 'png', 'jpg', {});
    const image = vips.Image.newFromBuffer(output);
    expect(image.hasAlpha()).toBe(false);
    // Column 7 was half-transparent blue → blended with white it gets lighter.
    const [r = 0] = image.getpoint(7, 4);
    expect(r).toBeGreaterThan(100);
    image.delete();
  });

  it('keeps transparency for WebP', () => {
    const output = convertWithVips(vips, fixture('png'), 'png', 'webp', {});
    expect(decode(output).hasAlpha).toBe(true);
  });

  it('keeps animations from GIF to WebP by default', () => {
    const output = convertWithVips(vips, fixture('gif'), 'gif', 'webp', {});
    expect(decode(output, { n: -1 }).pages).toBe(2);
  });

  it('keeps only the first frame when asked to', () => {
    const output = convertWithVips(vips, fixture('gif'), 'gif', 'webp', { keepAnimation: false });
    expect(decode(output, { n: -1 }).pages).toBe(1);
  });

  it('shrinks the picture for a target size (scalePercent)', () => {
    const output = convertWithVips(vips, fixture('png'), 'png', 'png', { scalePercent: 50 });
    expect(decode(output)).toMatchObject({ width: 4, height: 4 });
  });

  it('lower quality gives a smaller file', () => {
    const big = vips.Image.newFromBuffer(fixture('jpg')).resize(16);
    const input = big.writeToBuffer('.png');
    big.delete();
    const low = convertWithVips(vips, input, 'png', 'webp', { quality: 5 });
    const high = convertWithVips(vips, input, 'png', 'webp', { quality: 100 });
    expect(low.length).toBeLessThan(high.length);
  });

  it('removes EXIF metadata by default and keeps it on request', () => {
    const base = vips.Image.newFromBuffer(fixture('jpg')).copy();
    base.setString('exif-ifd0-ImageDescription', 'GPS secret');
    const withExif = base.writeToBuffer('.jpg', { keep: 'all' });
    base.delete();
    expect(decode(withExif).fields).toContain('exif-data');

    const stripped = convertWithVips(vips, withExif, 'jpg', 'png', {});
    expect(decode(stripped).fields).not.toContain('exif-data');

    const kept = convertWithVips(vips, withExif, 'jpg', 'png', { stripMetadata: false });
    expect(decode(kept).fields).toContain('exif-data');
  });

  it('reports broken files with a translatable error', () => {
    const garbage = new TextEncoder().encode('this is not an image');
    expect(() => convertWithVips(vips, garbage, 'png', 'webp', {})).toThrow(ConversionError);
    try {
      convertWithVips(vips, garbage, 'png', 'webp', {});
    } catch (error) {
      expect((error as ConversionError).messageKey).toBe('errors.convertFailed');
    }
  });

  it('refuses formats it cannot write', () => {
    expect(() => convertWithVips(vips, fixture('png'), 'png', 'svg', {})).toThrow(
      /formatUnavailable/,
    );
  });
});

describe('resolveOptions', () => {
  it('fills in defaults and clamps values', () => {
    expect(resolveOptions({})).toMatchObject({
      quality: 80,
      stripMetadata: true,
      effort: 'balanced',
    });
    expect(resolveOptions({ quality: 500 }).quality).toBe(100);
    expect(resolveOptions({ quality: -3 }).quality).toBe(1);
    expect(resolveOptions({ quality: 'abc' }).quality).toBe(80);
    expect(resolveOptions({ effort: 'warp-speed' }).effort).toBe('balanced');
    expect(resolveOptions({ stripMetadata: 'yes' }).stripMetadata).toBe(true);
  });
});
