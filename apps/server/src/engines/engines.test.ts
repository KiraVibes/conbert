import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileTypeFromFile } from 'file-type';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConversionError, engineI18nKeys, getFormat } from '@conbert/core';
import { findMissingKeys } from '@conbert/i18n';
import { buildArgs, imagemagickEngine, parseFormatList } from './imagemagick';
import { serverEngines } from './index';
import { sharpEngine } from './sharp';
import { hasCommand } from '../test/helpers';

const fixtures = path.join(import.meta.dirname, '../__fixtures__');
const FIXTURE: Record<string, string> = {
  jpg: 'sample.jpg',
  png: 'sample.png',
  webp: 'sample.webp',
  gif: 'sample-animated.gif',
  tiff: 'sample.tiff',
  avif: 'sample.avif',
  svg: 'sample.svg',
};

let workDir: string;
beforeAll(async () => {
  workDir = mkdtempSync(path.join(os.tmpdir(), 'conbert-engines-'));
  await sharpEngine.init();
  await imagemagickEngine.init();
});
afterAll(() => rmSync(workDir, { recursive: true, force: true }));

describe('server engines', () => {
  it('have German and English texts for engine and options', () => {
    for (const engine of serverEngines) {
      expect(findMissingKeys(engineI18nKeys(engine)), engine.id).toEqual([]);
    }
  });

  it('only declare formats from the registry', () => {
    for (const engine of serverEngines) {
      for (const f of engine.formats)
        expect(getFormat(f.ext), `${engine.id}: ${f.ext}`).toBeDefined();
    }
  });
});

describe('sharp', () => {
  it('is ready', () => {
    expect(sharpEngine.status()).toBe('ready');
  });

  const readable = sharpEngine.formats.filter((f) => f.canRead).map((f) => f.ext);
  const writable = sharpEngine.formats.filter((f) => f.canWrite).map((f) => f.ext);
  for (const from of readable) {
    for (const to of writable) {
      if (from === to) continue;
      it(`${from} → ${to}`, async () => {
        const out = await sharpEngine.convert({
          input: path.join(fixtures, FIXTURE[from] ?? ''),
          inputExt: from,
          outputExt: to,
          options: {},
          workDir,
        });
        expect(typeof out).toBe('string');
        const type = await fileTypeFromFile(String(out));
        expect(getFormat(type?.ext ?? '')?.ext).toBe(to);
        const meta = await sharp(String(out)).metadata();
        expect(meta.width).toBe(8);
      });
    }
  }

  it('turns transparency white for JPG and keeps animations for WebP', async () => {
    const jpg = await sharpEngine.convert({
      input: path.join(fixtures, 'sample.png'),
      inputExt: 'png',
      outputExt: 'jpg',
      options: {},
      workDir,
    });
    expect((await sharp(String(jpg)).metadata()).hasAlpha).toBe(false);
    const webp = await sharpEngine.convert({
      input: path.join(fixtures, 'sample-animated.gif'),
      inputExt: 'gif',
      outputExt: 'webp',
      options: {},
      workDir,
    });
    expect((await sharp(String(webp)).metadata()).pages).toBe(2);
  });

  it('removes EXIF by default', async () => {
    const withExif = path.join(workDir, 'exif.jpg');
    await sharp(path.join(fixtures, 'sample.jpg'))
      .withExif({ IFD0: { ImageDescription: 'GPS secret' } })
      .toFile(withExif);
    expect((await sharp(withExif).metadata()).exif).toBeDefined();
    const out = await sharpEngine.convert({
      input: withExif,
      inputExt: 'jpg',
      outputExt: 'webp',
      options: {},
      workDir,
    });
    expect((await sharp(String(out)).metadata()).exif).toBeUndefined();
  });

  it('reports broken files with a translatable error', async () => {
    const broken = path.join(workDir, 'broken.png');
    await import('node:fs/promises').then((fs) => fs.writeFile(broken, 'not an image'));
    await expect(
      sharpEngine.convert({
        input: broken,
        inputExt: 'png',
        outputExt: 'webp',
        options: {},
        workDir,
      }),
    ).rejects.toBeInstanceOf(ConversionError);
  });

  it('respects an aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      sharpEngine.convert({
        input: path.join(fixtures, 'sample.png'),
        inputExt: 'png',
        outputExt: 'webp',
        options: {},
        workDir,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('ImageMagick', () => {
  it('parses `magick -list format`', () => {
    const sample = [
      '   Format  Module    Mode  Description',
      '-------------------------------------------------------------------------------',
      '      BMP* BMP       rw-   Microsoft Windows bitmap image',
      '     HEIC  HEIC      r--   High Efficiency Image Format (1.17.6)',
      '     JPEG* JPEG      rw-   Joint Photographic Experts Group JFIF format',
      '      MVG  DRAW      ---   Magick Vector Graphics',
    ].join('\n');
    const modes = parseFormatList(sample);
    expect(modes.get('BMP')).toBe('rw-');
    expect(modes.get('HEIC')).toBe('r--');
    expect(modes.get('MVG')).toBe('---');
  });

  it('builds safe arguments with explicit coders', () => {
    const args = buildArgs(
      '/data/up/abc',
      'psd',
      '/data/tmp/j/out.jpg',
      'jpg',
      { quality: 70 },
      {
        input: 'PSD',
        output: 'JPEG',
      },
    );
    expect(args).toContain('PSD:/data/up/abc[0]');
    expect(args.at(-1)).toBe('JPEG:/data/tmp/j/out.jpg');
    expect(args).toEqual(
      expect.arrayContaining(['-quality', '70', '-alpha', 'remove', '+profile', '!icc,*']),
    );
  });

  it('limits icons to 256 px and uses PNG8 for palette PNGs', () => {
    const ico = buildArgs('/in', 'png', '/out.ico', 'ico', {}, { input: 'PNG', output: 'ICO' });
    expect(ico).toEqual(expect.arrayContaining(['-resize', '256x256>']));
    const png8 = buildArgs(
      '/in',
      'bmp',
      '/out.png',
      'png',
      { pngPalette: true },
      { input: 'BMP', output: 'PNG' },
    );
    expect(png8.at(-1)).toBe('PNG8:/out.png');
  });

  it('keeps all metadata when asked', () => {
    const args = buildArgs(
      '/in',
      'png',
      '/out.bmp',
      'bmp',
      { stripMetadata: false },
      { input: 'PNG', output: 'BMP' },
    );
    expect(args).not.toContain('+profile');
  });

  const installed = hasCommand('magick');
  it.skipIf(!installed)('converts PNG → BMP → PNG for real', async () => {
    const bmp = await imagemagickEngine.convert({
      input: path.join(fixtures, 'sample.png'),
      inputExt: 'png',
      outputExt: 'bmp',
      options: {},
      workDir,
    });
    expect(readFileSync(String(bmp)).subarray(0, 2).toString('ascii')).toBe('BM');
    const png = await imagemagickEngine.convert({
      input: String(bmp),
      inputExt: 'bmp',
      outputExt: 'png',
      options: {},
      workDir,
    });
    expect((await sharp(String(png)).metadata()).format).toBe('png');
  });

  it.skipIf(installed)('reports an error status when `magick` is missing', () => {
    expect(imagemagickEngine.status()).toBe('error');
    expect(imagemagickEngine.formats).toEqual([]);
  });
});
