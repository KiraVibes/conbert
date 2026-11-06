import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { downloaderI18nKeys } from '@conbert/core';
import { findMissingKeys } from '@conbert/i18n';
import type { DownloadDto } from '@conbert/schemas';
import { dataPaths } from '../config';
import { downloads } from '../db/schema';
import { API_ERROR_KEYS } from '../lib/http-error';
import { setupAdmin, testApp } from '../test/helpers';
import { isCookiesTxt } from './cookies';
import {
  finishPixivLogin,
  parsePixivCode,
  pixivConfigFile,
  pixivStatus,
  startPixivLogin,
} from './pixiv';
import {
  DEVIANTART_REDIRECT_URI,
  deleteDeviantart,
  deviantartConfigFile,
  deviantartStatus,
  finishDeviantartLogin,
  parseDeviantartCode,
  saveDeviantartApp,
  startDeviantartLogin,
} from './deviantart';
import { parseGalleryDlProbe, parseYtDlpProbe, probeUrl } from './probe';
import {
  galleryDlArgs,
  inHiddenFolder,
  isToolLeftover,
  resumeDownloads,
  ytDlpArgs,
  type DownloadOptions,
} from './runner';
import { classifyDownloadError, toolVersion } from './tools';

const fixtures = path.join(import.meta.dirname, '../__fixtures__');

const OPTIONS: DownloadOptions = {
  quality: 'best',
  parts: [],
  limit: 50,
  sleepSeconds: 2,
};

describe('downloader helpers', () => {
  it('reads what yt-dlp found', () => {
    const video = parseYtDlpProbe(
      JSON.stringify({
        title: 'Clip',
        uploader: 'Anna',
        duration: 12.5,
        thumbnail: 'https://i/t.jpg',
      }),
    );
    expect(video).toMatchObject({ kind: 'single', title: 'Clip', count: 1, duration: 12.5 });
    const list = parseYtDlpProbe(
      JSON.stringify({
        _type: 'playlist',
        extractor_key: 'YoutubeTab',
        title: 'Kanal',
        playlist_count: 120,
        entries: [{ title: 'Eins' }, { id: 'abc' }],
      }),
    );
    expect(list).toMatchObject({ kind: 'profile', count: 120, entries: ['Eins', 'abc'] });
  });

  it('reads what gallery-dl found', () => {
    const json = JSON.stringify([
      [2, { username: 'natgeo' }],
      [3, 'https://cdn/1.jpg', { username: 'natgeo', description: 'Ein Wal', filename: '1' }],
      [3, 'https://cdn/2.mp4', { username: 'natgeo', filename: '2' }],
    ]);
    const info = parseGalleryDlProbe(
      json,
      new URL('https://www.instagram.com/natgeo/'),
      'instagram',
    );
    expect(info).toMatchObject({
      tool: 'gallery-dl',
      kind: 'profile',
      uploader: 'natgeo',
      count: 2,
      thumbnailUrl: 'https://cdn/1.jpg',
    });
  });

  it('follows a profile that only points to its posts, and spots login walls', () => {
    const profile = parseGalleryDlProbe(
      JSON.stringify([[6, 'https://www.instagram.com/natgeo/posts/', { subcategory: 'user' }]]),
      new URL('https://www.instagram.com/natgeo/'),
      'instagram',
    );
    expect(profile).toMatchObject({
      kind: 'profile',
      uploader: 'natgeo',
      queue: ['https://www.instagram.com/natgeo/posts/'],
    });
    expect(() =>
      parseGalleryDlProbe(
        JSON.stringify([
          [
            -1,
            {
              error: 'AbortExtraction',
              message: 'HTTP redirect to login page (https://www.instagram.com/accounts/login/)',
            },
          ],
        ]),
        new URL('https://www.instagram.com/p/abc/'),
        'instagram',
      ),
    ).toThrow(expect.objectContaining({ code: 'DOWNLOAD_LOGIN_REQUIRED' }));
    // Reddit, with and without a login: the connection is blocked, not the account.
    expect(classifyDownloadError("You've been blocked by network security.")).toBe(
      'DOWNLOAD_BLOCKED',
    );
    expect(
      classifyDownloadError(
        'ERROR: [Reddit] 1xhu70f: Your IP address is unable to access the Reddit API',
      ),
    ).toBe('DOWNLOAD_BLOCKED');
    expect(classifyDownloadError('Account authentication is required. Use --cookies')).toBe(
      'DOWNLOAD_LOGIN_REQUIRED',
    );
  });

  it('always puts the link last, after "--"', () => {
    const tricky = '--exec=rm -rf /';
    const yt = ytDlpArgs(tricky, true, '/tmp/x', { ...OPTIONS, dateAfter: '2026-01-31' }, '/tmp/c');
    expect(yt.slice(-2)).toEqual(['--', tricky]);
    expect(yt).toEqual(
      expect.arrayContaining(['--no-playlist', '--dateafter', '20260131', '--cookies', '/tmp/c']),
    );
    expect(yt).toEqual(expect.arrayContaining(['-I', ':50', '--sleep-requests', '2']));
    expect(ytDlpArgs('u', false, '/x', { ...OPTIONS, quality: 'audio' }, null)).toEqual(
      expect.arrayContaining(['--yes-playlist', '-x', '--audio-format', 'mp3']),
    );

    const gd = galleryDlArgs(
      tricky,
      'instagram',
      '/tmp/x',
      {
        ...OPTIONS,
        parts: ['stories', 'reels'],
        dateAfter: '2026-01-02',
        dateBefore: '2026-03-04',
      },
      null,
    );
    expect(gd.slice(-2)).toEqual(['--', tricky]);

    // Pixiv: the key comes in a config file, animations become MP4, adult works stay out.
    const px = galleryDlArgs(
      'https://www.pixiv.net/users/11',
      'pixiv',
      '/tmp/x',
      OPTIONS,
      null,
      '/tmp/pixiv.json',
    );
    expect(px.slice(0, 3)).toEqual(['--config-ignore', '-c', '/tmp/pixiv.json']);
    expect(px).toEqual(expect.arrayContaining(['--ugoira', 'mp4', '--filter', 'x_restrict == 0']));
    const pxAll = galleryDlArgs(
      'https://www.pixiv.net/users/11',
      'pixiv',
      '/tmp/x',
      {
        ...OPTIONS,
        pixiv: { ugoira: 'gif', adult: true },
      },
      null,
    );
    expect(pxAll).toEqual(expect.arrayContaining(['--ugoira', 'gif']));
    expect(pxAll).not.toContain('--filter');
    expect(gd).not.toContain('--ugoira');
    expect(gd).toEqual(
      expect.arrayContaining([
        '-o',
        'include=stories,reels',
        '--filter',
        'date >= datetime(2026, 1, 2) and date < datetime(2026, 3, 4)',
      ]),
    );
  });

  it("never takes the tools' caches for downloads", () => {
    const job = path.join(os.tmpdir(), 'download-1');
    expect(inHiddenFolder(job, path.join(job, '.cache', 'gallery-dl', 'cache.sqlite3'))).toBe(true);
    expect(inHiddenFolder(job, path.join(job, '.thumbs', 'abc.jpg'))).toBe(true);
    expect(inHiddenFolder(job, path.join(job, 'clip [abc].mp4'))).toBe(false);
    expect(inHiddenFolder(job, path.join(job, 'unter', 'bild.png'))).toBe(false);
    expect(isToolLeftover('cache.sqlite3')).toBe(true);
    expect(isToolLeftover('archive.sqlite3-journal')).toBe(true);
    expect(isToolLeftover('urlaub.png')).toBe(false);
  });

  it('explains what went wrong', () => {
    expect(classifyDownloadError('ERROR: Unsupported URL: https://x')).toBe('DOWNLOAD_UNSUPPORTED');
    expect(classifyDownloadError('Sign in to confirm your age')).toBe('DOWNLOAD_LOGIN_REQUIRED');
    expect(classifyDownloadError('HTTP Error 429: Too Many Requests')).toBe(
      'DOWNLOAD_RATE_LIMITED',
    );
    expect(classifyDownloadError('Video unavailable')).toBe('DOWNLOAD_NOT_FOUND');
    expect(classifyDownloadError('something else')).toBe('DOWNLOAD_FAILED');
  });

  it('accepts only cookies.txt files', () => {
    expect(
      isCookiesTxt('# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tabc\n'),
    ).toBe(true);
    expect(isCookiesTxt('#HttpOnly_.x.com\tTRUE\t/\tTRUE\t0\tauth\tz')).toBe(true);
    expect(isCookiesTxt('{"cookies": []}')).toBe(false);
    expect(isCookiesTxt('# only a comment')).toBe(false);
  });

  it('has every text', () => {
    const errors = Object.values(API_ERROR_KEYS).filter((k) => k.startsWith('errors.download'));
    expect(
      findMissingKeys([
        ...downloaderI18nKeys(),
        ...errors.flatMap((k) => [`${k}.what`, `${k}.cause`, `${k}.action`]),
      ]),
    ).toEqual([]);
  });
});

// --- API --------------------------------------------------------------

let app: FastifyInstance;
let dataDir: string;
let cookie: string;

async function start() {
  dataDir = mkdtempSync(path.join(os.tmpdir(), 'conbert-dl-'));
  app = await testApp({
    CONBERT_DATA_DIR: dataDir,
    CONBERT_STORAGE_ROOTS: path.join(dataDir, 'storage'),
  });
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

describe('downloader API', () => {
  beforeEach(start);
  afterEach(stop);

  it('refuses links to this machine or the home network', async () => {
    for (const url of [
      'http://127.0.0.1:3313/api/health',
      'http://192.168.1.1/',
      'file:///etc/passwd',
    ]) {
      const res = await api('POST', '/api/downloader/probe', { url });
      expect(res.statusCode, url).toBe(400);
      expect(res.json<{ error: { code: string } }>().error.code).toBe('DOWNLOAD_URL_INVALID');
    }
  });

  it('keeps cookies encrypted and never sends them back', async () => {
    const content = '.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tgeheim-123\n';
    expect((await api('PUT', '/api/downloader/cookies/youtube', { content })).statusCode).toBe(204);
    const list = await api('GET', '/api/downloader/cookies');
    expect(list.body).not.toContain('geheim-123');
    expect(list.json<{ cookies: { platform: string }[] }>().cookies.map((c) => c.platform)).toEqual(
      ['youtube'],
    );
    const row = app.conbert.db.$client.prepare('select content from downloader_cookies').get() as {
      content: string;
    };
    expect(row.content).toMatch(/^v1\./);
    expect(row.content).not.toContain('geheim-123');
    expect(
      (await api('PUT', '/api/downloader/cookies/youtube', { content: 'kein cookie' })).json<{
        error: { code: string };
      }>().error.code,
    ).toBe('DOWNLOAD_COOKIES_INVALID');
    expect((await api('DELETE', '/api/downloader/cookies/youtube')).statusCode).toBe(204);
    expect((await api('GET', '/api/downloader/cookies')).json()).toEqual({ cookies: [] });
  });

  it('queues downloads a restart interrupted again', async () => {
    const queued: string[] = [];
    const own = await testApp(
      { CONBERT_DATA_DIR: dataDir },
      {
        downloadQueue: () => ({
          enqueue: async (id) => void queued.push(id),
          removeWaiting: async () => false,
          isHealthy: () => true,
          close: async () => undefined,
        }),
      },
    );
    try {
      await setupAdmin(own);
      const userId = (
        own.conbert.db.$client.prepare('select id from users').get() as { id: string }
      ).id;
      const row = (id: string, status: 'running' | 'queued' | 'done') => ({
        id,
        userId,
        url: 'https://example.com/a',
        platform: 'other',
        tool: 'gallery-dl' as const,
        kind: 'playlist' as const,
        options: OPTIONS,
        status,
        files: [],
      });
      own.conbert.db
        .insert(downloads)
        .values([row('a', 'running'), row('b', 'queued'), row('c', 'done')])
        .run();
      await resumeDownloads(own.conbert);
      expect(queued.sort()).toEqual(['a', 'b']);
      const status = own.conbert.db.$client
        .prepare("select status from downloads where id = 'a'")
        .get() as { status: string };
      expect(status.status).toBe('queued');
    } finally {
      await own.close();
    }
  });

  it('lets DeviantArt downloads of one account take turns', async () => {
    const queued: { id: string; delay?: number }[] = [];
    const own = await testApp(
      { CONBERT_DATA_DIR: dataDir },
      {
        downloadQueue: () => ({
          enqueue: async (id, delay) => void queued.push({ id, ...(delay && { delay }) }),
          removeWaiting: async () => false,
          isHealthy: () => true,
          close: async () => undefined,
        }),
      },
    );
    try {
      await setupAdmin(own);
      const userId = (
        own.conbert.db.$client.prepare('select id from users').get() as { id: string }
      ).id;
      const row = (id: string, status: 'running' | 'queued') => ({
        id,
        userId,
        url: 'https://www.deviantart.com/someone/gallery',
        platform: 'deviantart',
        tool: 'gallery-dl' as const,
        kind: 'playlist' as const,
        options: OPTIONS,
        status,
        files: [],
      });
      own.conbert.db
        .insert(downloads)
        .values([row('first', 'running'), row('second', 'queued')])
        .run();
      // "first" is loading right now in this process.
      const runner = own.conbert.downloads.runner as unknown as {
        running: Map<string, AbortController>;
      };
      runner.running.set('first', new AbortController());
      await own.conbert.downloads.runner.run('second');
      expect(queued).toEqual([{ id: 'second', delay: 20_000 }]);
      const status = own.conbert.db.$client
        .prepare("select status from downloads where id = 'second'")
        .get() as { status: string };
      expect(status.status).toBe('queued');
      runner.running.delete('first');
    } finally {
      await own.close();
    }
  });

  it('sets up your own DeviantArt app and logs in without showing the secret', async () => {
    const ctx = app.conbert;
    const userId = (ctx.db.$client.prepare('select id from users').get() as { id: string }).id;
    const secret = '0123456789abcdef0123456789abcdef';
    expect((await api('GET', '/api/downloader/deviantart')).json()).toMatchObject({
      hasApp: false,
      connected: false,
    });
    const bad = await api('PUT', '/api/downloader/deviantart/app', {
      clientId: 'abc',
      clientSecret: secret,
    });
    expect(bad.json<{ error: { code: string } }>().error.code).toBe('DEVIANTART_APP_INVALID');

    const calls: { url: string; auth: string | null; body: URLSearchParams | null }[] = [];
    const fakeFetch = (async (url: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      calls.push({
        url,
        auth: headers.get('authorization'),
        body: init.body instanceof URLSearchParams ? init.body : null,
      });
      const json = (data: unknown, status = 200) =>
        new Response(JSON.stringify(data), {
          status,
          headers: { 'Content-Type': 'application/json' },
        });
      if (url.endsWith('/whoami')) return json({ username: 'Mika' });
      const grant = (init.body as URLSearchParams).get('grant_type');
      if (grant === 'client_credentials') return json({ access_token: 'public' });
      if ((init.body as URLSearchParams).get('code') === 'oldcode123') {
        return json({ error: 'invalid_grant' }, 400);
      }
      return json({ access_token: 'private', refresh_token: 'refresh-abcdefghijklmnop' });
    }) as typeof fetch;

    // The app is only kept after DeviantArt accepted it.
    await saveDeviantartApp(ctx, userId, { clientId: ' 12345 ', clientSecret: secret }, fakeFetch);
    expect(calls[0]?.auth).toBe(`Basic ${Buffer.from(`12345:${secret}`).toString('base64')}`);
    const status = await api('GET', '/api/downloader/deviantart');
    expect(status.body).not.toContain(secret);
    expect(status.json()).toMatchObject({ hasApp: true, clientId: '12345', connected: false });
    // Not a cookie file: the cookie list stays empty, the row is encrypted.
    expect((await api('GET', '/api/downloader/cookies')).json()).toEqual({ cookies: [] });
    const row = ctx.db.$client.prepare('select content from downloader_cookies').get() as {
      content: string;
    };
    expect(row.content).not.toContain(secret);

    const login = new URL(startDeviantartLogin(ctx, userId));
    expect(login.origin).toBe('https://www.deviantart.com');
    expect(login.searchParams.get('client_id')).toBe('12345');
    expect(login.searchParams.get('redirect_uri')).toBe(DEVIANTART_REDIRECT_URI);
    expect(login.searchParams.get('code_challenge_method')).toBe('S256');
    const state = login.searchParams.get('state') ?? '';
    expect(parseDeviantartCode(`http://localhost:6414/?code=Ab_c-123456&state=${state}`)).toEqual({
      code: 'Ab_c-123456',
      state,
    });
    expect(parseDeviantartCode('nicht <gültig>')).toBeNull();
    // An address from another login attempt doesn't count.
    await expect(
      finishDeviantartLogin(
        ctx,
        userId,
        'http://localhost:6414/?code=abc12345&state=other',
        fakeFetch,
      ),
    ).rejects.toMatchObject({ code: 'DEVIANTART_LOGIN_EXPIRED' });
    await expect(
      finishDeviantartLogin(ctx, userId, `?code=oldcode123&state=${state}`, fakeFetch),
    ).rejects.toMatchObject({ code: 'DEVIANTART_CODE_EXPIRED' });

    const done = await finishDeviantartLogin(
      ctx,
      userId,
      `http://localhost:6414/?code=Ab_c-123456&state=${state}`,
      fakeFetch,
    );
    expect(done).toMatchObject({ connected: true, name: 'Mika' });
    const swap = calls.find((c) => c.body?.get('code') === 'Ab_c-123456');
    expect(swap?.body?.get('grant_type')).toBe('authorization_code');
    expect(swap?.body?.get('redirect_uri')).toBe(DEVIANTART_REDIRECT_URI);
    expect(swap?.body?.get('code_verifier')?.length).toBeGreaterThan(20);
    expect(calls.at(-1)?.auth).toBe('Bearer private');

    // gallery-dl gets app and token in a private config file, never on the command line.
    const config = await deviantartConfigFile(ctx, userId, dataDir);
    expect(JSON.parse(readFileSync(config.file ?? '', 'utf8'))).toEqual({
      extractor: {
        deviantart: {
          'client-id': '12345',
          'client-secret': secret,
          'refresh-token': 'refresh-abcdefghijklmnop',
        },
      },
    });
    await config.remove();

    // Logging out keeps the app; removing forgets everything.
    await deleteDeviantart(ctx, userId, false);
    expect(deviantartStatus(ctx, userId)).toMatchObject({ hasApp: true, connected: false });
    expect((await api('DELETE', '/api/downloader/deviantart?all=1')).statusCode).toBe(204);
    expect(deviantartStatus(ctx, userId)).toMatchObject({ hasApp: false, connected: false });
  });

  it('keeps the Pixiv key encrypted and apart from the cookies', async () => {
    const token = 'AbCdEfGhIjKlMnOpQrStUvWxYz_0123456789-xyz';
    // Without a login, Pixiv links say what helps (no tool needed for that).
    const before = await api('POST', '/api/downloader/probe', {
      url: 'https://www.pixiv.net/en/artworks/12345',
    });
    expect(before.json<{ error: { code: string } }>().error.code).toBe('DOWNLOAD_PIXIV_LOGIN');
    expect(
      (await api('PUT', '/api/downloader/pixiv/token', { refreshToken: 'x' })).statusCode,
    ).toBe(400);
    const saved = await api('PUT', '/api/downloader/pixiv/token', { refreshToken: token });
    expect(saved.json()).toMatchObject({ connected: true, name: null });
    const status = await api('GET', '/api/downloader/pixiv');
    expect(status.body).not.toContain(token);
    expect(status.json()).toMatchObject({ connected: true });
    // Not a cookie file: the cookie list stays empty.
    expect((await api('GET', '/api/downloader/cookies')).json()).toEqual({ cookies: [] });
    const row = app.conbert.db.$client.prepare('select content from downloader_cookies').get() as {
      content: string;
    };
    expect(row.content).not.toContain(token);
    expect((await api('DELETE', '/api/downloader/pixiv')).statusCode).toBe(204);
    expect((await api('GET', '/api/downloader/pixiv')).json()).toMatchObject({ connected: false });
  });

  it('swaps the Pixiv login code for a key', async () => {
    const ctx = app.conbert;
    const userId = (ctx.db.$client.prepare('select id from users').get() as { id: string }).id;
    const login = new URL(startPixivLogin(userId));
    expect(login.origin).toBe('https://app-api.pixiv.net');
    expect(login.searchParams.get('code_challenge_method')).toBe('S256');
    expect(
      parsePixivCode("Failed to launch 'pixiv://account/login?code=Ab_c-123456&via=login'"),
    ).toBe('Ab_c-123456');
    expect(parsePixivCode('Ab_c-123456')).toBe('Ab_c-123456');
    expect(parsePixivCode('nicht <gültig>')).toBeNull();

    let sent = new URLSearchParams();
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      sent = init.body as URLSearchParams;
      return new Response(
        JSON.stringify({ refresh_token: 'RefreshToken_abcdefghijklmnop', user: { name: 'Mika' } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as unknown as typeof fetch;
    const status = await finishPixivLogin(ctx, userId, 'code=Ab_c-123456', fakeFetch);
    expect(status).toMatchObject({ connected: true, name: 'Mika' });
    expect(sent.get('code')).toBe('Ab_c-123456');
    expect(sent.get('code_verifier')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(pixivStatus(ctx, userId).name).toBe('Mika');

    // The gallery-dl config with the key exists only for one run.
    const folder = mkdtempSync(path.join(os.tmpdir(), 'pixiv-'));
    const config = await pixivConfigFile(ctx, userId, folder);
    expect(JSON.parse(readFileSync(config.file ?? '', 'utf8'))).toEqual({
      extractor: { pixiv: { 'refresh-token': 'RefreshToken_abcdefghijklmnop' } },
    });
    await config.remove();
    expect(readdirSync(folder)).toEqual([]);
    rmSync(folder, { recursive: true, force: true });

    // A used or late code: Pixiv says invalid_grant – and the login has to start again.
    startPixivLogin(userId);
    const expired = (async () =>
      new Response(JSON.stringify({ error: 'invalid_grant' }), {
        status: 400,
      })) as unknown as typeof fetch;
    await expect(finishPixivLogin(ctx, userId, 'Ab_c-123456', expired)).rejects.toMatchObject({
      code: 'PIXIV_CODE_EXPIRED',
    });
  });
});

// --- Real tools (Docker image), against a local web server ---------------

const hasYtDlp =
  (await toolVersion(
    { downloaderBin: process.env['CONBERT_DOWNLOADER_BIN'], dataDir: os.tmpdir() } as never,
    'yt-dlp',
  )) !== null;

describe.skipIf(!hasYtDlp)('downloads with the real tools', () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      const file = { '/clip.mp4': 'sample.mp4', '/bild.png': 'sample.png' }[req.url ?? ''];
      if (!file) {
        res.writeHead(404).end();
        return;
      }
      const data = readFileSync(path.join(fixtures, file));
      res.writeHead(200, {
        'content-type': file.endsWith('.mp4') ? 'video/mp4' : 'image/png',
        'content-length': data.length,
      });
      res.end(data);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  beforeEach(start);
  afterEach(stop);

  /** Runs one download through the runner (the API refuses local links on purpose). */
  async function download(
    url: string,
    tool: 'yt-dlp' | 'gallery-dl',
    destination: Partial<DownloadOptions> = {},
  ): Promise<DownloadDto> {
    const info = await probeUrl(app.conbert, adminId(), new URL(url));
    expect(info.tool).toBe(tool);
    const id = crypto.randomUUID();
    app.conbert.db
      .insert(downloads)
      .values({
        id,
        userId: adminId(),
        url,
        platform: 'other',
        tool: info.tool,
        kind: info.kind,
        title: info.title,
        options: { ...OPTIONS, sleepSeconds: 1, ...destination },
        files: [],
      })
      .run();
    await app.conbert.downloads.runner.run(id);
    const res = await api('GET', `/api/downloader/jobs/${id}`);
    return res.json<{ download: DownloadDto }>().download;
  }
  const adminId = () =>
    (app.conbert.db.$client.prepare('select id from users').get() as { id: string }).id;

  it(
    'downloads a video with yt-dlp and hands it over like an upload',
    { timeout: 120_000 },
    async () => {
      // The chosen storage location gets the file too, as soon as it is done.
      const storage = path.join(dataDir, 'storage');
      mkdirSync(path.join(storage, 'NAS'), { recursive: true });
      const created = await api('POST', '/api/targets', {
        name: 'Platte',
        type: 'local',
        basePath: 'NAS',
        usage: { asTarget: true, asSource: true },
        settings: { root: storage },
        isDefault: true,
        subfolderPattern: '{platform}',
      });
      const targetId = created.json<{ target: { id: string } }>().target.id;
      const events: DownloadDto[] = [];
      app.conbert.jobs.events.on('download', (_user, d) => events.push(d));
      const result = await download(`${base}/clip.mp4`, 'yt-dlp', { targetIds: [targetId] });
      // The file was announced while running (one tile per file), and progress never went back.
      expect(events.some((d) => d.status === 'running' && d.files.length === 1)).toBe(true);
      // A file is only announced once it is saved: the browser may take it into
      // its list and free it on the server right away.
      for (const d of events.filter((e) => e.files.length > 0)) {
        expect(d.files[0]?.savedTo).toEqual(['Platte']);
      }
      const steps = events.map((d) => d.progress);
      expect(steps).toEqual([...steps].sort((a, b) => a - b));
      expect(result.files[0]).toMatchObject({
        savedTo: ['Platte'],
        onServer: true,
        saveError: null,
      });
      expect(result).toMatchObject({
        status: 'done',
        progress: 100,
        savedTo: 'Platte',
        skipped: 0,
      });
      expect(result.files).toHaveLength(1);
      expect(result.files[0]?.ext).toBe('mp4');
      // yt-dlp may add title and cover to the file, so it's checked as a video, not byte by byte.
      const content = await api('GET', `/api/files/${result.files[0]?.fileId}/content`);
      expect(content.rawPayload.subarray(4, 8).toString('latin1')).toBe('ftyp');
      // A preview picture (a frame of the video) for the tile.
      expect(result.files[0]?.thumbnail).toBe(true);
      const thumb = await api('GET', `/api/downloader/thumbs/${result.files[0]?.fileId}`);
      expect(thumb.statusCode).toBe(200);
      expect(thumb.headers['content-type']).toBe('image/jpeg');
      expect(thumb.rawPayload.subarray(0, 2).toString('hex')).toBe('ffd8');
      // Removing the download from the list removes the picture too.
      await api('DELETE', `/api/downloader/jobs/${result.id}`);
      expect(
        (await api('GET', `/api/downloader/thumbs/${result.files[0]?.fileId}`)).statusCode,
      ).toBe(404);
      expect(readdirSync(path.join(storage, 'NAS', 'other'))).toHaveLength(1);
      // Nothing is left behind in the temporary folder (no cookies, no parts).
      expect(
        readdirSync(path.join(dataDir, 'tmp')).filter((n) => n.startsWith('download-')),
      ).toEqual([]);
    },
  );

  it('only to a storage location: nothing stays on the server', { timeout: 120_000 }, async () => {
    const storage = path.join(dataDir, 'storage');
    mkdirSync(path.join(storage, 'NAS'), { recursive: true });
    const created = await api('POST', '/api/targets', {
      name: 'Platte',
      type: 'local',
      basePath: 'NAS',
      usage: { asTarget: true, asSource: true },
      settings: { root: storage },
    });
    const targetId = created.json<{ target: { id: string } }>().target.id;
    const result = await download(`${base}/clip.mp4`, 'yt-dlp', {
      targetIds: [targetId],
      toList: false,
    });
    expect(result).toMatchObject({ status: 'done', toList: false });
    expect(result.files[0]).toMatchObject({ savedTo: ['Platte'], onServer: false });
    expect((await api('GET', `/api/files/${result.files[0]?.fileId}/content`)).statusCode).toBe(
      404,
    );
    expect(readdirSync(path.join(storage, 'NAS'))).toHaveLength(1);
  });

  it(
    'loads nothing twice: the archive skips known items, the location skips the same file',
    { timeout: 180_000 },
    async () => {
      const storage = path.join(dataDir, 'storage');
      mkdirSync(path.join(storage, 'NAS'), { recursive: true });
      const created = await api('POST', '/api/targets', {
        name: 'Platte',
        type: 'local',
        basePath: 'NAS',
        usage: { asTarget: true, asSource: true },
        settings: { root: storage },
      });
      const targetId = created.json<{ target: { id: string } }>().target.id;
      const archiveFile = path.join(dataDir, 'archives', 'test.txt');
      mkdirSync(path.dirname(archiveFile), { recursive: true });
      const first = await download(`${base}/clip.mp4`, 'yt-dlp', {
        targetIds: [targetId],
        archiveFile,
      });
      expect(first.files).toHaveLength(1);
      // Second time with the archive: nothing is downloaded at all.
      const second = await download(`${base}/clip.mp4`, 'yt-dlp', {
        targetIds: [targetId],
        archiveFile,
      });
      // … and it says so: one item had been loaded before.
      expect(second).toMatchObject({ status: 'done', nothingNew: true, files: [], known: 1 });
      // Without the archive it is downloaded again, but the location already
      // has the same file – no "clip (2).mp4".
      const third = await download(`${base}/clip.mp4`, 'yt-dlp', { targetIds: [targetId] });
      expect(third.files[0]).toMatchObject({ savedTo: ['Platte'], alreadyThere: true });
      expect(readdirSync(path.join(storage, 'NAS'))).toHaveLength(1);
    },
  );

  it('downloads a picture with gallery-dl', { timeout: 120_000 }, async () => {
    // gallery-dl knows direct links ("directlink"); yt-dlp would refuse a picture.
    const info = await probeUrl(app.conbert, adminId(), new URL(`${base}/bild.png`));
    expect(['gallery-dl', 'yt-dlp']).toContain(info.tool);
    const result = await download(`${base}/bild.png`, info.tool);
    expect(result.status).toBe('done');
    expect(result.files[0]?.ext).toBe('png');
    expect(result.files[0]?.thumbnail).toBe(true);
    // gallery-dl's own cache (cache.sqlite3) is never among the downloads.
    expect(result.files.map((f) => f.name)).not.toContain('cache.sqlite3');
    expect(result.files).toHaveLength(1);
  });

  it('goes on after a restart without loading anything twice', { timeout: 120_000 }, async () => {
    const url = `${base}/bild.png`;
    const info = await probeUrl(app.conbert, adminId(), new URL(url));
    const id = crypto.randomUUID();
    const ext = info.tool === 'yt-dlp' ? 'txt' : 'sqlite3';
    const archive = path.join(dataPaths(app.conbert.config).tmp, `download-${id}.${ext}`);
    // Before the restart the picture was loaded: its private archive knows it.
    await download(url, info.tool, { recordOnly: true, archiveFile: archive });
    expect(existsSync(archive)).toBe(true);
    const earlier = {
      fileId: crypto.randomUUID(),
      name: 'bild.png',
      ext: 'png',
      size: 1,
      savedTo: [],
      saveError: null,
      onServer: true,
      thumbnail: false,
      alreadyThere: false,
    };
    app.conbert.db
      .insert(downloads)
      .values({
        id,
        userId: adminId(),
        url,
        platform: 'other',
        tool: info.tool,
        kind: info.kind,
        title: info.title,
        options: { ...OPTIONS, sleepSeconds: 1 },
        status: 'running',
        done: 1,
        files: [earlier],
      })
      .run();
    await resumeDownloads(app.conbert);
    await (app.conbert.downloads.queue as unknown as { idle(): Promise<void> }).idle();
    const res = await api('GET', `/api/downloader/jobs/${id}`);
    const result = res.json<{ download: DownloadDto }>().download;
    expect(result.status).toBe('done');
    // The earlier file stays, nothing was loaded again, and it doesn't count as "known".
    expect(result.files.map((f) => f.fileId)).toEqual([earlier.fileId]);
    expect(result.known).toBe(0);
    expect(existsSync(archive)).toBe(false);
  });

  it('explains a link that leads nowhere', { timeout: 120_000 }, async () => {
    await expect(
      probeUrl(app.conbert, adminId(), new URL(`${base}/weg.mp4`)),
    ).rejects.toMatchObject({
      code: 'DOWNLOAD_NOT_FOUND',
    });
  });
});

describe('instagram profiles', () => {
  it('take their name from the link, not from a joint post on top', () => {
    const json = JSON.stringify([
      [2, { username: 'proxy_unit' }],
      [
        3,
        'https://cdn/1.jpg',
        { username: 'proxy_unit', description: 'Gemeinsamer Post', filename: '1' },
      ],
    ]);
    const info = parseGalleryDlProbe(
      json,
      new URL('https://www.instagram.com/vinne.art/'),
      'instagram',
    );
    expect(info).toMatchObject({ kind: 'profile', uploader: 'vinne.art', title: 'vinne.art' });
  });
});
