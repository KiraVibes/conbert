import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildOfflineManifest } from '../../scripts/offline-manifest';

describe('offline manifest', () => {
  let dir = '';
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('lists every build file with a hash, but not the worker or source maps', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'conbert-offline-'));
    mkdirSync(path.join(dir, 'assets'));
    mkdirSync(path.join(dir, 'wasm'));
    writeFileSync(path.join(dir, 'index.html'), '<html></html>');
    writeFileSync(path.join(dir, 'sw.js'), 'worker');
    writeFileSync(path.join(dir, 'assets', 'app-1.js'), 'code');
    writeFileSync(path.join(dir, 'assets', 'app-1.js.map'), '{}');
    writeFileSync(path.join(dir, 'wasm', 'vips.wasm'), 'wasm');

    const manifest = buildOfflineManifest(dir);
    expect(manifest.files.map((f) => f.url)).toEqual([
      '/assets/app-1.js',
      '/index.html',
      '/wasm/vips.wasm',
    ]);
    expect(manifest.files[2]).toMatchObject({
      size: 4,
      hash: expect.stringMatching(/^[0-9a-f]{16}$/),
    });

    // Changing one file changes its hash and the version, the others stay.
    const before = manifest;
    writeFileSync(path.join(dir, 'wasm', 'vips.wasm'), 'wasm2');
    const after = buildOfflineManifest(dir);
    expect(after.version).not.toBe(before.version);
    expect(after.files[0]?.hash).toBe(before.files[0]?.hash);
    expect(after.files[2]?.hash).not.toBe(before.files[2]?.hash);
  });
});
