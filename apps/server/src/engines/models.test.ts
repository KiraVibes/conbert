import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compressionOptions, engineI18nKeys, getFormat } from '@conbert/core';
import { findMissingKeys } from '@conbert/i18n';
import { hasCommand } from '../test/helpers';
import { assimpEngine } from './assimp';
import { gltfTransformServerEngine } from './gltf-transform';

const fixtures = path.join(import.meta.dirname, '../__fixtures__');
let workDir: string;
beforeAll(() => {
  workDir = mkdtempSync(path.join(os.tmpdir(), 'conbert-3d-'));
});
afterAll(() => rmSync(workDir, { recursive: true, force: true }));

const glbMagic = (file: string) => readFileSync(file).subarray(0, 4).toString('ascii');

describe('3D engine definitions', () => {
  it('have texts and registry entries', () => {
    for (const engine of [assimpEngine, gltfTransformServerEngine]) {
      expect(findMissingKeys(engineI18nKeys(engine))).toEqual([]);
      for (const f of engine.formats) expect(getFormat(f.ext), f.ext).toBeDefined();
    }
  });
});

describe('gltf-transform (server)', () => {
  beforeAll(() => gltfTransformServerEngine.init());

  it('compresses a GLB with Draco at "smallest"', async () => {
    const output = (await gltfTransformServerEngine.convert({
      input: path.join(fixtures, 'sample.glb'),
      inputExt: 'glb',
      outputExt: 'glb',
      options: compressionOptions('glb', { level: 'small', stripMetadata: true }),
      workDir,
    })) as string;
    expect(glbMagic(output)).toBe('glTF');
    expect(readFileSync(output).toString('latin1')).toContain('KHR_draco_mesh_compression');
  });

  it('turns a GLB into one self-contained .gltf file', async () => {
    const output = (await gltfTransformServerEngine.convert({
      input: path.join(fixtures, 'sample.glb'),
      inputExt: 'glb',
      outputExt: 'gltf',
      options: {},
      workDir,
    })) as string;
    const json = JSON.parse(readFileSync(output, 'utf8')) as { buffers: { uri: string }[] };
    expect(json.buffers[0]?.uri.startsWith('data:')).toBe(true);
  });
});

describe.skipIf(!hasCommand('assimp', ['version']))('assimp (real)', () => {
  beforeAll(() => assimpEngine.init());

  it.each([
    ['obj', 'glb'],
    ['fbx', 'obj'],
    ['dae', 'stl'],
    ['3ds', 'ply'],
    ['x3d', '3mf'],
    ['stl', 'gltf'],
  ])('converts %s → %s', async (from, to) => {
    const output = (await assimpEngine.convert({
      input: path.join(fixtures, `sample.${from}`),
      inputExt: from,
      outputExt: to,
      options: {},
      workDir,
    })) as string;
    expect(path.extname(output)).toBe(`.${to}`);
    const bytes = readFileSync(output);
    expect(bytes.length).toBeGreaterThan(50);
    if (to === 'glb') expect(glbMagic(output)).toBe('glTF');
    if (to === 'gltf') expect(JSON.parse(bytes.toString('utf8')).asset.version).toBe('2.0');
    if (to === 'obj') expect(bytes.toString('utf8')).toMatch(/^v /m);
    if (to === '3mf') expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK');
  });

  it('reports a broken file as a conversion error', async () => {
    await expect(
      assimpEngine.convert({
        input: path.join(fixtures, 'sample.png'),
        inputExt: 'fbx',
        outputExt: 'glb',
        options: {},
        workDir,
      }),
    ).rejects.toMatchObject({ messageKey: 'errors.convertFailed' });
  });
});
