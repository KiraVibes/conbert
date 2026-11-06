import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { booruI18nKeys, builtinSite, retiredSite, type BooruSiteInfo } from '@conbert/core';
import { findMissingKeys } from '@conbert/i18n';
import type {
  BooruJobDto,
  BooruSearchResponse,
  BooruSite,
  SubscriptionDto,
} from '@conbert/schemas';
import { setupAdmin, testApp } from '../test/helpers';
import { createAdapter } from './adapters';
import { exiftoolArgs, sidecarContent } from './metadata';

// --- A tiny Danbooru-like site ---

interface FakePost {
  id: number;
  rating: string;
  tags: string[];
  file?: boolean;
}

const POSTS: FakePost[] = [
  { id: 10, rating: 'g', tags: ['1girl', 'cat_ears', 'blue_eyes'] },
  { id: 9, rating: 'g', tags: ['loli', 'cat_ears'] },
  { id: 8, rating: 'e', tags: ['1girl', 'cat_ears', 'nude'] },
  { id: 7, rating: 'g', tags: ['cat_ears', 'gore'] },
  { id: 6, rating: 'g', tags: ['cat_ears'], file: false },
  { id: 5, rating: 'g', tags: ['child', 'park', 'cat_ears'] },
  { id: 4, rating: 'q', tags: ['child', 'cat_ears'] },
  { id: 3, rating: 'g', tags: ['cat_ears', 'blue_eyes', 'red_hair'] },
  { id: 2, rating: 'g', tags: ['dog'] },
];

/** A one-pixel JPEG is enough for the thumbnail proxy. */
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
  'base64',
);

let server: Server;
let base = '';
const seen: {
  tags: string[];
  thumbs: number[];
  userAgent: string;
  auth: string | undefined;
  fileReferer: string | undefined;
} = {
  tags: [],
  thumbs: [],
  userAgent: '',
  auth: undefined,
  fileReferer: undefined,
};
let rateLimitOnce = false;
/** Like a broken image host: an HTML page that claims to be a JPEG. */
let htmlFiles = false;

function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', base);
  seen.userAgent = String(req.headers['user-agent']);
  seen.auth = req.headers.authorization;
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (url.pathname === '/posts.json') {
    if (rateLimitOnce) {
      rateLimitOnce = false;
      res.writeHead(429, { 'Retry-After': '1' });
      res.end();
      return;
    }
    const tags = (url.searchParams.get('tags') ?? '').split(' ').filter(Boolean);
    seen.tags = tags;
    const counted = tags.filter((t) => !t.startsWith('rating:'));
    if (counted.length > 2) {
      json(422, { success: false, message: 'You cannot search for more than 2 tags at a time.' });
      return;
    }
    const ids = tags
      .find((t) => t.startsWith('id:'))
      ?.slice(3)
      .split(',')
      .map(Number);
    const include = tags.filter((t) => !t.includes(':') && !t.startsWith('-'));
    const page = url.searchParams.get('page') ?? '';
    const before = page.startsWith('b') ? Number(page.slice(1)) : Infinity;
    const limit = Number(url.searchParams.get('limit') ?? 20);
    const list = POSTS.filter(
      (p) => (ids ? ids.includes(p.id) : include.every((t) => p.tags.includes(t))) && p.id < before,
    ).slice(0, limit);
    json(
      200,
      list.map((p) => ({
        id: p.id,
        md5: `md5-${p.id}`,
        rating: p.rating,
        tag_string: p.tags.join(' '),
        tag_string_artist: 'painter',
        score: 10,
        fav_count: 1,
        image_width: 800,
        image_height: 600,
        file_ext: 'jpg',
        file_size: 1234,
        created_at: '2024-05-01T10:00:00.000Z',
        ...(p.file !== false && { file_url: `${base}/file/${p.id}.jpg` }),
        preview_file_url: `${base}/thumb/${p.id}.jpg`,
      })),
    );
    return;
  }
  if (url.pathname === '/tags.json') {
    const prefix = (url.searchParams.get('search[name_matches]') ?? '').replace('*', '');
    const all = [
      { name: 'cat_ears', post_count: 500, category: 0 },
      { name: 'cat_tail', post_count: 20, category: 0 },
      { name: 'loli', post_count: 100, category: 0 },
      { name: 'blue_eyes', post_count: 50, category: 0 },
      { name: 'red_hair', post_count: 5, category: 0 },
      { name: 'painter', post_count: 3, category: 1 },
    ];
    json(
      200,
      all.filter((t) => t.name.startsWith(prefix)),
    );
    return;
  }
  const file = /^\/file\/(\d+)\.jpg$/.exec(url.pathname);
  if (file) {
    seen.fileReferer = req.headers.referer;
    if (htmlFiles) {
      res.writeHead(200, { 'Content-Type': 'image/jpeg' });
      res.end('<!DOCTYPE html><html><body>Hotlinking not allowed</body></html>');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': JPEG.length });
    res.end(JPEG);
    return;
  }
  const thumb = /^\/thumb\/(\d+)\.jpg$/.exec(url.pathname);
  if (thumb) {
    seen.thumbs.push(Number(thumb[1]));
    res.writeHead(200, { 'Content-Type': 'image/jpeg' });
    res.end(JPEG);
    return;
  }
  json(404, { message: 'not found' });
}

let app: FastifyInstance;
let cookie = '';
let siteId = '';

async function call(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) {
  return app.inject({
    method,
    url,
    headers: { cookie },
    ...(payload !== undefined && { payload: payload as Record<string, unknown> }),
  });
}

async function search(body: Record<string, unknown>): Promise<BooruSearchResponse> {
  const res = await call('POST', `/api/booru/${siteId}/search`, body);
  expect(res.statusCode, res.body).toBe(200);
  return res.json<BooruSearchResponse>();
}

beforeAll(async () => {
  server = createServer(handle);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no address');
  base = `http://127.0.0.1:${address.port}`;
  app = await testApp({ CONBERT_BOORU_ALLOW_PRIVATE: '1' });
  cookie = await setupAdmin(app);
  const res = await call('POST', '/api/booru/instances', {
    name: 'Fake',
    api: 'danbooru',
    baseUrl: `${base}/`,
  });
  expect(res.statusCode, res.body).toBe(201);
  siteId = res.json<{ site: BooruSite }>().site.id;
});

afterAll(async () => {
  await app.close();
  await new Promise((r) => server.close(r));
});

describe('booru search', () => {
  it('lists the built-in sites and the own instance', async () => {
    const res = await call('GET', '/api/booru/sites');
    const sites = res.json<{ sites: BooruSite[] }>().sites;
    const ids = sites.map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(['safebooru', 'konachan', siteId]));
    // Blocked by Cloudflare, so taken out of the list.
    expect(ids).not.toContain('danbooru');
    expect(ids).not.toContain('e621');
    expect(sites.find((s) => s.id === 'gelbooru')?.needsAccount).toBe(true);
    expect(sites.find((s) => s.id === siteId)).toMatchObject({ custom: true, tagLimit: 2 });
  });

  it('shows only general posts that pass the protection, the blacklist and have a file', async () => {
    const result = await search({ query: 'cat_ears' });
    expect(result.posts.map((p) => p.id)).toEqual([10, 5, 3]);
    expect(result.hidden).toEqual({
      protected: 2,
      rating: 1,
      blacklist: 1,
      unavailable: 1,
      filter: 0,
    });
    // Rating narrowed at the site (free on Danbooru), honest User-Agent.
    expect(seen.tags).toEqual(['cat_ears', 'rating:g']);
    expect(seen.userAgent).toMatch(/^Conbert\/\S+ \(self-hosted file converter/);
    expect(result.next).toEqual({ before: 3 });
  });

  it('never fetches thumbnails of hidden posts', async () => {
    const result = await search({ query: 'cat_ears' });
    seen.thumbs = [];
    for (const post of result.posts) {
      const res = await call('GET', `/api/booru/thumbs/${post.thumb}`);
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('image/jpeg');
    }
    expect(seen.thumbs.sort()).toEqual([10, 3, 5].sort());
    const unknown = await call('GET', `/api/booru/thumbs/${crypto.randomUUID()}`);
    expect(unknown.statusCode).toBe(404);
  });

  it('refuses searches for blocked content before asking the site', async () => {
    seen.tags = [];
    const res = await call('POST', `/api/booru/${siteId}/search`, { query: 'loli' });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: { code: 'BOORU_QUERY_REFUSED' } });
    expect(seen.tags).toEqual([]);
  });

  it('sends the rarest tags within the limit and checks the others itself', async () => {
    // Counts come from the autocomplete (cached) or are looked up.
    const result = await search({ query: 'cat_ears blue_eyes red_hair' });
    expect(seen.tags).toEqual(['red_hair', 'blue_eyes', 'rating:g']);
    expect(result.plan.localOnly).toEqual(['cat_ears']);
    expect(result.plan.estimate).toBe(5);
    expect(result.posts.map((p) => p.id)).toEqual([3]);
  });

  it('never suggests blocked tags', async () => {
    const res = await call('GET', `/api/booru/${siteId}/autocomplete?q=`);
    expect(res.json()).toEqual({ tags: [] });
    const all = await call('GET', `/api/booru/${siteId}/autocomplete?q=l`);
    expect(all.json<{ tags: unknown[] }>().tags).toEqual([]);
    const cat = await call('GET', `/api/booru/${siteId}/autocomplete?q=cat`);
    expect(cat.json()).toEqual({
      tags: [
        { name: 'cat_ears', count: 500, category: 'general' },
        { name: 'cat_tail', count: 20, category: 'general' },
      ],
    });
  });

  it('loads single posts by ID (from a link)', async () => {
    const result = await search({ ids: [10, 9] });
    expect(result.posts.map((p) => p.id)).toEqual([10]);
    expect(result.hidden.protected).toBe(1);
    expect(result.next).toBeNull();
  });

  it('waits when the site says "too many requests"', async () => {
    rateLimitOnce = true;
    const result = await search({ query: 'blue_eyes' });
    expect(result.posts.map((p) => p.id)).toEqual([10, 3]);
  });

  it('refuses removed sites', async () => {
    const res = await call('POST', '/api/booru/danbooru/search', { query: 'cat_ears' });
    expect(res.statusCode).toBe(404);
    expect(res.body).toContain('errors.booruSiteUnknown');
  });

  it('reads post links of known sites', async () => {
    const res = await call('POST', '/api/booru/resolve', {
      url: 'https://konachan.com/post/show/12345/blue_eyes',
    });
    expect(res.json()).toEqual({ siteId: 'konachan', postId: 12345 });
    const own = await call('POST', '/api/booru/resolve', { url: `${base}/posts/7` });
    expect(own.json()).toEqual({ siteId, postId: 7 });
  });
});

describe('booru settings', () => {
  it('needs the age confirmation for more than general content', async () => {
    const refused = await call('PUT', '/api/booru/settings', { ratings: ['general', 'explicit'] });
    expect(refused.statusCode).toBe(422);
    expect(refused.json()).toMatchObject({ error: { code: 'BOORU_AGE_REQUIRED' } });
    const ok = await call('PUT', '/api/booru/settings', {
      ratings: ['general', 'explicit'],
      ageConfirmed: true,
      blacklist: [],
    });
    expect(ok.json()).toMatchObject({ settings: { ratings: ['general', 'explicit'] } });
    const result = await search({ query: 'cat_ears' });
    // Explicit and the gore post are visible now – the protected ones never.
    expect(result.posts.map((p) => p.id)).toEqual([10, 8, 7, 5, 3]);
    expect(result.hidden.protected).toBe(2);
    expect(seen.tags).toEqual(['cat_ears', 'rating:g,e']);
  });

  it('locks the rating choice with a PIN', async () => {
    const lock = await call('POST', '/api/booru/settings/lock', { pin: '1234' });
    expect(lock.json()).toMatchObject({ settings: { locked: true } });
    const noPin = await call('PUT', '/api/booru/settings', { ratings: ['general'] });
    expect(noPin.statusCode).toBe(403);
    const wrong = await call('PUT', '/api/booru/settings', { ratings: ['general'], pin: '0000' });
    expect(wrong.statusCode).toBe(403);
    // Other settings don't need the PIN.
    const names = await call('PUT', '/api/booru/settings', { filePattern: '{md5}.{ext}' });
    expect(names.statusCode).toBe(200);
    const right = await call('PUT', '/api/booru/settings', {
      ratings: ['general'],
      ageConfirmed: false,
      pin: '1234',
    });
    expect(right.json()).toMatchObject({
      settings: { ratings: ['general'], ageConfirmed: false, filePattern: '{md5}.{ext}' },
    });
    const unlock = await call('DELETE', '/api/booru/settings/lock', { pin: '1234' });
    expect(unlock.json()).toMatchObject({ settings: { locked: false } });
  });

  it('lets an administrator remove a forgotten PIN', async () => {
    await call('POST', '/api/booru/settings/lock', { pin: '4321' });
    const list = await call('GET', '/api/users');
    const [me] = list.json<{ users: { id: string; booruPin: boolean }[] }>().users;
    expect(me?.booruPin).toBe(true);
    const reset = await call('DELETE', `/api/users/${me?.id}/booru-pin`);
    expect(reset.statusCode).toBe(204);
    const settings = await call('GET', '/api/booru/settings');
    expect(settings.json()).toMatchObject({ settings: { locked: false } });
    const after = await call('GET', '/api/users');
    expect(after.json<{ users: { booruPin: boolean }[] }>().users[0]?.booruPin).toBe(false);
  });

  it('stores the API key encrypted and never sends it back', async () => {
    const res = await call('PUT', `/api/booru/accounts/${siteId}`, {
      username: 'me',
      apiKey: 'secret-key-123',
      tagLimit: 6,
    });
    expect(res.statusCode).toBe(204);
    const sites = await call('GET', '/api/booru/sites');
    expect(sites.body).not.toContain('secret-key-123');
    expect(sites.json<{ sites: BooruSite[] }>().sites.find((s) => s.id === siteId)).toMatchObject({
      account: { username: 'me', tagLimit: 6 },
      tagLimit: 6,
    });
    await search({ query: 'blue_eyes' });
    expect(seen.auth).toBe(`Basic ${Buffer.from('me:secret-key-123').toString('base64')}`);
    expect(seen.userAgent).toContain('by me on Fake');
    await call('DELETE', `/api/booru/accounts/${siteId}`);
  });

  it('wants the numeric user ID for Gelbooru and splits a pasted access line', async () => {
    const byName = await call('PUT', '/api/booru/accounts/gelbooru', {
      username: 'me',
      apiKey: 'k3y',
    });
    expect(byName.statusCode).toBe(422);
    expect(byName.body).toContain('errors.booruUserIdInvalid');
    const pasted = await call('PUT', '/api/booru/accounts/gelbooru', {
      username: 'me',
      apiKey: '&api_key=k3yABC&user_id=4242',
    });
    expect(pasted.statusCode).toBe(204);
    const sites = await call('GET', '/api/booru/sites');
    expect(sites.body).not.toContain('k3yABC');
    expect(
      sites.json<{ sites: BooruSite[] }>().sites.find((s) => s.id === 'gelbooru'),
    ).toMatchObject({ account: { username: '4242' } });
    await call('DELETE', '/api/booru/accounts/gelbooru');
  });

  it('refuses home-network instances unless the admin allows them', async () => {
    const strict = await testApp();
    const admin = await setupAdmin(strict);
    const res = await strict.inject({
      method: 'POST',
      url: '/api/booru/instances',
      headers: { cookie: admin },
      payload: { name: 'LAN', api: 'danbooru', baseUrl: 'http://192.168.1.5' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: { code: 'BOORU_INSTANCE_INVALID' } });
    const gelbooru = await strict.inject({
      method: 'POST',
      url: '/api/booru/gelbooru/search',
      headers: { cookie: admin },
      payload: { query: 'cat_ears' },
    });
    expect(gelbooru.json()).toMatchObject({ error: { code: 'BOORU_NEEDS_ACCOUNT' } });
    await strict.close();
  });
});

describe('booru crawls', () => {
  const idle = () => (app.conbert.booru.queue as unknown as { idle(): Promise<void> }).idle();

  async function crawl(body: Record<string, unknown>): Promise<BooruJobDto> {
    const res = await call('POST', `/api/booru/${siteId}/jobs`, { toList: true, ...body });
    expect(res.statusCode, res.body).toBe(201);
    await idle();
    const id = res.json<{ job: BooruJobDto }>().job.id;
    return (await call('GET', `/api/booru/jobs/${id}`)).json<{ job: BooruJobDto }>().job;
  }

  it('loads chosen posts – checked again, protected ones never', async () => {
    const job = await crawl({ postIds: [10, 9] });
    expect(job).toMatchObject({ status: 'done', downloaded: 1, scanned: 2 });
    expect(job.hidden.protected).toBe(1);
    const files = await call('GET', `/api/booru/jobs/${job.id}/files`);
    expect(files.json<{ files: { postId: number; name: string }[] }>().files).toEqual([
      // The settings test before switched the name pattern to {md5}.{ext}.
      expect.objectContaining({ postId: 10, name: 'md5-10.jpg' }),
    ]);
  });

  it('crawls a search, skips what was loaded before, and refuses blocked searches', async () => {
    const job = await crawl({ query: 'cat_ears', speed: 'normal' });
    expect(job).toMatchObject({ status: 'done', downloaded: 3, duplicates: 1, matched: 3 });
    expect(job.hidden).toMatchObject({ protected: 2, rating: 1, unavailable: 1 });
    expect(job.recent.map((f) => f.postId).sort()).toEqual([3, 5, 7]);
    const again = await crawl({ query: 'cat_ears' });
    expect(again).toMatchObject({ status: 'done', downloaded: 0, duplicates: 4 });
    const refused = await call('POST', `/api/booru/${siteId}/jobs`, {
      toList: true,
      query: 'shota',
    });
    expect(refused.statusCode).toBe(422);
  });

  it('sends the site as Referer and never keeps an error page as a picture', async () => {
    htmlFiles = true;
    const broken = await crawl({ postIds: [2] });
    htmlFiles = false;
    expect(broken).toMatchObject({ status: 'done', downloaded: 0, failed: 1 });
    expect(seen.fileReferer).toBe(`${base}/`);
    // The failed post isn't in the duplicate archive, so it loads next time.
    const fixed = await crawl({ postIds: [2] });
    expect(fixed).toMatchObject({ downloaded: 1, failed: 0 });
  });

  it('waits for the night window', async () => {
    const hour = new Date().getHours();
    const job = await crawl({
      query: 'blue_eyes',
      window: { fromHour: (hour + 2) % 24, toHour: (hour + 3) % 24 },
    });
    expect(job.status).toBe('waiting');
    expect(job.resumeAt).not.toBeNull();
    const paused = await call('POST', `/api/booru/jobs/${job.id}/pause`);
    expect(paused.json<{ job: BooruJobDto }>().job.status).toBe('paused');
    const removed = await call('DELETE', `/api/booru/jobs/${job.id}`);
    expect(removed.statusCode).toBe(200);
    expect((await call('GET', `/api/booru/jobs/${job.id}`)).statusCode).toBe(404);
  });

  it('needs a destination', async () => {
    const res = await call('POST', `/api/booru/${siteId}/jobs`, { query: 'a', toList: false });
    expect(res.statusCode).toBe(400);
  });
});

describe('booru subscriptions', () => {
  const idle = () => (app.conbert.booru.queue as unknown as { idle(): Promise<void> }).idle();

  it('loads only posts that are new since the last check', async () => {
    const created = await call('POST', '/api/subscriptions', {
      siteId,
      query: 'red_hair',
      intervalHours: 24,
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json<{ subscription: SubscriptionDto }>().subscription.id;
    const first = await call('POST', `/api/subscriptions/${id}/check`);
    expect(first.json()).toMatchObject({ started: true });
    await idle();
    let sub = (await call('GET', '/api/subscriptions'))
      .json<{ subscriptions: SubscriptionDto[] }>()
      .subscriptions.find((s) => s.id === id);
    // Post 3 was loaded by an earlier crawl: nothing new, but it is now "seen".
    expect(sub).toMatchObject({ lastNew: 0, lastError: null });
    expect(sub?.lastCheckAt).not.toBeNull();

    POSTS.unshift({ id: 11, rating: 'g', tags: ['red_hair', 'cat_ears'] });
    await call('POST', `/api/subscriptions/${id}/check`);
    await idle();
    sub = (await call('GET', '/api/subscriptions'))
      .json<{ subscriptions: SubscriptionDto[] }>()
      .subscriptions.find((s) => s.id === id);
    expect(sub).toMatchObject({ lastNew: 1, totalLoaded: 1 });
    const jobs = (await call('GET', '/api/booru/jobs')).json<{ jobs: BooruJobDto[] }>().jobs;
    const latest = jobs.find((j) => j.subscriptionId === id);
    // It stopped at the post it had seen before.
    expect(latest).toMatchObject({ downloaded: 1, scanned: 1 });
  });

  it('refuses blocked searches as subscriptions', async () => {
    const res = await call('POST', '/api/subscriptions', { siteId, query: 'cat_ears shota' });
    expect(res.statusCode).toBe(422);
  });
});

// --- Reading the answers of the real APIs (shapes as of 2026-10) ---

function adapterWith(site: BooruSiteInfo | undefined, body: unknown) {
  if (!site) throw new Error('site');
  return createAdapter(site, null, async () => body);
}

describe('booru adapters', () => {
  it('reads Safebooru (array, file URLs given)', async () => {
    const posts = await adapterWith(builtinSite('safebooru'), [
      {
        preview_url: 'https://safebooru.org/thumbnails/4438/thumbnail_a5e9.jpg',
        file_url: 'https://safebooru.org/images/4438/a5e9.jpg',
        directory: 4438,
        hash: '79b7',
        width: 1718,
        height: 2047,
        id: 7272627,
        image: 'a5e9.jpg',
        change: 1793219424,
        rating: 'general',
        sample: true,
        score: null,
        tags: '1boy cat_ears',
      },
    ]).list({ tags: ['cat_ears'], limit: 1 });
    expect(posts[0]).toMatchObject({
      id: 7272627,
      md5: '79b7',
      rating: 'general',
      ext: 'jpg',
      tags: ['1boy', 'cat_ears'],
      fileUrl: 'https://safebooru.org/images/4438/a5e9.jpg',
      sampleUrl: 'https://safebooru.org/samples/4438/sample_a5e9.jpg',
      postUrl: 'https://safebooru.org/index.php?page=post&s=view&id=7272627',
    });
    expect(posts[0]?.createdAt).toMatch(/^2026-/);
  });

  it('reads Gelbooru ({ post: [...] }) and old XML answers', async () => {
    const json = await adapterWith(builtinSite('gelbooru'), {
      '@attributes': { limit: 1, offset: 0, count: 1 },
      post: [{ id: 5, md5: 'x', rating: 'explicit', tags: 'a b', file_url: 'https://g/x.png' }],
    }).list({ tags: [], limit: 1 });
    expect(json[0]).toMatchObject({ id: 5, rating: 'explicit', ext: 'png' });
    const xml = await adapterWith(builtinSite('gelbooru'), {
      xml: '<posts count="1"><post id="6" md5="y" rating="s" tags=" a b " file_url="https://g/y.jpg"/></posts>',
    }).list({ tags: [], limit: 1 });
    expect(xml[0]).toMatchObject({ id: 6, md5: 'y', rating: 'general', tags: ['a', 'b'] });
  });

  it('reads e621 (tag groups) without fake artists', async () => {
    const posts = await adapterWith(retiredSite('e926'), {
      posts: [
        {
          id: 6815302,
          created_at: '2026-10-28T15:50:12.703-04:00',
          file: {
            width: 691,
            height: 652,
            ext: 'jpg',
            size: 59980,
            md5: '7d5b',
            url: 'https://static1.e926.net/data/7d.jpg',
          },
          preview: { url: 'https://static1.e926.net/data/preview/7d.jpg' },
          sample: { has: false, url: null },
          score: { total: 1 },
          tags: {
            general: ['anthro'],
            artist: ['funnysillydog', 'conditional_dnp'],
            character: ['pip'],
            copyright: [],
            species: ['cat'],
          },
          rating: 's',
          fav_count: 1,
          sources: ['https://bsky.app/x'],
        },
      ],
    }).list({ tags: ['cat'], limit: 1 });
    expect(posts[0]).toMatchObject({
      id: 6815302,
      md5: '7d5b',
      rating: 'general',
      artists: ['funnysillydog'],
      characters: ['pip'],
      score: 1,
      sampleUrl: null,
      source: 'https://bsky.app/x',
    });
    expect(posts[0]?.tags).toEqual(
      expect.arrayContaining(['anthro', 'funnysillydog', 'conditional_dnp', 'pip', 'cat']),
    );
  });

  it('reads Moebooru (Unix times)', async () => {
    const posts = await adapterWith(builtinSite('yandere'), [
      {
        id: 1271442,
        tags: 'animal_ears nekomimi',
        created_at: 1793052401,
        md5: '1a0f',
        file_size: 9479935,
        file_ext: 'png',
        file_url: 'https://files.yande.re/image/1a0f/x.png',
        preview_url: 'https://assets.yande.re/data/preview/1a/0f/1a0f.jpg',
        sample_url: 'https://files.yande.re/sample/1a0f/x.jpg',
        rating: 's',
        score: 18,
        width: 2894,
        height: 4093,
      },
    ]).list({ tags: [], limit: 1 });
    expect(posts[0]).toMatchObject({
      id: 1271442,
      rating: 'general',
      ext: 'png',
      size: 9479935,
      createdAt: new Date(1793052401 * 1000).toISOString(),
      postUrl: 'https://yande.re/post/show/1271442',
    });
  });

  it('reads Gelbooru and Safebooru tag suggestions', async () => {
    const modern = await adapterWith(builtinSite('gelbooru'), [
      { type: 'tag', label: 'cat ears', value: 'cat_ears', post_count: '441186', category: 'tag' },
      { type: 'tag', label: 'x', value: 'some_artist', post_count: '3', category: 'artist' },
    ]).autocomplete('cat');
    expect(modern).toEqual([
      { name: 'cat_ears', count: 441186, category: 'general' },
      { name: 'some_artist', count: 3, category: 'artist' },
    ]);
    let call = 0;
    const safebooru = builtinSite('safebooru');
    if (!safebooru) throw new Error('site');
    const old = await createAdapter(safebooru, null, async () =>
      call++ === 0 ? [] : [{ label: 'cat_ears (205379)', value: 'cat_ears' }],
    ).autocomplete('cat');
    expect(old).toEqual([{ name: 'cat_ears', count: 205379, category: 'general' }]);
  });
});

describe('booru texts', () => {
  it('every rating, order, speed and site has its help text', () => {
    expect(findMissingKeys(booruI18nKeys())).toEqual([]);
  });
});

describe('booru metadata', () => {
  const post = {
    id: 1,
    md5: 'm',
    rating: 'general' as const,
    tags: ['blue_eyes', '-dash_tag'],
    artists: ['painter'],
    characters: [],
    copyrights: [],
    score: 1,
    favorites: null,
    width: 1,
    height: 1,
    ext: 'jpg',
    size: 1,
    createdAt: null,
    fileUrl: 'https://x/f.jpg',
    sampleUrl: null,
    previewUrl: null,
    source: 'https://artist.example/1',
    postUrl: 'https://danbooru.donmai.us/posts/1',
  };

  it('always writes source and artist, keywords only on request, the file last', () => {
    const plain = exiftoolArgs(post, '/tmp/a.jpg', false);
    expect(plain).toContain('-XMP-dc:Source=https://artist.example/1');
    expect(plain).toContain('-XMP-dc:Creator=painter');
    expect(plain.some((a) => a.startsWith('-XMP-dc:Subject'))).toBe(false);
    expect(plain.slice(-2)).toEqual(['--', '/tmp/a.jpg']);
    const tagged = exiftoolArgs(post, '/tmp/a.jpg', true);
    expect(tagged).toContain('-XMP-dc:Subject=-dash_tag');
    expect(tagged).toContain('-IPTC:Keywords=blue_eyes');
  });

  it('writes sidecar files', () => {
    expect(sidecarContent('txt', post, 'danbooru')).toBe('blue eyes, -dash tag\n');
    expect(JSON.parse(sidecarContent('json', post, 'danbooru'))).toMatchObject({
      site: 'danbooru',
      id: 1,
      artists: ['painter'],
      source: 'https://artist.example/1',
    });
  });
});
