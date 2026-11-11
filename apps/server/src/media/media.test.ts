import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import type {
  MediaStatus,
  ReorganizePlan,
  SwipeItem,
  SwipeSource,
  SwipeState,
} from '@conbert/schemas';
import { booruArchive, downloads, mediaItems, users } from '../db/schema';
import { exportFile } from '../targets/export';
import { hasCommand, setupAdmin, testApp } from '../test/helpers';

const hasRclone = hasCommand('rclone', ['version']);

let app: FastifyInstance;
let cookie: string;
let dataDir: string;
let storage: string;
let targetId: string;

const api = (method: 'GET' | 'POST', url: string, payload?: unknown) =>
  app.inject({
    method,
    url,
    headers: { cookie },
    ...(payload !== undefined && { payload: payload as Record<string, unknown> }),
  });

const userId = () => app.conbert.db.select({ id: users.id }).from(users).get()?.id ?? '';

/** A file on the "NAS" (the test storage folder). */
function put(rel: string, content = rel): void {
  const full = path.join(storage, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content);
}
const there = (rel: string) => existsSync(path.join(storage, rel));

async function sync(): Promise<MediaStatus> {
  await api('POST', '/api/media/sync');
  for (let i = 0; i < 100; i++) {
    const status = (await api('GET', '/api/media/status')).json<MediaStatus>();
    if (!status.syncing) return status;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('sync did not finish');
}

async function next(query = ''): Promise<SwipeItem[]> {
  const res = await api('GET', `/api/swipe/next?count=20${query}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json<{ items: SwipeItem[] }>().items;
}

async function swipe(item: SwipeItem | undefined, action: string): Promise<SwipeState> {
  const res = await api('POST', '/api/swipe/action', { itemId: item?.id, action });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<SwipeState>();
}

const byName = (items: SwipeItem[], name: string) => items.find((i) => i.name === name);

describe.skipIf(!hasRclone)('swipe game (real rclone)', () => {
  beforeEach(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), 'conbert-media-'));
    storage = path.join(dataDir, 'storage');
    mkdirSync(storage);
    app = await testApp({ CONBERT_DATA_DIR: dataDir, CONBERT_STORAGE_ROOTS: storage });
    cookie = await setupAdmin(app);
    const created = await api('POST', '/api/targets', {
      name: 'NAS',
      type: 'local',
      basePath: '',
      isDefault: true,
      usage: { asTarget: true, asSource: true },
      settings: { root: storage },
    });
    targetId = created.json<{ target: { id: string } }>().target.id;
  });

  afterEach(async () => {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('the sync only adds and remembers what was downloaded', async () => {
    put('Instagram/KawaiiQueen/1.jpg');
    put('YouTube/NASA/Moon [dQw4w9WgXcQ].mp4');
    put('Gelbooru/ear_blowing/gelbooru_4711_artist.png');
    put('Gelbooru/ear_blowing/gelbooru_4711_artist.png.txt', 'tags');
    put('Instagram/KawaiiQueen/.cache/gallery-dl/cache.sqlite3');
    const first = await sync();
    expect(first).toMatchObject({ items: 3, unsorted: 3, problem: null });
    // yt-dlp and the booru archive now know these items.
    const archive = readFileSync(
      path.join(dataDir, 'archives', userId(), 'yt-dlp-youtube.txt'),
      'utf8',
    );
    expect(archive).toContain('youtube dQw4w9WgXcQ');
    expect(app.conbert.db.select().from(booruArchive).all()).toMatchObject([
      { siteId: 'gelbooru', postId: 4711 },
    ]);
    // A file deleted by hand counts as deleted: no longer swiped, still known.
    rmSync(path.join(storage, 'Instagram/KawaiiQueen/1.jpg'));
    put('Instagram/KawaiiQueen/2.jpg');
    const second = await sync();
    expect(second.items).toBe(3);
    const sources = (await api('GET', '/api/swipe/sources')).json<{ sources: SwipeSource[] }>();
    expect(sources.sources.map((s) => `${s.name}:${String(s.count)}`)).toEqual([
      'Gelbooru:1',
      'Instagram:1',
      'YouTube:1',
    ]);
    expect((await next()).map((i) => i.name)).not.toContain('1.jpg');
    const gone = app.conbert.db.select().from(mediaItems).where(eq(mediaItems.name, '1.jpg')).get();
    expect(gone?.status).toBe('deleted');
  });

  it('swipes with five steps to take back, then carries out', async () => {
    for (const n of [1, 2, 3, 4, 5, 6, 7]) put(`Instagram/KawaiiQueen/${String(n)}.jpg`);
    put('Gelbooru/ear_blowing/x.png');
    await sync();
    const items = await next(`&folders=${encodeURIComponent('["Instagram/KawaiiQueen"]')}`);
    expect(items).toHaveLength(7);
    const card = (n: number) => byName(items, `${String(n)}.jpg`);
    expect((await swipe(card(1), 'delete')).pending).toBe(1);
    await swipe(card(2), 'favorite');
    await swipe(card(3), 'keep');
    await swipe(card(4), 'delete');
    await swipe(card(5), 'keep');
    // Nothing happened yet: everything can still be taken back.
    expect(there('Instagram/KawaiiQueen/1.jpg')).toBe(true);
    const sixth = await swipe(card(6), 'keep');
    expect(sixth.pending).toBe(5);
    expect(sixth.done).toMatchObject([{ name: '1.jpg', action: 'delete', ok: true }]);
    expect(there('Instagram/KawaiiQueen/1.jpg')).toBe(false);
    // Undo the newest; the deletion of 4.jpg is still pending and can be undone too.
    await api('POST', '/api/swipe/undo');
    await api('POST', '/api/swipe/undo');
    const undone = (await api('POST', '/api/swipe/undo')).json<{ item: SwipeItem }>();
    expect(undone.item.name).toBe('4.jpg');
    const flushed = (await api('POST', '/api/swipe/flush')).json<SwipeState>();
    expect(flushed.done.map((d) => `${d.name}:${d.action}`)).toEqual([
      '2.jpg:favorite',
      '3.jpg:keep',
    ]);
    expect(there('Instagram/KawaiiQueen/4.jpg')).toBe(true);
    expect(there('Favoriten/Instagram/KawaiiQueen/2.jpg')).toBe(true);
    expect(there('Instagram/KawaiiQueen/2.jpg')).toBe(false);
    // Taken back (4, 5, 6) and never swiped (7) come again; kept, deleted and favoured ones don't.
    const left = (await next()).map((i) => i.name).sort();
    expect(left).toEqual(['4.jpg', '5.jpg', '6.jpg', '7.jpg', 'x.png']);
  });

  it('favourites: premium keeps the structure, a left swipe moves back', async () => {
    put('Gelbooru/ear_blowing/a.png');
    await sync();
    await swipe((await next())[0], 'favorite');
    await api('POST', '/api/swipe/flush');
    const fav = await next('&mode=favorites');
    expect(fav).toMatchObject([
      { path: 'Favoriten/Gelbooru/ear_blowing/a.png', status: 'favorite' },
    ]);
    await swipe(fav[0], 'premium');
    await api('POST', '/api/swipe/flush');
    expect(there('Favoriten/Premium/Gelbooru/ear_blowing/a.png')).toBe(true);
    // Premium cards stay in the favourites' pile.
    const premium = await next('&mode=favorites');
    expect(premium).toMatchObject([{ status: 'premium' }]);
    await swipe(premium[0], 'unfavorite');
    await api('POST', '/api/swipe/flush');
    expect(there('Gelbooru/ear_blowing/a.png')).toBe(true);
    expect(there('Favoriten')).toBe(false);
    // Moved back counts as sorted: it doesn't come again.
    expect(await next()).toEqual([]);
    expect(await next('&sorted=1')).toHaveLength(1);
  });

  it('favourites never run out: after every card was seen, a new round starts', async () => {
    for (const n of ['a', 'b', 'c']) put(`Favoriten/Instagram/KawaiiQueen/${n}.jpg`);
    await sync();
    const round = async (query = '') => {
      const res = await api('GET', `/api/swipe/next?count=20&mode=favorites${query}`);
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json<{ items: SwipeItem[]; newRound: boolean }>();
      return {
        names: body.items.map((i) => i.name).sort(),
        newRound: body.newRound,
        items: body.items,
      };
    };
    const first = await round();
    expect(first).toMatchObject({ names: ['a.jpg', 'b.jpg', 'c.jpg'], newRound: false });
    // Seen in this round: a doesn't come again until the others were shown.
    await swipe(byName(first.items, 'a.jpg'), 'keep');
    await api('POST', '/api/swipe/flush');
    const second = await round();
    expect(second).toMatchObject({ names: ['b.jpg', 'c.jpg'], newRound: false });
    await swipe(byName(second.items, 'b.jpg'), 'keep');
    // Premium counts as seen too (it is moved, but stays in the favourites).
    await swipe(byName(second.items, 'c.jpg'), 'premium');
    await api('POST', '/api/swipe/flush');
    expect(there('Favoriten/Premium/Instagram/KawaiiQueen/c.jpg')).toBe(true);
    // All seen: everything comes again, freshly shuffled.
    const third = await round();
    expect(third).toMatchObject({ names: ['a.jpg', 'b.jpg', 'c.jpg'], newRound: true });
    await swipe(byName(third.items, 'b.jpg'), 'keep');
    await api('POST', '/api/swipe/flush');
    expect((await round()).names).toEqual(['a.jpg', 'c.jpg']);
    // "Show sorted" ignores the rounds; the normal pile is untouched.
    expect((await round('&sorted=1')).names).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
    expect(await next()).toEqual([]);
  });

  it('a deleted or favoured file is never saved again by a download', async () => {
    put('Instagram/KawaiiQueen/post.jpg', 'same picture');
    put('Instagram/KawaiiQueen/fav.jpg', 'favourite picture');
    await sync();
    const items = await next();
    await swipe(byName(items, 'post.jpg'), 'delete');
    await swipe(byName(items, 'fav.jpg'), 'favorite');
    await api('POST', '/api/swipe/flush');
    expect(there('Instagram/KawaiiQueen/post.jpg')).toBe(false);
    const save = async (name: string, content: string) => {
      const file = path.join(dataDir, name);
      writeFileSync(file, content);
      return exportFile(
        app.conbert,
        userId(),
        { filePath: file, name, ext: 'jpg' },
        { targetIds: [targetId] },
        { platformFolder: 'Instagram', source: 'KawaiiQueen', sameFileSkips: true },
      );
    };
    expect((await save('post.jpg', 'same picture'))[0]?.status).toBe('skipped');
    // Same content under another name: recognised by its fingerprint.
    expect((await save('renamed.jpg', 'same picture'))[0]?.status).toBe('skipped');
    expect((await save('fav.jpg', 'favourite picture'))[0]?.status).toBe('skipped');
    expect(there('Instagram/KawaiiQueen/post.jpg')).toBe(false);
    expect(there('Instagram/KawaiiQueen/fav.jpg')).toBe(false);
    // Something new is saved – and indexed right away.
    expect((await save('new.jpg', 'brand new'))[0]?.status).toBe('saved');
    expect(
      app.conbert.db.select().from(mediaItems).where(eq(mediaItems.name, 'new.jpg')).get(),
    ).toMatchObject({ path: 'Instagram/KawaiiQueen/new.jpg', status: 'present' });
  });

  it('tidies old root folders into platform folders after a preview', async () => {
    app.conbert.db
      .insert(downloads)
      .values({
        id: 'd1',
        userId: userId(),
        url: 'https://www.instagram.com/kawaiiqueen/',
        platform: 'instagram',
        tool: 'gallery-dl',
        kind: 'profile',
        options: { sourceName: 'KawaiiQueen' },
        files: [],
      })
      .run();
    put('KawaiiQueen/1.jpg');
    put('KawaiiQueen/cache.sqlite3');
    put('gelbooru/tag/gelbooru_1_x.png');
    put('Urlaub/strand.jpg');
    await sync();
    const plan = (await api('GET', '/api/media/reorganize')).json<ReorganizePlan>();
    expect(plan.moves).toEqual(
      expect.arrayContaining([
        { from: 'KawaiiQueen', to: 'Instagram/KawaiiQueen', reason: 'download' },
        { from: 'gelbooru', to: 'Gelbooru', reason: 'booru' },
      ]),
    );
    expect(plan.unknown).toEqual(['Urlaub']);
    expect(plan.leftovers).toEqual(['KawaiiQueen/cache.sqlite3']);
    const done = await api('POST', '/api/media/reorganize', {
      moves: plan.moves.map(({ from, to }) => ({ from, to })),
      leftovers: plan.leftovers,
    });
    expect(done.json()).toMatchObject({ moved: 2, deleted: 1, failed: [] });
    expect(there('Instagram/KawaiiQueen/1.jpg')).toBe(true);
    expect(there('Instagram/KawaiiQueen/cache.sqlite3')).toBe(false);
    expect(there('Gelbooru/tag/gelbooru_1_x.png')).toBe(true);
    expect(there('Urlaub/strand.jpg')).toBe(true);
    // The index moved along: the cards still open.
    const paths = (await next()).map((i) => i.path).sort();
    expect(paths).toEqual([
      'Gelbooru/tag/gelbooru_1_x.png',
      'Instagram/KawaiiQueen/1.jpg',
      'Urlaub/strand.jpg',
    ]);
  });

  it('holding X deletes every page of a Pixiv work, nothing else', async () => {
    put('Pixiv/x/42/42_p0.jpg');
    put('Pixiv/x/42/42_p1.jpg');
    put('Pixiv/x/42/42_p2.jpg');
    put('Pixiv/x/421_p0.jpg');
    await sync();
    const first = byName(await next(), '42_p0.jpg');
    const state = await swipe(first, 'deletePost');
    expect(state.pending).toBe(1);
    // The other pages wait for the same decision: no cards for them any more.
    expect((await next()).map((i) => i.name)).toEqual(['421_p0.jpg']);
    const flushed = (await api('POST', '/api/swipe/flush')).json<SwipeState>();
    expect(flushed.done.filter((d) => d.ok && d.action === 'delete')).toHaveLength(3);
    expect(there('Pixiv/x/42/42_p0.jpg')).toBe(false);
    expect(there('Pixiv/x/42/42_p2.jpg')).toBe(false);
    expect(there('Pixiv/x/421_p0.jpg')).toBe(true);
  });

  it('tidying up gives loose Pixiv works with several pages their own folder', async () => {
    put('Pixiv/y/7_p0.png');
    put('Pixiv/y/7_p1.png');
    put('Pixiv/y/8_p0.png');
    put('Pixiv/y/9/9_p0.png');
    put('Pixiv/y/9/9_p1.png');
    put('X/nasa/1790000000000000001_1.jpg');
    put('X/nasa/1790000000000000001_2.jpg');
    put('Gelbooru/sakimichan/gelbooru_4711_sakimichan.png');
    put('Gelbooru/sakimichan/gelbooru_4712_sakimichan.png');
    await sync();
    const plan = (await api('GET', '/api/media/reorganize')).json<ReorganizePlan>();
    expect(plan.posts).toEqual([
      { folder: 'Pixiv/y', id: '7', pages: 2 },
      { folder: 'X/nasa', id: '1790000000000000001', pages: 2 },
    ]);
    const done = await api('POST', '/api/media/reorganize', {
      moves: [],
      leftovers: [],
      posts: [{ folder: 'Pixiv/y', id: '7' }],
    });
    expect(done.json()).toMatchObject({ posts: 1, failed: [] });
    expect(there('Pixiv/y/7/7_p0.png')).toBe(true);
    expect(there('Pixiv/y/7/7_p1.png')).toBe(true);
    expect(there('Pixiv/y/7_p0.png')).toBe(false);
    expect(there('Pixiv/y/8_p0.png')).toBe(true);
    // The index moved along.
    expect((await next()).map((i) => i.path)).toContain('Pixiv/y/7/7_p1.png');
  });

  it('keeps every user to their own cards', async () => {
    put('Instagram/A/1.jpg');
    await sync();
    const [item] = await next();
    const other = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { cookie },
      payload: { username: 'zweite', password: 'ein-langes-passwort', role: 'user' },
    });
    expect(other.statusCode, other.body).toBeLessThan(300);
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'zweite', password: 'ein-langes-passwort' },
    });
    const theirs = login.cookies.find((c) => c.name === 'conbert_session')?.value ?? '';
    const res = await app.inject({
      method: 'POST',
      url: '/api/swipe/action',
      headers: { cookie: `conbert_session=${theirs}` },
      payload: { itemId: item?.id, action: 'delete' },
    });
    expect(res.statusCode).toBe(404);
    const status = await app.inject({
      method: 'GET',
      url: '/api/media/status',
      headers: { cookie: `conbert_session=${theirs}` },
    });
    expect(status.json<MediaStatus>()).toMatchObject({ problem: 'no-default', items: 0 });
  });
});
