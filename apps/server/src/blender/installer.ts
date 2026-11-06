import { mkdir, readdir, rename, rm, stat, statfs } from 'node:fs/promises';
import path from 'node:path';
import type { ModelFile } from '@conbert/core';
import type { BlenderStatus } from '@conbert/schemas';
import { ModelStore } from '../models/model-store';
import { runProcess } from '../lib/run-process';

/** Blender LTS release the admin can install (official build, checksum pinned). */
export const BLENDER_VERSION = '4.5.15';
export const BLENDER_DOWNLOAD: ModelFile = {
  id: 'blender',
  file: `blender-${BLENDER_VERSION}-linux-x64.tar.xz`,
  bytes: 378_036_492,
  sha256: '0d2b8bb2efe97e6c8eb57de6b7322f8800e1984e3125b60decca5f6771e4773e',
  url: `https://download.blender.org/release/Blender4.5/blender-${BLENDER_VERSION}-linux-x64.tar.xz`,
};
/** About the size once unpacked (measured: 1.2 GB). */
export const BLENDER_INSTALLED_BYTES = 1_300_000_000;
const EXTRACT_TIMEOUT_MS = 20 * 60 * 1000;

export type Extractor = (archive: string, into: string) => Promise<void>;

/** Unpacks the official tar.xz (needs xz-utils, which the image has). */
const tarExtract: Extractor = async (archive, into) => {
  await runProcess('tar', ['-xJf', archive, '-C', into, '--strip-components=1'], {
    timeoutMs: EXTRACT_TIMEOUT_MS,
  });
};

/**
 * Blender is too big for the image (~1.2 GB), so the admin installs it on
 * demand into the data folder: download (size + SHA-256 checked), unpack,
 * then the engine finds it. It survives container updates.
 */
export class BlenderInstaller {
  private readonly store: ModelStore;
  private running: Promise<void> | null = null;
  private phase: BlenderStatus['phase'] = 'idle';
  private errorKey: string | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly dir: string,
    private readonly options: {
      download?: ModelFile;
      fetchImpl?: typeof fetch;
      extract?: Extractor;
      platform?: string;
      arch?: string;
      freeBytes?: (dir: string) => Promise<number>;
    } = {},
  ) {
    this.store = new ModelStore(
      path.join(dir, 'download'),
      '',
      [this.download],
      options.fetchImpl ?? fetch,
    );
  }

  private get download(): ModelFile {
    return this.options.download ?? BLENDER_DOWNLOAD;
  }

  private get installDir(): string {
    return path.join(this.dir, BLENDER_VERSION);
  }

  /** Path of the blender program (whether installed or not). */
  binary(): string {
    return path.join(this.installDir, 'blender');
  }

  supported(): boolean {
    return (
      (this.options.platform ?? process.platform) === 'linux' &&
      (this.options.arch ?? process.arch) === 'x64'
    );
  }

  async installed(): Promise<boolean> {
    try {
      return (await stat(this.binary())).isFile();
    } catch {
      return false;
    }
  }

  /** Called after an install or removal (the engine refreshes its formats). */
  onChange(listener: () => void): void {
    this.listeners.add(listener);
  }

  async status(): Promise<BlenderStatus> {
    const download = (await this.store.status())[0];
    return {
      supported: this.supported(),
      version: BLENDER_VERSION,
      installed: await this.installed(),
      phase: this.phase,
      received: this.phase === 'downloading' ? (download?.downloading ?? 0) : null,
      downloadBytes: this.download.bytes,
      installedBytes: BLENDER_INSTALLED_BYTES,
      errorKey: this.errorKey,
    };
  }

  /** Starts the installation in the background; a running one is reused. */
  install(): Promise<void> {
    if (!this.running) {
      this.running = this.run().finally(() => {
        this.running = null;
        this.phase = 'idle';
      });
    }
    return this.running;
  }

  private async run(): Promise<void> {
    this.errorKey = null;
    if (!this.supported()) {
      this.errorKey = 'errors.blenderUnsupported';
      return;
    }
    if (await this.installed()) return;
    try {
      await mkdir(this.dir, { recursive: true });
      const free = await (this.options.freeBytes ?? freeSpace)(this.dir);
      if (free < this.download.bytes + BLENDER_INSTALLED_BYTES) {
        this.errorKey = 'errors.blenderNoSpace';
        return;
      }
      this.phase = 'downloading';
      const archive = await this.store.ensure(this.download.id);
      this.phase = 'extracting';
      const part = `${this.installDir}.part`;
      await rm(part, { recursive: true, force: true });
      await mkdir(part, { recursive: true });
      await (this.options.extract ?? tarExtract)(archive, part);
      await rm(this.installDir, { recursive: true, force: true });
      await rename(part, this.installDir);
      await this.store.remove(this.download.id);
      await this.removeOtherVersions();
      if (!(await this.installed())) this.errorKey = 'errors.blenderInstall';
    } catch (error) {
      await rm(`${this.installDir}.part`, { recursive: true, force: true });
      const key = (error as { messageKey?: unknown }).messageKey;
      this.errorKey =
        key === 'errors.modelDownload' ? 'errors.blenderDownload' : 'errors.blenderInstall';
      throw error;
    } finally {
      this.listeners.forEach((l) => l());
    }
  }

  isRunning(): boolean {
    return this.running !== null;
  }

  async remove(): Promise<void> {
    await rm(this.installDir, { recursive: true, force: true });
    await this.store.remove(this.download.id);
    this.errorKey = null;
    this.listeners.forEach((l) => l());
  }

  /** Older releases left behind by an update of Conbert. */
  private async removeOtherVersions(): Promise<void> {
    for (const entry of await readdir(this.dir, { withFileTypes: true })) {
      if (
        entry.isDirectory() &&
        /^\d+\.\d+\.\d+$/.test(entry.name) &&
        entry.name !== BLENDER_VERSION
      ) {
        await rm(path.join(this.dir, entry.name), { recursive: true, force: true });
      }
    }
  }
}

async function freeSpace(dir: string): Promise<number> {
  const info = await statfs(dir);
  return info.bavail * info.bsize;
}
