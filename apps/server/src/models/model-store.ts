import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { ConversionError, abortError, type ModelFile } from '@conbert/core';

export interface ModelStatus {
  id: string;
  bytes: number;
  installed: boolean;
  /** Bytes received while a download runs, else null. */
  downloading: number | null;
}

/**
 * AI models (Whisper, background removal, upscaling) live in the data
 * folder, not in the image. A model is downloaded once, on first use (or when
 * the admin asks), and only kept when its size and SHA-256 match.
 */
export class ModelStore {
  private readonly running = new Map<string, Promise<string>>();
  private readonly received = new Map<string, number>();

  constructor(
    private readonly dir: string,
    private readonly baseUrl: string,
    /** The known models (tests use small fake ones). */
    private readonly catalog: readonly ModelFile[],
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private find(id: string): ModelFile {
    const model = this.catalog.find((m) => m.id === id);
    if (!model) throw new ConversionError('errors.modelUnknown', id);
    return model;
  }

  path(model: ModelFile): string {
    return path.join(this.dir, model.file);
  }

  async installed(model: ModelFile): Promise<boolean> {
    try {
      return (await stat(this.path(model))).size === model.bytes;
    } catch {
      return false;
    }
  }

  async status(): Promise<ModelStatus[]> {
    return Promise.all(
      this.catalog.map(async (m) => ({
        id: m.id,
        bytes: m.bytes,
        installed: await this.installed(m),
        downloading: this.running.has(m.id) ? (this.received.get(m.id) ?? 0) : null,
      })),
    );
  }

  /**
   * The model's path, downloading it first if needed. Several jobs share one
   * download; a job that is cancelled stops waiting, the download goes on.
   */
  async ensure(
    id: string,
    onProgress?: (received: number, total: number) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    const model = this.find(id);
    if (await this.installed(model)) return this.path(model);
    let download = this.running.get(model.id);
    if (!download) {
      download = this.download(model).finally(() => {
        this.running.delete(model.id);
        this.received.delete(model.id);
      });
      this.running.set(model.id, download);
    }
    const timer = onProgress
      ? setInterval(() => onProgress(this.received.get(model.id) ?? 0, model.bytes), 500)
      : null;
    try {
      if (!signal) return await download;
      return await Promise.race([
        download,
        new Promise<never>((_, reject) => {
          if (signal.aborted) reject(abortError());
          signal.addEventListener('abort', () => reject(abortError()), { once: true });
        }),
      ]);
    } finally {
      if (timer) clearInterval(timer);
    }
  }

  /** Starts a download in the background (admin "download now"). */
  start(id: string): void {
    void this.ensure(id).catch(() => undefined);
  }

  async remove(id: string): Promise<void> {
    await rm(this.path(this.find(id)), { force: true });
  }

  private async download(model: ModelFile): Promise<string> {
    await mkdir(this.dir, { recursive: true });
    const target = this.path(model);
    const part = `${target}.part`;
    const url = model.url ?? new URL(model.file, this.baseUrl).toString();
    try {
      const response = await this.fetchImpl(url, { redirect: 'follow' });
      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status} for ${url}`);
      }
      const hash = createHash('sha256');
      let received = 0;
      const body = Readable.fromWeb(response.body as WebReadableStream);
      body.on('data', (chunk: Buffer) => {
        received += chunk.length;
        this.received.set(model.id, received);
        hash.update(chunk);
        // Never write more than the model can be (a wrong file would fill the disk).
        if (received > model.bytes) body.destroy(new Error('file is larger than expected'));
      });
      await pipeline(body, createWriteStream(part));
      const digest = hash.digest('hex');
      if (received !== model.bytes || digest !== model.sha256) {
        throw new Error(`checksum mismatch (${received} bytes, sha256 ${digest})`);
      }
      await rename(part, target);
      return target;
    } catch (error) {
      await rm(part, { force: true });
      throw new ConversionError(
        'errors.modelDownload',
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}
