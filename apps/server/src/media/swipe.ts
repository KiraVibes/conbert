import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import {
  and,
  desc,
  eq,
  inArray,
  isNull,
  lte,
  ne,
  not,
  notInArray,
  notLike,
  or,
  sql,
} from 'drizzle-orm';
import {
  favoritePath,
  inPixivPost,
  knownItemOf,
  normalPath,
  numberedName,
  parentFolder,
  pixivPostOf,
  premiumPath,
  sourceFolder,
} from '@conbert/core';
import type {
  SwipeAction,
  SwipeItem,
  SwipeMode,
  SwipeOutcome,
  SwipeSource,
  SwipeState,
} from '@conbert/schemas';
import { dataPaths } from '../config';
import type { AppContext } from '../context';
import { appSettings, mediaItems, swipeActions, type MediaItemRecord } from '../db/schema';
import { HttpError } from '../lib/http-error';
import type { RcloneConnection } from '../targets/rclone';
import { StorageError } from '../targets/rclone';
import { connect, getOwnTarget, resolveRecord } from '../targets/service';
import { rememberKnown, requireDefaultTarget, sha256OfFile } from './known';

/** How many decisions can be taken back; older ones are carried out. */
export const UNDO_WINDOW = 5;
/** Larger files aren't shown (the preview loads the whole file). */
export const MAX_CARD_BYTES = 300 * 1024 * 1024;

const CARD_KINDS = ['image', 'gif', 'video'] as const;

// One user's actions run one after the other (moves must not overlap).
const queues = new Map<string, Promise<unknown>>();
function serial<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const previous = queues.get(userId) ?? Promise.resolve();
  const next = previous.then(fn, fn);
  queues.set(
    userId,
    next.catch(() => undefined),
  );
  return next;
}

function pendingIds(ctx: AppContext, userId: string): string[] {
  return ctx.db
    .select({ itemId: swipeActions.itemId })
    .from(swipeActions)
    .where(and(eq(swipeActions.userId, userId), isNull(swipeActions.committedAt)))
    .all()
    .map((r) => r.itemId);
}

export function pendingCount(ctx: AppContext, userId: string): number {
  return pendingIds(ctx, userId).length;
}

/**
 * The favourites run in rounds: a card seen in this round (sortedAt after the
 * round began) waits until every other favourite was shown, then all of them
 * come again, freshly shuffled. The round's start lives in app_settings.
 */
const roundKey = (userId: string) => `swipe-favorites-round:${userId}`;

export function favoritesRound(ctx: AppContext, userId: string): Date {
  const row = ctx.db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, roundKey(userId)))
    .get();
  return new Date(typeof row?.value === 'number' ? row.value : 0);
}

function startFavoritesRound(ctx: AppContext, userId: string): void {
  const value = Date.now();
  ctx.db
    .insert(appSettings)
    .values({ key: roundKey(userId), value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value } })
    .run();
}

const startsWith = (prefix: string) =>
  sql`substr(${mediaItems.path}, 1, ${prefix.length}) = ${prefix}`;

/** The items a mode can show (before folders and randomness). */
function poolFilter(ctx: AppContext, userId: string, mode: SwipeMode, sorted: boolean) {
  const target = requireDefaultTarget(ctx, userId);
  const base = and(
    eq(mediaItems.userId, userId),
    eq(mediaItems.targetId, target.id),
    inArray(mediaItems.kind, [...CARD_KINDS]),
    lte(mediaItems.size, MAX_CARD_BYTES),
  );
  if (mode === 'favorites') return and(base, inArray(mediaItems.status, ['favorite', 'premium']));
  return and(
    base,
    sorted ? inArray(mediaItems.status, ['present', 'kept']) : eq(mediaItems.status, 'present'),
    notLike(mediaItems.path, 'Favoriten/%'),
  );
}

function folderFilter(mode: SwipeMode, folders: readonly string[]) {
  const clean = folders.map((f) => f.replace(/^\/+|\/+$/g, '')).filter(Boolean);
  if (clean.length === 0) return undefined;
  return or(
    ...clean.flatMap((f) =>
      mode === 'favorites'
        ? [startsWith(`Favoriten/${f}/`), startsWith(`Favoriten/Premium/${f}/`)]
        : [startsWith(`${f}/`)],
    ),
  );
}

const toItem = (row: MediaItemRecord): SwipeItem => ({
  id: row.id,
  targetId: row.targetId,
  path: row.path,
  name: row.name,
  size: row.size,
  kind: row.kind as SwipeItem['kind'],
  status: row.status as SwipeItem['status'],
});

/**
 * A few random cards from the chosen folders. In the favourites (without
 * "show sorted") a new round starts once every card of this round was seen.
 */
export function nextItems(
  ctx: AppContext,
  userId: string,
  query: { mode: SwipeMode; folders: string[]; sorted: boolean; count: number; exclude: string[] },
): { items: SwipeItem[]; newRound: boolean } {
  const skip = [...pendingIds(ctx, userId), ...query.exclude];
  // "<folder>/<id>_p" only matches pages of that very work (the number ends at "_p").
  const waiting = waitingPosts(ctx, userId).map((post) =>
    not(startsWith(post.folder ? `${post.folder}/${post.id}_p` : `${post.id}_p`)),
  );
  const rounds = query.mode === 'favorites' && !query.sorted;
  const pick = () =>
    ctx.db
      .select()
      .from(mediaItems)
      .where(
        and(
          poolFilter(ctx, userId, query.mode, query.sorted),
          folderFilter(query.mode, query.folders),
          skip.length > 0 ? notInArray(mediaItems.id, skip) : undefined,
          ...waiting,
          rounds
            ? or(isNull(mediaItems.sortedAt), lte(mediaItems.sortedAt, favoritesRound(ctx, userId)))
            : undefined,
        ),
      )
      .orderBy(sql`random()`)
      .limit(query.count)
      .all()
      .map(toItem);
  const items = pick();
  if (items.length > 0 || !rounds) return { items, newRound: false };
  startFavoritesRound(ctx, userId);
  const again = pick();
  return { items: again, newRound: again.length > 0 };
}

/** Platforms → channels/tags → sub folders, with how many cards each holds. */
export function sourceTree(
  ctx: AppContext,
  userId: string,
  mode: SwipeMode,
  sorted: boolean,
): SwipeSource[] {
  const rows = ctx.db
    .select({ path: mediaItems.path })
    .from(mediaItems)
    .where(poolFilter(ctx, userId, mode, sorted))
    .all();
  const root: SwipeSource = { path: '', name: '', count: 0, children: [] };
  for (const { path: file } of rows) {
    const parts = sourceFolder(file, 3).split('/').filter(Boolean);
    let node = root;
    node.count++;
    parts.forEach((part, i) => {
      const at = parts.slice(0, i + 1).join('/');
      let child = node.children.find((c) => c.name === part);
      if (!child) {
        child = { path: at, name: part, count: 0, children: [] };
        node.children.push(child);
      }
      child.count++;
      node = child;
    });
  }
  const sort = (list: SwipeSource[]): SwipeSource[] =>
    list
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
      .map((n) => ({ ...n, children: sort(n.children) }));
  return sort(root.children);
}

/** Which decisions fit an item where it is now. */
function allowed(status: string): readonly SwipeAction[] {
  if (status === 'favorite' || status === 'premium') return ['unfavorite', 'keep', 'premium'];
  if (status === 'present' || status === 'kept')
    return ['delete', 'keep', 'favorite', 'deletePost'];
  return [];
}

/** A free name at the destination: "a.jpg", else "a (2).jpg" … */
async function freePath(connection: RcloneConnection, wanted: string): Promise<string> {
  const folder = parentFolder(wanted);
  const name = wanted.slice(folder ? folder.length + 1 : 0);
  for (let n = 1; n < 1000; n++) {
    const candidate = n === 1 ? wanted : `${folder ? `${folder}/` : ''}${numberedName(name, n)}`;
    if (!(await connection.stat(candidate))) return candidate;
  }
  throw new HttpError(409, 'STORAGE_FAILED', 'too many copies');
}

/** Folders that became empty go too – up to the first one that still holds something. */
async function tidy(connection: RcloneConnection, folder: string): Promise<void> {
  for (let f = folder; f; f = parentFolder(f)) {
    try {
      await connection.removeFolderIfEmpty(f);
    } catch {
      return;
    }
  }
}

/** Carries out one decision on the storage location. */
async function carryOut(
  ctx: AppContext,
  userId: string,
  item: MediaItemRecord,
  action: SwipeAction,
  /** When the card was swiped (counts for the favourites' round, see above). */
  now: Date,
): Promise<void> {
  const update = (set: Partial<MediaItemRecord>) =>
    ctx.db.update(mediaItems).set(set).where(eq(mediaItems.id, item.id)).run();
  if (action === 'keep') {
    update({
      status: item.status === 'present' ? 'kept' : item.status,
      sortedAt: now,
    });
    return;
  }
  const connection = connect(ctx, resolveRecord(ctx, getOwnTarget(ctx, userId, item.targetId)));
  if (action === 'delete') {
    let sha256 = item.sha256;
    if (!sha256) {
      // The content's fingerprint: the same picture under another name stays away too.
      const tmp = path.join(dataPaths(ctx.config).tmp, `swipe-${randomUUID()}`);
      try {
        await connection.download(item.path, tmp);
        sha256 = await sha256OfFile(tmp);
      } catch (error) {
        if (!(error instanceof StorageError && error.code === 'STORAGE_NOT_FOUND')) throw error;
      } finally {
        await rm(tmp, { force: true });
      }
    }
    try {
      await connection.remove(item.path);
    } catch (error) {
      // Already gone is fine: the goal is that it's gone.
      if (!(error instanceof StorageError && error.code === 'STORAGE_NOT_FOUND')) throw error;
    }
    update({ status: 'deleted', sortedAt: now, sha256 });
    const known = knownItemOf(item.path);
    if (known) await rememberKnown(ctx, userId, [known]);
    await tidy(connection, parentFolder(item.path));
    return;
  }
  const wanted =
    action === 'favorite'
      ? favoritePath(item.path)
      : action === 'premium'
        ? premiumPath(item.path)
        : normalPath(item.path);
  if (wanted === item.path) {
    update({ sortedAt: action === 'favorite' ? null : now });
    return;
  }
  const destination = await freePath(connection, wanted);
  await connection.move(item.path, destination);
  update({
    path: destination,
    name: destination.slice(destination.lastIndexOf('/') + 1),
    status: action === 'favorite' ? 'favorite' : action === 'premium' ? 'premium' : 'kept',
    // A new favourite is unseen in the favourites; premium counts as seen this round.
    sortedAt: action === 'favorite' ? null : now,
  });
  await tidy(connection, parentFolder(item.path));
}

/**
 * The other pages of a card's Pixiv work that are still to be sorted (same
 * location, same folder, same number). Empty for any other file.
 */
function postSiblings(ctx: AppContext, item: MediaItemRecord): MediaItemRecord[] {
  const post = pixivPostOf(item.path);
  if (!post) return [];
  const prefix = post.folder ? `${post.folder}/${post.id}_p` : `${post.id}_p`;
  return ctx.db
    .select()
    .from(mediaItems)
    .where(
      and(
        eq(mediaItems.userId, item.userId),
        eq(mediaItems.targetId, item.targetId),
        inArray(mediaItems.status, ['present', 'kept']),
        startsWith(prefix),
        ne(mediaItems.id, item.id),
      ),
    )
    .all()
    .filter((row) => inPixivPost(row.path, post));
}

/** Carries out the given pending actions, oldest first. */
async function commit(
  ctx: AppContext,
  userId: string,
  actions: { id: number; itemId: string; action: SwipeAction; createdAt: Date }[],
): Promise<SwipeOutcome[]> {
  const out: SwipeOutcome[] = [];
  for (const a of actions) {
    const item = ctx.db.select().from(mediaItems).where(eq(mediaItems.id, a.itemId)).get();
    let error: string | null = null;
    // A whole work: the card and every other page of it are deleted one by one.
    const group =
      item && a.action === 'deletePost' ? [item, ...postSiblings(ctx, item)] : item ? [item] : [];
    const action: SwipeAction = a.action === 'deletePost' ? 'delete' : a.action;
    for (const [index, one] of group.entries()) {
      let failed: string | null = null;
      try {
        await carryOut(ctx, userId, one, action, a.createdAt);
      } catch (e) {
        failed = e instanceof HttpError || e instanceof StorageError ? e.code : 'STORAGE_FAILED';
      }
      if (index === 0) error = failed;
      // The other pages are reported on their own.
      if (index > 0)
        out.push({ itemId: one.id, name: one.name, action, ok: !failed, error: failed });
    }
    ctx.db
      .update(swipeActions)
      .set({ committedAt: new Date(), error })
      .where(eq(swipeActions.id, a.id))
      .run();
    out.push({ itemId: a.itemId, name: item?.name ?? '', action, ok: !error, error });
  }
  return out;
}

/** Pages of works that wait for "delete the whole work" don't come as cards any more. */
function waitingPosts(ctx: AppContext, userId: string): { folder: string; id: string }[] {
  return ctx.db
    .select({ path: mediaItems.path })
    .from(swipeActions)
    .innerJoin(mediaItems, eq(swipeActions.itemId, mediaItems.id))
    .where(
      and(
        eq(swipeActions.userId, userId),
        isNull(swipeActions.committedAt),
        eq(swipeActions.action, 'deletePost'),
      ),
    )
    .all()
    .flatMap((row) => {
      const post = pixivPostOf(row.path);
      return post ? [post] : [];
    });
}

function pendingActions(ctx: AppContext, userId: string) {
  return ctx.db
    .select({
      id: swipeActions.id,
      itemId: swipeActions.itemId,
      action: swipeActions.action,
      createdAt: swipeActions.createdAt,
    })
    .from(swipeActions)
    .where(and(eq(swipeActions.userId, userId), isNull(swipeActions.committedAt)))
    .orderBy(desc(swipeActions.id))
    .all();
}

/** A decision: kept pending; the one that drops out of the undo window is carried out. */
export function recordSwipe(
  ctx: AppContext,
  userId: string,
  itemId: string,
  action: SwipeAction,
): Promise<SwipeState> {
  return serial(userId, async () => {
    const item = ctx.db
      .select()
      .from(mediaItems)
      .where(and(eq(mediaItems.id, itemId), eq(mediaItems.userId, userId)))
      .get();
    if (!item) throw new HttpError(404, 'NOT_FOUND');
    if (pendingIds(ctx, userId).includes(itemId)) throw new HttpError(409, 'MEDIA_ALREADY_SWIPED');
    if (!allowed(item.status).includes(action)) throw new HttpError(422, 'BAD_REQUEST', action);
    ctx.db.insert(swipeActions).values({ userId, itemId, action }).run();
    const pending = pendingActions(ctx, userId);
    const overflow = pending.slice(UNDO_WINDOW).reverse();
    const done = await commit(ctx, userId, overflow);
    return { pending: pending.length - overflow.length, done };
  });
}

/** Takes the newest pending decision back; its card comes again. */
export function undoSwipe(
  ctx: AppContext,
  userId: string,
): Promise<{ item: SwipeItem | null; action: SwipeAction | null; pending: number }> {
  return serial<{ item: SwipeItem | null; action: SwipeAction | null; pending: number }>(
    userId,
    () => {
      const newest = pendingActions(ctx, userId)[0];
      if (!newest) return Promise.resolve({ item: null, action: null, pending: 0 });
      ctx.db.delete(swipeActions).where(eq(swipeActions.id, newest.id)).run();
      const row = ctx.db.select().from(mediaItems).where(eq(mediaItems.id, newest.itemId)).get();
      return Promise.resolve({
        item: row ? toItem(row) : null,
        action: newest.action,
        pending: pendingCount(ctx, userId),
      });
    },
  );
}

/** Carries out everything still pending ("Done", or after a while without swiping). */
export function flushSwipes(ctx: AppContext, userId: string): Promise<SwipeState> {
  return serial(userId, async () => {
    const done = await commit(ctx, userId, pendingActions(ctx, userId).reverse());
    return { pending: 0, done };
  });
}

/** Users whose newest decision is older than `idleMs`: their pending ones are carried out. */
export async function flushIdle(ctx: AppContext, idleMs: number): Promise<void> {
  const rows = ctx.db
    .select({ userId: swipeActions.userId, newest: sql<number>`max(${swipeActions.createdAt})` })
    .from(swipeActions)
    .where(isNull(swipeActions.committedAt))
    .groupBy(swipeActions.userId)
    .all();
  for (const row of rows) {
    if (Date.now() - Number(row.newest) >= idleMs) await flushSwipes(ctx, row.userId);
  }
}

/** Old, carried-out decisions are not needed any more. */
export function forgetOldActions(ctx: AppContext, olderThanMs: number): void {
  ctx.db
    .delete(swipeActions)
    .where(
      and(
        sql`${swipeActions.committedAt} is not null`,
        lte(swipeActions.committedAt, new Date(Date.now() - olderThanMs)),
      ),
    )
    .run();
}
