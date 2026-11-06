import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { engineI18nKeys, getFormat } from '@conbert/core';
import { findMissingKeys } from '@conbert/i18n';
import type { BlenderInstaller } from '../blender/installer';
import { BLENDER_READ, BLENDER_WRITE, blenderEngine, configureBlender } from './blender';

/**
 * Real conversions only run where Blender is available: set
 * CONBERT_TEST_BLENDER to the blender program (e.g. in the test image after
 * unpacking the official build).
 */
const binary = process.env['CONBERT_TEST_BLENDER'];
const fixtures = path.join(import.meta.dirname, '../__fixtures__');

function fakeInstaller(installed: boolean): BlenderInstaller {
  return {
    installed: async () => installed,
    binary: () => binary ?? '/nonexistent/blender',
    onChange: () => undefined,
  } as unknown as BlenderInstaller;
}

describe('blender engine definition', () => {
  it('has texts and registry entries for every format', () => {
    expect(findMissingKeys(engineI18nKeys(blenderEngine))).toEqual([]);
    for (const ext of [...BLENDER_READ, ...BLENDER_WRITE]) {
      expect(getFormat(ext), ext).toBeDefined();
      for (const key of ['name', 'summary', 'goodFor']) {
        expect(findMissingKeys([`formats.${ext}.${key}`]), ext).toEqual([]);
      }
    }
  });

  it('offers no formats until Blender is installed', async () => {
    configureBlender(fakeInstaller(false));
    await blenderEngine.init();
    expect(blenderEngine.status()).toBe('uninitialized');
    expect(blenderEngine.formats).toEqual([]);
    configureBlender(fakeInstaller(true));
    await blenderEngine.init();
    expect(blenderEngine.status()).toBe('ready');
    expect(blenderEngine.formats.find((f) => f.ext === 'blend')).toMatchObject({
      canRead: true,
      canWrite: true,
    });
  });
});

describe.skipIf(!binary)('blender (real program)', () => {
  let workDir: string;
  beforeAll(async () => {
    workDir = mkdtempSync(path.join(os.tmpdir(), 'conbert-blender-'));
    configureBlender(fakeInstaller(true));
    await blenderEngine.init();
  });
  afterAll(() => rmSync(workDir, { recursive: true, force: true }));

  const convert = (input: string, inputExt: string, outputExt: string) =>
    blenderEngine.convert({ input, inputExt, outputExt, options: {}, workDir }) as Promise<string>;

  it('turns a GLB into a .blend and back', async () => {
    const blend = await convert(path.join(fixtures, 'sample.glb'), 'glb', 'blend');
    const glb = await convert(blend, 'blend', 'glb');
    expect(readFileSync(glb).subarray(0, 4).toString('ascii')).toBe('glTF');
  }, 120_000);

  it('writes and reads USDZ and Alembic', async () => {
    const usdz = await convert(path.join(fixtures, 'sample.glb'), 'glb', 'usdz');
    expect(readFileSync(usdz).subarray(0, 2).toString('ascii')).toBe('PK');
    const abc = await convert(usdz, 'usdz', 'abc');
    const obj = await convert(abc, 'abc', 'obj');
    expect(readFileSync(obj, 'utf8')).toMatch(/^v /m);
  }, 180_000);
});
