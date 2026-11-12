import { randomUUID } from 'node:crypto';
import { ownerMay } from '../auth/permissions';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { and, eq, inArray, isNull, lte, or } from 'drizzle-orm';
import type { z } from 'zod';
import {
  DEFAULT_PIXIV_OPTIONS,
  MAX_DOWNLOAD_LIMIT,
  canSubscribe,
  downloadSourceName,
  feedNewestFirst,
  instagramAccount,
  minFeedInterval,
  type DownloadQuality,
  type PixivOptions,
  type Platform,
  type ProfilePart,
} from '@conbert/core';
import type {
  AfterDownload,
  FeedDto,
  createFeedRequestSchema,
  updateFeedRequestSchema,
} from '@conbert/schemas';
import type { AppContext } from '../context';
import {
  downloadFeeds,
  downloads,
  type DownloadFeedRecord,
  type DownloadRecord,
} from '../db/schema';
import { API_ERROR_KEYS, HttpError } from '../lib/http-error';
import { notify } from '../notifications/service';
import type { ProbeInfo } from './probe';

/**
 * Downloader subscriptions ("Abos"): a profile, channel or thread is checked
 * regularly. The tools' own download archive (one file per subscription)
 * remembers every item seen, so a check only loads what is new.
 */

type CreateFeedInput = z.infer<typeof createFeedRequestSchema>;
type UpdateFeedInput = z.infer<typeof updateFeedRequestSchema>;

export interface FeedOptions {
  quality: DownloadQuality;
  parts: ProfilePart[];
  /** Pixiv only. */
  pixiv?: PixivOptions;
  limit: number;
  sleepSeconds: number;
  targetIds: string[];
  toList: boolean;
  /** New files stay in the server archive (older rows: no). */
  keepOnServer?: boolean;
  after: AfterDownload;
  notify: boolean;
  /** Channel, profile or thread name for the folder (from the first look at the link). */
  sourceName?: string | null;
  /**
   * Parts were added (e.g. reels besides posts): the next check goes through
   * everything once instead of stopping at the first known item.
   */
  catchUp?: boolean;
}

const MINUTE = 60_000;

export { downloadArchive } from './archive-path';

/** Where the tool keeps the list of items it has seen for this subscription. */
export function feedArchive(ctx: AppContext, row: Pick<DownloadFeedRecord, 'id' | 'tool'>) {
  return path.join(
    ctx.config.dataDir,
    'feeds',
    `${row.id}.${row.tool === 'gallery-dl' ? 'sqlite3' : 'txt'}`,
  );
}

function activeCheck(ctx: AppContext, feedId: string): boolean {
  return (
    ctx.db
      .select({ id: downloads.id })
      .from(downloads)
      .where(and(eq(downloads.feedId, feedId), inArray(downloads.status, ['queued', 'running'])))
      .get() !== undefined
  );
}

export function toFeedDto(ctx: AppContext, row: DownloadFeedRecord): FeedDto {
  const o = row.options as FeedOptions;
  return {
    id: row.id,
    url: row.url,
    platform: row.platform as FeedDto['platform'],
    kind: row.kind,
    // Older Instagram subscriptions may carry the name of a joint post's owner.
    title: (row.platform === 'instagram' && instagramAccount(row.url)) || row.title,
    name: row.name,
    intervalMinutes: row.intervalMinutes,
    paused: row.paused,
    ended: row.ended,
    onlyNew: row.onlyNew,
    quality: o.quality,
    parts: o.parts,
    pixiv: row.platform === 'pixiv' ? (o.pixiv ?? DEFAULT_PIXIV_OPTIONS) : null,
    limit: o.limit,
    sleepSeconds: o.sleepSeconds,
    targetIds: o.targetIds,
    toList: o.toList,
    keepOnServer: o.keepOnServer === true,
    after: o.after,
    notify: o.notify,
    checking: activeCheck(ctx, row.id),
    waiting: !activeCheck(ctx, row.id) && feedWaitsForDownload(ctx, row),
    lastCheckAt: row.lastCheckAt?.toISOString() ?? null,
    nextCheckAt: row.nextCheckAt?.toISOString() ?? null,
    lastNew: row.lastNew,
    lastFoundAt: row.lastFoundAt?.toISOString() ?? null,
    totalLoaded: row.totalLoaded,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
  };
}

function optionsOf(input: UpdateFeedInput, before?: FeedOptions): FeedOptions {
  const pixiv = input.pixiv ?? before?.pixiv;
  return {
    quality: input.quality,
    parts: input.parts,
    ...(pixiv && { pixiv }),
    limit: input.limit,
    sleepSeconds: input.sleepSeconds,
    targetIds: input.targetIds,
    toList: input.toList,
    keepOnServer: input.keepOnServer,
    after: input.after,
    notify: input.notify,
  };
}

/** Instagram needs at least an hour between checks (accounts get blocked otherwise). */
function checkInterval(platform: Platform, minutes: number) {
  if (minutes < minFeedInterval(platform)) throw new HttpError(422, 'FEED_INTERVAL_TOO_SHORT');
}

export function listFeeds(ctx: AppContext, userId: string): FeedDto[] {
  return ctx.db
    .select()
    .from(downloadFeeds)
    .where(eq(downloadFeeds.userId, userId))
    .all()
    .map((row) => toFeedDto(ctx, row));
}

export function ownFeed(ctx: AppContext, userId: string, id: string): DownloadFeedRecord {
  const row = ctx.db
    .select()
    .from(downloadFeeds)
    .where(and(eq(downloadFeeds.id, id), eq(downloadFeeds.userId, userId)))
    .get();
  if (!row) throw new HttpError(404, 'NOT_FOUND');
  return row;
}

export function createFeed(
  ctx: AppContext,
  userId: string,
  input: CreateFeedInput,
  url: string,
  info: ProbeInfo & { platform: Platform },
): DownloadFeedRecord {
  if (!canSubscribe(info.platform, info.kind)) throw new HttpError(422, 'FEED_NOT_SUBSCRIBABLE');
  checkInterval(info.platform, input.intervalMinutes);
  const id = randomUUID();
  ctx.db
    .insert(downloadFeeds)
    .values({
      id,
      userId,
      url,
      platform: info.platform,
      tool: info.tool,
      kind: info.kind,
      title: info.title,
      name: input.name,
      intervalMinutes: input.intervalMinutes,
      paused: input.paused,
      onlyNew: input.onlyNew,
      options: {
        ...optionsOf(input),
        ...(info.platform === 'pixiv' && { pixiv: input.pixiv ?? DEFAULT_PIXIV_OPTIONS }),
        sourceName: downloadSourceName({ ...info, url }),
      } satisfies FeedOptions,
      // The first check right away: remember what is there (or load the newest).
      nextCheckAt: new Date(),
    })
    .run();
  return ownFeed(ctx, userId, id);
}

export function updateFeed(
  ctx: AppContext,
  userId: string,
  id: string,
  input: UpdateFeedInput,
): DownloadFeedRecord {
  const row = ownFeed(ctx, userId, id);
  checkInterval(row.platform as Platform, input.intervalMinutes);
  const before = row.options as FeedOptions;
  // New parts (reels, stories …) have never been looked at: fetch all that's missing.
  const addedParts = input.parts.some((p) => !before.parts.includes(p));
  const catchUp = (before.catchUp ?? false) || (addedParts && row.initialized);
  ctx.db
    .update(downloadFeeds)
    .set({
      name: input.name,
      intervalMinutes: input.intervalMinutes,
      paused: input.paused,
      options: {
        ...optionsOf(input, before),
        sourceName: before.sourceName ?? null,
        ...(catchUp && { catchUp: true }),
      } satisfies FeedOptions,
      // Something to fetch: right away. Otherwise the next check moves with the interval.
      ...(addedParts
        ? { nextCheckAt: new Date() }
        : row.lastCheckAt && {
            nextCheckAt: new Date(row.lastCheckAt.getTime() + input.intervalMinutes * MINUTE),
          }),
    })
    .where(eq(downloadFeeds.id, id))
    .run();
  return ownFeed(ctx, userId, id);
}

export async function deleteFeed(ctx: AppContext, userId: string, id: string): Promise<void> {
  const row = ownFeed(ctx, userId, id);
  // A running check stops; its files stay in the download list.
  const running = ctx.db
    .select({ id: downloads.id })
    .from(downloads)
    .where(and(eq(downloads.feedId, id), inArray(downloads.status, ['queued', 'running'])))
    .all();
  for (const r of running) {
    if (!ctx.downloads.runner.abort(r.id)) {
      await ctx.downloads.queue.removeWaiting(r.id).catch(() => undefined);
      ctx.downloads.runner.update(r.id, { status: 'cancelled', finishedAt: new Date() });
    }
  }
  ctx.db.delete(downloadFeeds).where(eq(downloadFeeds.id, id)).run();
  await rm(feedArchive(ctx, row), { force: true });
}

/** The folder name of a subscription's files – your own name wins over the site's. */
export function feedSourceName(row: DownloadFeedRecord): string | null {
  const o = row.options as FeedOptions;
  return (
    row.name ||
    downloadSourceName({
      platform: row.platform as Platform,
      kind: row.kind,
      title: row.title,
      uploader: o.sourceName ?? null,
      url: row.url,
    }) ||
    row.title
  );
}

const sameUrl = (a: string, b: string) =>
  a.trim().replace(/\/+$/, '').toLowerCase() === b.trim().replace(/\/+$/, '').toLowerCase();

/**
 * Is a download from the same channel, profile or thread running right now?
 * Two requests at the same time make sites (above all Instagram) slow both
 * down – the check waits until the download is through.
 */
export function feedWaitsForDownload(ctx: AppContext, row: DownloadFeedRecord): boolean {
  const name = feedSourceName(row)?.toLowerCase() ?? null;
  return ctx.db
    .select({
      url: downloads.url,
      platform: downloads.platform,
      options: downloads.options,
      feedId: downloads.feedId,
    })
    .from(downloads)
    .where(and(eq(downloads.userId, row.userId), inArray(downloads.status, ['queued', 'running'])))
    .all()
    .some((d) => {
      if (d.feedId === row.id) return false;
      if (sameUrl(d.url, row.url)) return true;
      const other = (d.options as { sourceName?: string | null }).sourceName?.toLowerCase();
      return d.platform === row.platform && name !== null && other === name;
    });
}

/**
 * Starts a check now ("Jetzt prüfen", or the timer). False when one is
 * running already, or a download from the same source is still going – then
 * the check stays due and the timer starts it once that download is done.
 */
export async function runFeed(ctx: AppContext, row: DownloadFeedRecord): Promise<boolean> {
  if (row.ended || activeCheck(ctx, row.id)) return false;
  // The admin blocked the downloader for this user: the subscription rests.
  if (!ownerMay(ctx.db, row.userId, 'downloader')) return false;
  if (feedWaitsForDownload(ctx, row)) {
    if (!row.nextCheckAt || row.nextCheckAt.getTime() > Date.now()) {
      ctx.db
        .update(downloadFeeds)
        .set({ nextCheckAt: new Date() })
        .where(eq(downloadFeeds.id, row.id))
        .run();
    }
    return false;
  }
  const o = row.options as FeedOptions;
  const newestFirst = feedNewestFirst(row.platform as Platform);
  const recordOnly = row.onlyNew && !row.initialized;
  const archiveFile = feedArchive(ctx, row);
  await mkdir(path.dirname(archiveFile), { recursive: true });
  const next = new Date(Date.now() + row.intervalMinutes * MINUTE);
  const id = randomUUID();
  ctx.db
    .insert(downloads)
    .values({
      id,
      userId: row.userId,
      url: row.url,
      platform: row.platform,
      tool: row.tool,
      kind: row.kind,
      title: row.name || row.title,
      options: {
        quality: o.quality,
        parts: o.parts,
        ...(o.pixiv && { pixiv: o.pixiv }),
        // A thread lists its old posts first: the whole thread is gone through,
        // the archive skips what is known.
        // Catching up goes through everything that's there (up to the hard limit).
        limit: newestFirst && !o.catchUp ? o.limit : MAX_DOWNLOAD_LIMIT,
        sleepSeconds: o.sleepSeconds,
        targetIds: o.targetIds,
        toList: o.toList,
        keepOnServer: o.keepOnServer === true,
        after: o.after,
        feed: true,
        // Your own name for the subscription wins over the one the site gives.
        sourceName: feedSourceName(row),
        archiveFile,
        recordOnly,
        stopAtKnown: newestFirst && row.initialized && !o.catchUp,
      },
      total: null,
      files: [],
      feedId: row.id,
    })
    .run();
  ctx.db
    .update(downloadFeeds)
    .set({ nextCheckAt: next, lastError: null })
    .where(eq(downloadFeeds.id, row.id))
    .run();
  try {
    await ctx.downloads.queue.enqueue(id);
    return true;
  } catch {
    ctx.downloads.runner.update(id, {
      status: 'error',
      errorKey: API_ERROR_KEYS.QUEUE_UNAVAILABLE,
      finishedAt: new Date(),
    });
    return false;
  }
}

/** A check ended: count what was new, notice a thread that is gone. */
export function feedDownloadFinished(ctx: AppContext, download: DownloadRecord): void {
  if (!download.feedId || download.status === 'queued' || download.status === 'running') return;
  const row = ctx.db
    .select()
    .from(downloadFeeds)
    .where(eq(downloadFeeds.id, download.feedId))
    .get();
  if (!row) return;
  const loaded = (download.files as unknown[]).length;
  const failed = download.status === 'error';
  // A thread that is archived or deleted answers "not found" – it is over.
  const ended =
    failed && row.platform === '4chan' && download.errorKey === API_ERROR_KEYS.DOWNLOAD_NOT_FOUND;
  ctx.db
    .update(downloadFeeds)
    .set({
      lastCheckAt: new Date(),
      lastNew: loaded,
      ...(loaded > 0 && { lastFoundAt: new Date() }),
      totalLoaded: row.totalLoaded + loaded,
      ...(download.status === 'done' && {
        initialized: true,
        // Caught up: from now on, stop at the first known item again.
        options: { ...(row.options as FeedOptions), catchUp: false },
      }),
      lastError: failed && !ended ? download.errorKey : null,
      ...(ended && { ended: true }),
    })
    .where(eq(downloadFeeds.id, row.id))
    .run();
  // Checks without anything new would only clutter the download list.
  if (download.status === 'done' && loaded === 0) {
    ctx.db.delete(downloads).where(eq(downloads.id, download.id)).run();
  }
  const o = row.options as FeedOptions;
  if (!o.notify || download.status === 'cancelled') return;
  const name = row.name || row.title || row.url;
  const message = ended
    ? {
        event: 'subscription-new' as const,
        titleKey: 'notifications.feedEnded.title',
        bodyKey: 'notifications.feedEnded.body',
      }
    : failed
      ? {
          event: 'error' as const,
          titleKey: 'notifications.feedError.title',
          bodyKey: 'notifications.feedError.body',
        }
      : loaded > 0 && !(row.onlyNew && !row.initialized)
        ? {
            event: 'subscription-new' as const,
            titleKey: 'notifications.feedNew.title',
            bodyKey: 'notifications.feedNew.body',
          }
        : null;
  if (message) {
    void notify(ctx, row.userId, { ...message, values: { name, count: loaded } }).catch(
      () => undefined,
    );
  }
}

/** The subscriptions that are due now (the scheduler starts them). */
export function dueFeeds(ctx: AppContext): DownloadFeedRecord[] {
  return ctx.db
    .select()
    .from(downloadFeeds)
    .where(
      and(
        eq(downloadFeeds.paused, false),
        eq(downloadFeeds.ended, false),
        or(isNull(downloadFeeds.nextCheckAt), lte(downloadFeeds.nextCheckAt, new Date())),
      ),
    )
    .all();
}
