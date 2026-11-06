import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ModelStore } from './model-store';

const content = Buffer.from('ggml fake model '.repeat(4096));
const sha256 = createHash('sha256').update(content).digest('hex');
const catalog = [
  { id: 'good', file: 'good.bin', bytes: content.length, sha256 },
  { id: 'bad', file: 'bad.bin', bytes: content.length, sha256: '0'.repeat(64) },
  { id: 'missing', file: 'missing.bin', bytes: 10, sha256: '0'.repeat(64) },
];

let server: Server;
let baseUrl: string;
let requests = 0;
let dir: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    requests++;
    if (req.url === '/models/missing.bin') {
      res.statusCode = 404;
      res.end();
      return;
    }
    // Slow enough that two jobs overlap.
    setTimeout(() => res.end(content), 50);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/models/`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => {
  requests = 0;
  dir = mkdtempSync(path.join(os.tmpdir(), 'conbert-whisper-models-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('Whisper models', () => {
  it('downloads a model once, even for several jobs at the same time', async () => {
    const models = new ModelStore(dir, baseUrl, catalog);
    expect((await models.status())[0]).toMatchObject({ id: 'good', installed: false });
    const progress: number[] = [];
    const [a, b] = await Promise.all([
      models.ensure('good', (received) => progress.push(received)),
      models.ensure('good'),
    ]);
    expect(a).toBe(path.join(dir, 'good.bin'));
    expect(b).toBe(a);
    expect(requests).toBe(1);
    expect((await models.status())[0]).toMatchObject({ installed: true, downloading: null });

    // Already there: no new download.
    await models.ensure('good');
    expect(requests).toBe(1);

    await models.remove('good');
    expect(existsSync(a)).toBe(false);
  });

  it('throws away files whose checksum is wrong', async () => {
    const models = new ModelStore(dir, baseUrl, catalog);
    await expect(models.ensure('bad')).rejects.toMatchObject({
      messageKey: 'errors.modelDownload',
      details: expect.stringContaining('checksum'),
    });
    expect(existsSync(path.join(dir, 'bad.bin'))).toBe(false);
    expect(existsSync(path.join(dir, 'bad.bin.part'))).toBe(false);
  });

  it('explains failed downloads and unknown models', async () => {
    const models = new ModelStore(dir, baseUrl, catalog);
    await expect(models.ensure('missing')).rejects.toMatchObject({
      messageKey: 'errors.modelDownload',
      details: expect.stringContaining('404'),
    });
    await expect(models.ensure('nope')).rejects.toMatchObject({
      messageKey: 'errors.modelUnknown',
    });
  });

  it('lets a cancelled job stop waiting while the download goes on', async () => {
    const models = new ModelStore(dir, baseUrl, catalog);
    const controller = new AbortController();
    const waiting = models.ensure('good', undefined, controller.signal);
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
    await models.ensure('good');
    expect(requests).toBe(1);
  });
});
