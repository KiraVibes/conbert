import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { WebIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { describe, expect, it } from 'vitest';
import { resolveGltfSettings } from '../options/model';
import { optimizeGltf } from './optimize';

const require = createRequire(import.meta.url);
const glb = new Uint8Array(
  readFileSync(
    path.resolve(import.meta.dirname, '../../../../apps/server/src/__fixtures__/sample.glb'),
  ),
);

async function inspect(data: Uint8Array, ext: string) {
  await MeshoptDecoder.ready;
  const draco = require('draco3dgltf') as { createDecoderModule(): Promise<unknown> };
  const io = new WebIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'meshopt.decoder': MeshoptDecoder,
    'draco3d.decoder': await draco.createDecoderModule(),
  });
  const doc =
    ext === 'glb'
      ? await io.readBinary(data)
      : await io.readJSON({ json: JSON.parse(new TextDecoder().decode(data)), resources: {} });
  const root = doc.getRoot();
  return {
    extensions: root.listExtensionsUsed().map((e) => e.extensionName),
    meshes: root.listMeshes().length,
  };
}

describe('optimizeGltf', () => {
  it('compresses meshes with Meshopt (works everywhere)', async () => {
    const out = await optimizeGltf(
      glb,
      'glb',
      'glb',
      resolveGltfSettings({ meshCompression: 'meshopt' }),
      {},
    );
    const info = await inspect(out, 'glb');
    expect(info.meshes).toBe(1);
    expect(info.extensions).toContain('EXT_meshopt_compression');
  });

  it('writes a single self-contained .gltf file', async () => {
    const out = await optimizeGltf(
      glb,
      'glb',
      'gltf',
      resolveGltfSettings({ meshCompression: 'none' }),
      {},
    );
    const json = JSON.parse(new TextDecoder().decode(out)) as { buffers: { uri: string }[] };
    expect(json.buffers[0]?.uri).toMatch(/^data:application\/octet-stream;base64,/);
    expect((await inspect(out, 'gltf')).meshes).toBe(1);
  });

  it('asks for the server when Draco is not available here', async () => {
    await expect(
      optimizeGltf(glb, 'glb', 'glb', resolveGltfSettings({ meshCompression: 'draco' }), {}),
    ).rejects.toMatchObject({ messageKey: 'errors.formatUnavailable' });
  });

  it('uses Draco when the modules are given (server)', async () => {
    const draco = require('draco3dgltf') as {
      createEncoderModule(): Promise<unknown>;
      createDecoderModule(): Promise<unknown>;
    };
    const out = await optimizeGltf(
      glb,
      'glb',
      'glb',
      resolveGltfSettings({ meshCompression: 'draco' }),
      {
        draco: {
          encoder: await draco.createEncoderModule(),
          decoder: await draco.createDecoderModule(),
        },
      },
    );
    expect((await inspect(out, 'glb')).extensions).toContain('KHR_draco_mesh_compression');
  });
});
