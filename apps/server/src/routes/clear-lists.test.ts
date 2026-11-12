import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { booruJobs, downloads } from '../db/schema';
import { setupAdmin, testApp } from '../test/helpers';

let app: FastifyInstance;
let dataDir: string;
let admin: string;

beforeEach(async () => {
  dataDir = mkdtempSync(path.join(os.tmpdir(), 'conbert-clear-'));
  app = await testApp({ CONBERT_DATA_DIR: dataDir });
  admin = await setupAdmin(app);
});
afterEach(async () => {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const adminId = () =>
  (app.conbert.db.$client.prepare('select id from users').get() as { id: string }).id;
const del = (url: string) => app.inject({ method: 'DELETE', url, headers: { cookie: admin } });
const left = <T extends { status: string }>(rows: T[]) => rows.map((r) => r.status).sort();

describe('emptying the download and crawl lists', () => {
  it('removes every finished download; running and waiting ones stay', async () => {
    const userId = adminId();
    for (const status of ['done', 'error', 'cancelled', 'running', 'queued'] as const) {
      app.conbert.db
        .insert(downloads)
        .values({
          id: crypto.randomUUID(),
          userId,
          url: 'https://example.com/v',
          platform: 'youtube',
          tool: 'yt-dlp',
          kind: 'single',
          options: {},
          status,
          files: [],
        })
        .run();
    }
    const res = await del('/api/downloader/jobs');
    expect(res.json()).toEqual({ removed: 3 });
    expect(left(app.conbert.db.select().from(downloads).all())).toEqual(['queued', 'running']);
  });

  it('removes every finished crawl; running, waiting and paused ones stay', async () => {
    const userId = adminId();
    for (const status of ['done', 'error', 'cancelled', 'running', 'waiting', 'paused'] as const) {
      app.conbert.db
        .insert(booruJobs)
        .values({
          id: crypto.randomUUID(),
          userId,
          siteId: 'danbooru',
          query: 'cat',
          options: {},
          status,
          state: {},
        })
        .run();
    }
    const res = await del('/api/booru/jobs');
    expect(res.json()).toEqual({ removed: 3 });
    expect(left(app.conbert.db.select().from(booruJobs).all())).toEqual([
      'paused',
      'running',
      'waiting',
    ]);
  });
});
