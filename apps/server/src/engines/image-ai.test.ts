import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IMAGE_AI_MODELS, imageTiles } from '@conbert/core';
import { ModelStore } from '../models/model-store';
import { configureImageAi, imageAiEngine } from './image-ai';

/** Folder with the downloaded models (test image / developer machine), else those tests skip. */
const modelDir = process.env['CONBERT_TEST_IMAGE_MODELS'] ?? '';
const has = (id: string) =>
  modelDir !== '' &&
  existsSync(path.join(modelDir, IMAGE_AI_MODELS.find((m) => m.id === id)?.file ?? '-'));

/** A photo-like picture (smooth colour changes). */
function photo(width: number, height: number) {
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      pixels[i] = 128 + 100 * Math.sin(x / 9 + Math.cos(y / 13));
      pixels[i + 1] = 128 + 90 * Math.cos(y / 7 + x / 23);
      pixels[i + 2] = 128 + 80 * Math.sin(x / 17 - y / 11);
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } });
}

describe('tiles', () => {
  it('cover the picture once, with a margin for the model', () => {
    const tiles = imageTiles(400, 250, 192, 12);
    expect(tiles).toHaveLength(6);
    expect(tiles.reduce((sum, t) => sum + t.width * t.height, 0)).toBe(400 * 250);
    expect(tiles[0]).toMatchObject({ x: 0, y: 0, inX: 0, inY: 0, inWidth: 204, inHeight: 204 });
    expect(tiles[4]).toMatchObject({
      x: 192,
      y: 192,
      inX: 180,
      inY: 180,
      inWidth: 216,
      inHeight: 70,
    });
  });
});

describe('image AI (real ONNX Runtime)', () => {
  let dir: string;
  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'conbert-image-ai-'));
    // Downloads are not allowed here: the models are on disk or the tests skip.
    configureImageAi(new ModelStore(modelDir || dir, 'http://127.0.0.1:9/', IMAGE_AI_MODELS));
    await imageAiEngine.init();
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const run = async (input: string, options: Record<string, unknown>, job: string) =>
    String(
      await imageAiEngine.convert({
        input,
        inputExt: 'png',
        outputExt: 'png',
        options,
        workDir: path.join(dir, job),
      }),
    );

  it('refuses pictures that would get too big', async () => {
    const big = path.join(dir, 'big.png');
    await sharp({ create: { width: 5000, height: 4000, channels: 3, background: 'gray' } })
      .png()
      .toFile(big);
    await expect(run(big, { upscale: 4 }, 'big')).rejects.toMatchObject({
      messageKey: 'errors.imageTooLargeToUpscale',
    });
  });

  it.skipIf(!has('realesr-general-x4v3'))(
    'upscales by 2 and 4 and keeps the picture',
    async () => {
      const input = path.join(dir, 'photo.png');
      await photo(260, 200).png().toFile(input);
      const two = await sharp(await run(input, { upscale: 2 }, 'x2')).metadata();
      expect([two.width, two.height]).toEqual([520, 400]);
      const four = await run(input, { upscale: 4 }, 'x4');
      expect((await sharp(four).metadata()).width).toBe(1040);
      // Shrunk back, it looks like the original (no tile seams, right colours).
      const back = await sharp(four).removeAlpha().resize(260, 200).raw().toBuffer();
      const original = await sharp(input).removeAlpha().raw().toBuffer();
      let diff = 0;
      for (let i = 0; i < original.length; i++)
        diff += Math.abs((back[i] ?? 0) - (original[i] ?? 0));
      expect(diff / original.length).toBeLessThan(12);
    },
    120_000,
  );

  it.skipIf(!has('isnet'))(
    'removes a plain background around the subject',
    async () => {
      const input = path.join(dir, 'subject.png');
      await sharp(
        Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">' +
            '<rect width="400" height="300" fill="#f4f4f4"/>' +
            '<circle cx="200" cy="150" r="90" fill="#c0392b"/></svg>',
        ),
      )
        .png()
        .toFile(input);
      const out = await run(input, { removeBackground: true }, 'bg');
      const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
      const alphaAt = (x: number, y: number) => data[(y * info.width + x) * 4 + 3] ?? 0;
      expect(info.channels).toBe(4);
      expect(alphaAt(10, 10)).toBeLessThan(40);
      expect(alphaAt(390, 290)).toBeLessThan(40);
      expect(alphaAt(200, 150)).toBeGreaterThan(215);

      if (!has('realesr-general-x4v3')) return;
      // Both at once: the transparency grows with the picture.
      const both = await run(input, { removeBackground: true, upscale: 2 }, 'both');
      const big = await sharp(both).raw().toBuffer({ resolveWithObject: true });
      expect([big.info.width, big.info.height, big.info.channels]).toEqual([800, 600, 4]);
      const bigAlpha = (x: number, y: number) => big.data[(y * 800 + x) * 4 + 3] ?? 0;
      expect(bigAlpha(20, 20)).toBeLessThan(40);
      expect(bigAlpha(400, 300)).toBeGreaterThan(215);
    },
    120_000,
  );
});
