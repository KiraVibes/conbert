import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import {
  canSubscribe,
  defaultFeedInterval,
  feedNewestFirst,
  MAX_DOWNLOAD_LIMIT,
  minFeedInterval,
} from '@conbert/core';
import type { FeedDto } from '@conbert/schemas';
import { downloads, type DownloadRecord } from '../db/schema';
import { API_ERROR_KEYS } from '../lib/http-error';
import { setupAdmin, testApp } from '../test/helpers';
import { createFeed, feedArchive, feedDownloadFinished, ownFeed, runFeed } from './feeds';
import { galleryDlArgs, ytDlpArgs, type DownloadOptions } from './runner';
import { toolVersion } from './tools';

const fixtures = path.join(import.meta.dirname, '../__fixtures__');

const OPTIONS: DownloadOptions = { quality: 'best', parts: [], limit: 50, sleepSeconds: 2 };
const FEED = {
  name: '',
  intervalMinutes: 60,
  paused: false,
  quality: 'best' as const,
  parts: [],
  limit: 20,
  sleepSeconds: 2,
  targetIds: [],
  toList: true,
  keepOnServer: false,
  after: null,
  notify: false,
  onlyNew: true,
  url: 'https://boards.4chan.org/diy/thread/1',
};
const PROBE = {
  tool: 'gallery-dl' as const,
  kind: 'playlist' as const,
  title: 'Werkbank',
  uploader: null,
  count: 12,
  duration: null,
  thumbnailUrl: null,
  entries: [],
  platform: '4chan' as const,
};

describe('subscription rules', () => {
  it('subscribes to profiles, channels and threads – not to single videos', () => {
    expect(canSubscribe('youtube', 'profile')).toBe(true);
    expect(canSubscribe('youtube', 'single')).toBe(false);
    expect(canSubscribe('4chan', 'single')).toBe(true);
    expect(defaultFeedInterval('4chan')).toBe(10);
    expect(minFeedInterval('instagram')).toBe(60);
    expect(feedNewestFirst('4chan')).toBe(false);
  });

  it('gives the tools their archive and keeps the link last', () => {
    const archive = { ...OPTIONS, archiveFile: '/data/feeds/a.txt', stopAtKnown: true };
    const yt = ytDlpArgs('https://youtube.com/@x', false, '/tmp/d', archive, null);
    expect(yt).toEqual(expect.arrayContaining(['--download-archive', '/data/feeds/a.txt']));
    expect(yt).toContain('--break-on-existing');
    expect(yt.slice(-2)).toEqual(['--', 'https://youtube.com/@x']);
    const record = ytDlpArgs(
      'https://youtube.com/@x',
      false,
      '/tmp/d',
      { ...archive, recordOnly: true },
      null,
    );
    expect(record).toEqual(
      expect.arrayContaining(['--flat-playlist', '--simulate', '--force-write-archive']),
    );
    expect(record).not.toContain('--no-simulate');
    expect(record.slice(-2)).toEqual(['--', 'https://youtube.com/@x']);

    const gd = galleryDlArgs('https://instagram.com/x', 'instagram', '/tmp/d', archive, null);
    expect(gd).toEqual(
      expect.arrayContaining(['--download-archive', '/data/feeds/a.txt', '--abort', '3']),
    );
    const gdRecord = galleryDlArgs(
      'https://instagram.com/x',
      'instagram',
      '/tmp/d',
      { ...archive, recordOnly: true },
      null,
    );
    expect(gdRecord).toContain('--no-download');
    // Only remembering: no pause per item, only between requests.
    expect(gd).toContain('--sleep');
    expect(gdRecord).not.toContain('--sleep');
    expect(gdRecord).toContain('--sleep-request');
    expect(gdRecord).not.toContain('--abort');
    expect(gdRecord.slice(-2)).toEqual(['--', 'https://instagram.com/x']);
  });
});

let app: FastifyInstance;
let dataDir: string;
let cookie: string;

async function start() {
  dataDir = mkdtempSync(path.join(os.tmpdir(), 'conbert-feeds-'));
  app = await testApp({ CONBERT_DATA_DIR: dataDir });
  cookie = await setupAdmin(app);
}
async function stop() {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
}
const api = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
  app.inject({
    method,
    url,
    headers: { cookie },
    ...(payload !== undefined && { payload: payload as Record<string, unknown> }),
  });
const userId = () =>
  (app.conbert.db.$client.prepare('select id from users').get() as { id: string }).id;

/** Queue stand-in: remembers what would run, or runs it right away. */
function fakeQueue(run = false): string[] {
  const queued: string[] = [];
  const queue = app.conbert.downloads.queue as unknown as {
    enqueue: (id: string) => Promise<void>;
    isHealthy: () => boolean;
  };
  queue.isHealthy = () => true;
  queue.enqueue = async (id) => {
    queued.push(id);
    if (run) await app.conbert.downloads.runner.run(id);
  };
  return queued;
}

function download(id: string): DownloadRecord | undefined {
  return app.conbert.db.select().from(downloads).where(eq(downloads.id, id)).get();
}

describe('subscriptions API', () => {
  beforeEach(start);
  afterEach(stop);

  it('checks a thread: first only remembers, later loads what is new', async () => {
    const queued = fakeQueue();
    const feed = createFeed(app.conbert, userId(), FEED, FEED.url, PROBE);
    expect(await runFeed(app.conbert, feed)).toBe(true);
    const first = download(queued[0] ?? '');
    expect(first?.feedId).toBe(feed.id);
    expect(first?.options).toMatchObject({
      feed: true,
      recordOnly: true,
      stopAtKnown: false,
      // A thread is gone through completely, the archive skips the known posts.
      limit: MAX_DOWNLOAD_LIMIT,
      archiveFile: feedArchive(app.conbert, feed),
      // The thread's title becomes the folder on the storage location.
      sourceName: 'Werkbank',
    });
    // A second check doesn't start while one is running.
    expect(await runFeed(app.conbert, ownFeed(app.conbert, userId(), feed.id))).toBe(false);

    // The first check ends without files: nothing new is no error, and the row goes away.
    app.conbert.db
      .update(downloads)
      .set({ status: 'done', finishedAt: new Date() })
      .where(eq(downloads.id, queued[0] ?? ''))
      .run();
    feedDownloadFinished(app.conbert, download(queued[0] ?? '') as DownloadRecord);
    expect(download(queued[0] ?? '')).toBeUndefined();
    const after = ownFeed(app.conbert, userId(), feed.id);
    expect(after).toMatchObject({ initialized: true, lastNew: 0, lastError: null });
    expect(after.nextCheckAt?.getTime()).toBeGreaterThan(Date.now() + 59 * 60_000);

    expect(await runFeed(app.conbert, after)).toBe(true);
    expect(download(queued[1] ?? '')?.options).toMatchObject({ recordOnly: false });
  });

  it('waits while a download from the same source runs, and starts right after', async () => {
    const queued = fakeQueue();
    const feed = createFeed(app.conbert, userId(), FEED, FEED.url, PROBE);
    // A normal download of the same thread is running.
    const running = crypto.randomUUID();
    app.conbert.db
      .insert(downloads)
      .values({
        id: running,
        userId: userId(),
        url: `${FEED.url}/`,
        platform: '4chan',
        tool: 'gallery-dl',
        kind: 'playlist',
        title: 'Werkbank',
        options: { ...OPTIONS, sourceName: 'Werkbank' },
        files: [],
        status: 'running',
      })
      .run();
    expect(await runFeed(app.conbert, feed)).toBe(false);
    expect(queued).toEqual([]);
    const list = (await api('GET', '/api/downloader/feeds')).json<{ feeds: FeedDto[] }>().feeds;
    expect(list[0]).toMatchObject({ waiting: true, checking: false });
    // Still due: the timer starts it as soon as the download is done.
    expect(ownFeed(app.conbert, userId(), feed.id).nextCheckAt?.getTime()).toBeLessThanOrEqual(
      Date.now(),
    );
    app.conbert.db.update(downloads).set({ status: 'done' }).where(eq(downloads.id, running)).run();
    expect(await runFeed(app.conbert, ownFeed(app.conbert, userId(), feed.id))).toBe(true);
    expect(queued).toHaveLength(1);
  });

  it('added parts are fetched completely at the next check', async () => {
    const queued = fakeQueue();
    const profile = { ...PROBE, platform: 'instagram' as const, kind: 'profile' as const };
    const feed = createFeed(
      app.conbert,
      userId(),
      { ...FEED, parts: ['posts'], intervalMinutes: 360 },
      'https://www.instagram.com/vinne.art/',
      profile,
    );
    // First check done: from now on only new posts, stopping at known ones.
    await runFeed(app.conbert, feed);
    app.conbert.db
      .update(downloads)
      .set({ status: 'done', finishedAt: new Date() })
      .where(eq(downloads.id, queued[0] ?? ''))
      .run();
    feedDownloadFinished(app.conbert, download(queued[0] ?? '') as DownloadRecord);
    const { url: _url, onlyNew: _onlyNew, ...update } = FEED;
    const changed = await api('PUT', `/api/downloader/feeds/${feed.id}`, {
      ...update,
      intervalMinutes: 360,
      parts: ['posts', 'reels'],
    });
    expect(changed.statusCode, changed.body).toBe(200);
    const due = ownFeed(app.conbert, userId(), feed.id);
    expect(due.nextCheckAt?.getTime()).toBeLessThanOrEqual(Date.now());
    await runFeed(app.conbert, due);
    expect(download(queued[1] ?? '')?.options).toMatchObject({
      parts: ['posts', 'reels'],
      stopAtKnown: false,
      limit: MAX_DOWNLOAD_LIMIT,
      recordOnly: false,
    });
    // After that check, it stops at known items again.
    app.conbert.db
      .update(downloads)
      .set({ status: 'done', finishedAt: new Date() })
      .where(eq(downloads.id, queued[1] ?? ''))
      .run();
    feedDownloadFinished(app.conbert, download(queued[1] ?? '') as DownloadRecord);
    await runFeed(app.conbert, ownFeed(app.conbert, userId(), feed.id));
    expect(download(queued[2] ?? '')?.options).toMatchObject({ stopAtKnown: true, limit: 20 });
  });

  it('notices a thread that is gone and stops checking it', async () => {
    const queued = fakeQueue();
    const feed = createFeed(app.conbert, userId(), FEED, FEED.url, PROBE);
    await runFeed(app.conbert, feed);
    app.conbert.db
      .update(downloads)
      .set({ status: 'error', errorKey: API_ERROR_KEYS.DOWNLOAD_NOT_FOUND, finishedAt: new Date() })
      .where(eq(downloads.id, queued[0] ?? ''))
      .run();
    feedDownloadFinished(app.conbert, download(queued[0] ?? '') as DownloadRecord);
    const ended = ownFeed(app.conbert, userId(), feed.id);
    expect(ended).toMatchObject({ ended: true, lastError: null });
    expect(await runFeed(app.conbert, ended)).toBe(false);
  });

  it('lists, changes and deletes subscriptions (with their archive)', async () => {
    fakeQueue();
    const feed = createFeed(app.conbert, userId(), FEED, FEED.url, PROBE);
    const archive = feedArchive(app.conbert, feed);
    mkdirSync(path.dirname(archive), { recursive: true });
    writeFileSync(archive, 'x');
    const list = (await api('GET', '/api/downloader/feeds')).json<{ feeds: FeedDto[] }>().feeds;
    expect(list).toEqual([
      expect.objectContaining({ id: feed.id, platform: '4chan', title: 'Werkbank' }),
    ]);
    const { url: _url, onlyNew: _onlyNew, ...update } = FEED;
    const changed = await api('PUT', `/api/downloader/feeds/${feed.id}`, {
      ...update,
      name: 'Werkbank',
      paused: true,
    });
    expect(changed.json<{ feed: FeedDto }>().feed).toMatchObject({
      name: 'Werkbank',
      paused: true,
    });
    expect((await api('DELETE', `/api/downloader/feeds/${feed.id}`)).statusCode).toBe(204);
    expect(existsSync(archive)).toBe(false);
    expect((await api('GET', '/api/downloader/feeds')).json()).toEqual({ feeds: [] });
  });

  it('refuses single videos and too frequent Instagram checks', () => {
    expect(() =>
      createFeed(app.conbert, userId(), FEED, 'https://youtu.be/x', {
        ...PROBE,
        platform: 'youtube',
        kind: 'single',
      }),
    ).toThrow(expect.objectContaining({ code: 'FEED_NOT_SUBSCRIBABLE' }));
    expect(() =>
      createFeed(
        app.conbert,
        userId(),
        { ...FEED, intervalMinutes: 10 },
        'https://instagram.com/x',
        {
          ...PROBE,
          platform: 'instagram',
          kind: 'profile',
        },
      ),
    ).toThrow(expect.objectContaining({ code: 'FEED_INTERVAL_TOO_SHORT' }));
  });

  it('keeps other users’ subscriptions apart', async () => {
    fakeQueue();
    const other = await api('POST', '/api/users', {
      username: 'gast',
      password: 'ein langes passwort',
    });
    const otherId = other.json<{ user: { id: string } }>().user.id;
    const feed = createFeed(app.conbert, otherId, FEED, FEED.url, PROBE);
    expect((await api('GET', '/api/downloader/feeds')).json()).toEqual({ feeds: [] });
    expect((await api('POST', `/api/downloader/feeds/${feed.id}/check`)).statusCode).toBe(404);
    expect((await api('DELETE', `/api/downloader/feeds/${feed.id}`)).statusCode).toBe(404);
  });
});

// --- Real tools (Docker image), against a local web server ---------------

const hasGalleryDl =
  (await toolVersion(
    { downloaderBin: process.env['CONBERT_DOWNLOADER_BIN'], dataDir: os.tmpdir() } as never,
    'gallery-dl',
  )) !== null;

describe.skipIf(!hasGalleryDl)('subscriptions with the real tools', () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url !== '/bild.png') {
        res.writeHead(404).end();
        return;
      }
      const data = readFileSync(path.join(fixtures, 'sample.png'));
      res.writeHead(200, { 'content-type': 'image/png', 'content-length': data.length });
      res.end(data);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
  beforeEach(start);
  afterEach(stop);

  it('loads an item once and never again', { timeout: 120_000 }, async () => {
    fakeQueue(true);
    const url = `${base}/bild.png`;
    const feed = createFeed(app.conbert, userId(), { ...FEED, onlyNew: false }, url, {
      ...PROBE,
      platform: '4chan',
    });
    await runFeed(app.conbert, feed);
    expect(ownFeed(app.conbert, userId(), feed.id)).toMatchObject({ lastNew: 1, totalLoaded: 1 });
    await runFeed(app.conbert, ownFeed(app.conbert, userId(), feed.id));
    expect(ownFeed(app.conbert, userId(), feed.id)).toMatchObject({ lastNew: 0, totalLoaded: 1 });
  });

  it(
    '"only new from now on" loads nothing that was there before',
    { timeout: 120_000 },
    async () => {
      fakeQueue(true);
      const url = `${base}/bild.png`;
      const feed = createFeed(app.conbert, userId(), FEED, url, { ...PROBE, platform: '4chan' });
      await runFeed(app.conbert, feed);
      await runFeed(app.conbert, ownFeed(app.conbert, userId(), feed.id));
      expect(ownFeed(app.conbert, userId(), feed.id)).toMatchObject({
        initialized: true,
        totalLoaded: 0,
      });
    },
  );
});
