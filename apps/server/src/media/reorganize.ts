import { randomUUID } from 'node:crypto';
import { and, eq, ne, sql } from 'drizzle-orm';
import {
  BOORU_SITES,
  FAVORITES_FOLDER,
  PLATFORM_FOLDERS,
  RETIRED_SITES,
  baseName,
  inPixivPost,
  numberedName,
  pixivPostOf,
  platformFolder,
  safeName,
} from '@conbert/core';
import type { ReorganizePlan, ReorganizeResult } from '@conbert/schemas';
import type { AppContext } from '../context';
import { downloadFeeds, downloads, mediaItems } from '../db/schema';
import { feedSourceName } from '../downloader/feeds';
import { HttpError } from '../lib/http-error';
import type { RcloneConnection } from '../targets/rclone';
import { connect, relativePath, resolveRecord } from '../targets/service';
import { storageCall } from '../targets/export';
import { requireDefaultTarget } from './known';

/**
 * Tidying up: download folders from before the platform folders
 * ("KawaiiQueen/") move to "Instagram/KawaiiQueen/". Conbert only suggests
 * what its own download history tells; the user ticks what really moves.
 */

const LEFTOVER = /^cache\.sqlite3(-journal)?$/;

const BOORU_NAMES = new Map(
  [...BOORU_SITES, ...RETIRED_SITES].flatMap((s) => [
    [s.id.toLowerCase(), safeName(s.name)] as const,
    [s.name.toLowerCase(), safeName(s.name)] as const,
  ]),
);

/** Root folders that are already where they belong. */
function settled(): Set<string> {
  return new Set([
    FAVORITES_FOLDER,
    ...Object.values(PLATFORM_FOLDERS),
    ...[...BOORU_SITES, ...RETIRED_SITES].map((s) => safeName(s.name)),
  ]);
}

/** Folder name → platform folder, from the user's downloads and subscriptions. */
function historyFolders(
  ctx: AppContext,
  userId: string,
): Map<string, { to: string; reason: 'download' | 'feed' }> {
  const out = new Map<string, { to: string; reason: 'download' | 'feed' }>();
  const add = (
    source: string | null | undefined,
    platform: string,
    url: string,
    reason: 'download' | 'feed',
  ) => {
    const name = source?.trim() ? safeName(source.trim().slice(0, 80)) : null;
    if (name && !out.has(name)) out.set(name, { to: platformFolder(platform, url), reason });
  };
  for (const row of ctx.db
    .select()
    .from(downloadFeeds)
    .where(eq(downloadFeeds.userId, userId))
    .all()) {
    add(feedSourceName(row), row.platform, row.url, 'feed');
  }
  for (const row of ctx.db
    .select({ platform: downloads.platform, url: downloads.url, options: downloads.options })
    .from(downloads)
    .where(eq(downloads.userId, userId))
    .all()) {
    add(
      (row.options as { sourceName?: string | null }).sourceName,
      row.platform,
      row.url,
      'download',
    );
  }
  return out;
}

/** Index entries of the location that are still there (not deleted). */
function presentItems(ctx: AppContext, targetId: string) {
  return ctx.db
    .select({ id: mediaItems.id, path: mediaItems.path })
    .from(mediaItems)
    .where(and(eq(mediaItems.targetId, targetId), ne(mediaItems.status, 'deleted')))
    .all();
}

/**
 * Pixiv works with at least two pages whose pages lie loose in a folder
 * (downloaded before works got their own folder). From the index – sync first.
 */
function loosePosts(ctx: AppContext, targetId: string): ReorganizePlan['posts'] {
  const groups = new Map<string, { folder: string; id: string; pages: number }>();
  for (const item of presentItems(ctx, targetId)) {
    const post = pixivPostOf(item.path);
    // Already in its own folder ("…/151308310/151308310_p0.jpg").
    if (!post || baseName(post.folder) === post.id) continue;
    const key = `${post.folder}\n${post.id}`;
    const group = groups.get(key) ?? { ...post, pages: 0 };
    group.pages++;
    groups.set(key, group);
  }
  return [...groups.values()]
    .filter((g) => g.pages > 1)
    .sort((a, b) => a.folder.localeCompare(b.folder) || a.id.localeCompare(b.id));
}

export async function planReorganize(ctx: AppContext, userId: string): Promise<ReorganizePlan> {
  const record = requireDefaultTarget(ctx, userId);
  const connection = connect(ctx, resolveRecord(ctx, record));
  const root = await storageCall(() => connection.list(''));
  const done = settled();
  const history = historyFolders(ctx, userId);
  const plan: ReorganizePlan = {
    moves: [],
    unknown: [],
    leftovers: [],
    posts: loosePosts(ctx, record.id),
  };
  for (const entry of root.entries) {
    if (!entry.isDir || done.has(entry.name) || entry.name.startsWith('.')) continue;
    const booru = BOORU_NAMES.get(entry.name.toLowerCase());
    if (booru) {
      // "gelbooru/" from before → "Gelbooru/".
      plan.moves.push({ from: entry.name, to: booru, reason: 'booru' });
      continue;
    }
    const known = history.get(entry.name);
    if (known)
      plan.moves.push({ from: entry.name, to: `${known.to}/${entry.name}`, reason: known.reason });
    else plan.unknown.push(entry.name);
  }
  // gallery-dl's cache landed next to the downloads (fixed now): offer to remove it.
  await storageCall(() =>
    connection.walk(
      '',
      (file) => {
        const name = file.path.slice(file.path.lastIndexOf('/') + 1);
        if (LEFTOVER.test(name)) plan.leftovers.push(file.path);
      },
      4,
    ),
  );
  return plan;
}

/** Moves the index entries along with a folder. */
function movePaths(ctx: AppContext, targetId: string, from: string, to: string): void {
  const prefix = `${from}/`;
  ctx.db
    .update(mediaItems)
    .set({ path: sql`${to} || '/' || substr(${mediaItems.path}, ${prefix.length + 1})` })
    .where(
      and(
        eq(mediaItems.targetId, targetId),
        sql`substr(${mediaItems.path}, 1, ${prefix.length}) = ${prefix}`,
      ),
    )
    .run();
}

/** A folder whose destination exists already: file by file, names kept free. */
async function merge(
  ctx: AppContext,
  targetId: string,
  connection: RcloneConnection,
  from: string,
  to: string,
): Promise<void> {
  const files: string[] = [];
  await connection.walk(from, (f) => files.push(f.path));
  for (const rel of files) {
    let destination = `${to}/${rel}`;
    for (let n = 2; await connection.stat(destination); n++) {
      if (n > 999) throw new HttpError(409, 'STORAGE_FAILED', 'too many copies');
      const dot = rel.lastIndexOf('.');
      const base = dot > rel.lastIndexOf('/') ? rel.slice(0, dot) : rel;
      const ext = dot > rel.lastIndexOf('/') ? rel.slice(dot) : '';
      destination = `${to}/${base} (${String(n)})${ext}`;
    }
    await connection.move(`${from}/${rel}`, destination);
    ctx.db
      .update(mediaItems)
      .set({ path: destination })
      .where(and(eq(mediaItems.targetId, targetId), eq(mediaItems.path, `${from}/${rel}`)))
      .run();
  }
  await connection.removeEmptyFolders(from).catch(() => undefined);
}

/** The pages of one Pixiv work move into "<folder>/<id>/" (names kept free). */
async function groupPost(
  ctx: AppContext,
  targetId: string,
  connection: RcloneConnection,
  post: { folder: string; id: string },
): Promise<void> {
  const folder = post.folder ? relativePath(post.folder) : '';
  const into = folder ? `${folder}/${post.id}` : post.id;
  const pages = presentItems(ctx, targetId).filter((item) =>
    inPixivPost(item.path, { folder, id: post.id }),
  );
  for (const page of pages) {
    const name = baseName(page.path);
    let destination = `${into}/${name}`;
    for (let n = 2; await connection.stat(destination); n++) {
      if (n > 999) throw new HttpError(409, 'STORAGE_FAILED', 'too many copies');
      destination = `${into}/${numberedName(name, n)}`;
    }
    await connection.move(page.path, destination);
    ctx.db
      .update(mediaItems)
      .set({ path: destination, name: baseName(destination) })
      .where(eq(mediaItems.id, page.id))
      .run();
  }
}

export async function applyReorganize(
  ctx: AppContext,
  userId: string,
  body: {
    moves: { from: string; to: string }[];
    leftovers: string[];
    posts?: { folder: string; id: string }[];
  },
): Promise<ReorganizeResult> {
  const record = requireDefaultTarget(ctx, userId);
  const connection = connect(ctx, resolveRecord(ctx, record));
  const result: ReorganizeResult = { moved: 0, deleted: 0, posts: 0, failed: [] };
  const fail = (path: string, error: unknown) =>
    result.failed.push({
      path,
      error:
        error instanceof HttpError
          ? error.code
          : ((error as { code?: string }).code ?? 'STORAGE_FAILED'),
    });
  // Caches first: they sit in folders that may move.
  for (const leftover of body.leftovers) {
    try {
      const file = relativePath(leftover);
      if (!LEFTOVER.test(file.slice(file.lastIndexOf('/') + 1))) {
        throw new HttpError(422, 'STORAGE_PATH_INVALID', leftover);
      }
      await connection.remove(file);
      result.deleted++;
    } catch (error) {
      fail(leftover, error);
    }
  }
  for (const move of body.moves) {
    try {
      const from = relativePath(move.from);
      const to = relativePath(move.to);
      // Only root folders move, and never into themselves.
      if (!from || from.includes('/') || !to || to === from || to.startsWith(`${from}/`)) {
        throw new HttpError(422, 'STORAGE_PATH_INVALID', move.from);
      }
      let source = from;
      if (from.toLowerCase() === to.toLowerCase()) {
        // Only the spelling changes ("gelbooru" → "Gelbooru"): many NAS don't tell
        // them apart, so go through a temporary name.
        source = `${from}.conbert-${randomUUID().slice(0, 8)}`;
        await connection.move(from, source);
        movePaths(ctx, record.id, from, source);
      }
      if (await connection.stat(to)) await merge(ctx, record.id, connection, source, to);
      else {
        await connection.move(source, to);
        movePaths(ctx, record.id, source, to);
      }
      result.moved++;
    } catch (error) {
      fail(move.from, error);
    }
  }
  // Works last: the folder moves above may have changed where their pages are.
  for (const post of body.posts ?? []) {
    try {
      await groupPost(ctx, record.id, connection, post);
      result.posts++;
    } catch (error) {
      fail(`${post.folder}/${post.id}`, error);
    }
  }
  return result;
}
