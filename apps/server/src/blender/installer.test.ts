import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BLENDER_VERSION, BlenderInstaller, type Extractor } from './installer';

const payload = Buffer.from('pretend this is blender.tar.xz');
const download = {
  id: 'blender',
  file: 'blender-test.tar.xz',
  bytes: payload.length,
  sha256: createHash('sha256').update(payload).digest('hex'),
  url: 'https://example.invalid/blender.tar.xz',
};
const okFetch = (async () => new Response(payload)) as unknown as typeof fetch;
const fakeExtract: Extractor = async (_archive, into) => {
  await writeFile(path.join(into, 'blender'), '#!/bin/sh\n');
};
const plenty = async () => 100 * 1024 ** 3;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'conbert-blender-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const make = (options: Partial<ConstructorParameters<typeof BlenderInstaller>[1]> = {}) =>
  new BlenderInstaller(dir, {
    download,
    fetchImpl: okFetch,
    extract: fakeExtract,
    platform: 'linux',
    arch: 'x64',
    freeBytes: plenty,
    ...options,
  });

describe('BlenderInstaller', () => {
  it('downloads, unpacks, removes the archive and reports it installed', async () => {
    const installer = make();
    let changes = 0;
    installer.onChange(() => changes++);
    expect((await installer.status()).installed).toBe(false);
    await installer.install();
    const status = await installer.status();
    expect(status).toMatchObject({ installed: true, phase: 'idle', errorKey: null });
    expect(installer.binary()).toBe(path.join(dir, BLENDER_VERSION, 'blender'));
    expect(existsSync(path.join(dir, 'download', download.file))).toBe(false);
    expect(changes).toBe(1);
  });

  it('removes older versions after an update', async () => {
    await mkdir(path.join(dir, '4.2.0'), { recursive: true });
    await make().install();
    expect(existsSync(path.join(dir, '4.2.0'))).toBe(false);
  });

  it('refuses ARM and other systems without an official build', async () => {
    const installer = make({ arch: 'arm64' });
    expect(installer.supported()).toBe(false);
    await installer.install();
    expect(await installer.status()).toMatchObject({
      supported: false,
      installed: false,
      errorKey: 'errors.blenderUnsupported',
    });
  });

  it('stops before downloading when the disk is too full', async () => {
    let fetched = false;
    const installer = make({
      freeBytes: async () => 10 * 1024 ** 2,
      fetchImpl: (async () => {
        fetched = true;
        return new Response(payload);
      }) as unknown as typeof fetch,
    });
    await installer.install();
    expect(fetched).toBe(false);
    expect((await installer.status()).errorKey).toBe('errors.blenderNoSpace');
  });

  it('keeps nothing when the checksum does not match', async () => {
    const installer = make({
      fetchImpl: (async () =>
        new Response(Buffer.from('x'.repeat(payload.length)))) as unknown as typeof fetch,
    });
    await expect(installer.install()).rejects.toThrow();
    const status = await installer.status();
    expect(status).toMatchObject({ installed: false, errorKey: 'errors.blenderDownload' });
    expect(existsSync(path.join(dir, `${BLENDER_VERSION}.part`))).toBe(false);
  });

  it('can be removed again', async () => {
    const installer = make();
    await installer.install();
    await installer.remove();
    expect((await installer.status()).installed).toBe(false);
  });
});
