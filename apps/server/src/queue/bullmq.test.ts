import { randomUUID } from 'node:crypto';
import { connect } from 'node:net';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pino from 'pino';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { JobDto } from '@conbert/schemas';
import { sharpEngine } from '../engines/sharp';
import { setupAdmin, testApp, tusUpload } from '../test/helpers';
import { createBullQueue } from './job-queue';

/** Runs only when a Valkey/Redis is reachable (docker-compose.dev.yml). */
const REDIS_URL = process.env['CONBERT_TEST_REDIS_URL'] ?? 'redis://127.0.0.1:6379';

async function reachable(url: string): Promise<boolean> {
  const { hostname, port } = new URL(url);
  return new Promise((resolve) => {
    const socket = connect({ host: hostname, port: Number(port || 6379) });
    socket.setTimeout(500);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

const available = await reachable(REDIS_URL);
let app: FastifyInstance | undefined;
let dataDir = '';
afterAll(async () => {
  await app?.close();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

describe.skipIf(!available)('BullMQ queue on Valkey', () => {
  it('runs a conversion through the real queue', async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), 'conbert-bull-'));
    await sharpEngine.init();
    app = await testApp(
      { CONBERT_DATA_DIR: dataDir },
      {
        engines: [sharpEngine],
        queue: (runner) =>
          createBullQueue(REDIS_URL, runner, 1, pino({ level: 'silent' }), `test-${randomUUID()}`),
      },
    );
    const cookie = await setupAdmin(app);
    await vi.waitFor(() => expect(app?.conbert.jobs.queue.isHealthy()).toBe(true), {
      timeout: 5000,
    });
    const png = readFileSync(path.join(import.meta.dirname, '../__fixtures__/sample.png'));
    const fileId = await tusUpload(app, cookie, png, 'queue.png');
    const res = await app.inject({
      method: 'POST',
      url: '/api/jobs',
      headers: { cookie },
      payload: { fileId, outputExt: 'jpg' },
    });
    expect(res.statusCode).toBe(201);
    const id = (res.json() as { job: JobDto }).job.id;
    await vi.waitFor(
      async () => {
        const job = (
          await app?.inject({ url: `/api/jobs/${id}`, headers: { cookie } })
        )?.json() as {
          job: JobDto;
        };
        expect(job.job.status).toBe('done');
      },
      { timeout: 15_000, interval: 100 },
    );
  }, 30_000);
});

describe.skipIf(!available)('BullMQ: going on later', () => {
  it('lets a running job queue itself again (night window, waiting after 429)', async () => {
    const runs: string[] = [];
    const queue: ReturnType<typeof createBullQueue> = createBullQueue(
      REDIS_URL,
      {
        async run(id) {
          runs.push(id);
          // The first run wants to go on a moment later – under its own id.
          if (runs.length === 1) await queue.enqueue(id, 200);
        },
      },
      1,
      pino({ level: 'silent' }),
      `conbert-test-again-${randomUUID()}`,
    );
    try {
      await queue.enqueue('crawl-1');
      await vi.waitFor(() => expect(runs).toEqual(['crawl-1', 'crawl-1']), {
        timeout: 5_000,
        interval: 50,
      });
      // A waiting follow-up is removed like the job itself.
      await queue.enqueue('crawl-2', 60_000);
      expect(await queue.removeWaiting('crawl-2')).toBe(true);
      expect(await queue.removeWaiting('crawl-2')).toBe(false);
    } finally {
      await queue.close();
    }
  });
});
