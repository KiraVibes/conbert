import { randomUUID } from 'node:crypto';
import { ownerMay } from '../auth/permissions';
import { and, eq, inArray, isNull, lte, or } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { z } from 'zod';
import { checkQueryProtection, tokenize } from '@conbert/core';
import type { SubscriptionDto, subscriptionRequestSchema } from '@conbert/schemas';
import { createBooruJob } from '../booru/jobs';
import { dueFeeds, runFeed } from '../downloader/feeds';
import type { CrawlState } from '../booru/crawler';
import { siteFor } from '../booru/service';
import type { AppContext } from '../context';
import {
  booruJobs,
  booruSubscriptions,
  type BooruJobRecord,
  type BooruSubscriptionRecord,
} from '../db/schema';
import { API_ERROR_KEYS, HttpError } from '../lib/http-error';
import { notify } from '../notifications/service';

/**
 * Tag subscriptions: a saved search is checked regularly, only posts newer
 * than the last check are loaded. The timer looks every minute which
 * subscriptions are due; the times are stored, so a restart loses nothing.
 */

type SubscriptionInput = z.infer<typeof subscriptionRequestSchema>;

interface SubscriptionOptions {
  limit: number;
  targetIds: string[];
  workflowId: string | null;
  notify: boolean;
}

const HOUR = 60 * 60_000;
const TICK_MS = 60_000;

export function toSubscriptionDto(ctx: AppContext, row: BooruSubscriptionRecord): SubscriptionDto {
  const options = row.options as SubscriptionOptions;
  let siteName = row.siteId;
  try {
    siteName = siteFor(ctx, row.userId, row.siteId, { allowRetired: true }).name;
  } catch {
    // Own instance removed.
  }
  return {
    id: row.id,
    siteId: row.siteId,
    siteName,
    query: row.query,
    name: row.name,
    intervalHours: row.intervalHours,
    paused: row.paused,
    limit: options.limit,
    targetIds: options.targetIds,
    workflowId: options.workflowId,
    notify: options.notify,
    lastCheckAt: row.lastCheckAt?.toISOString() ?? null,
    nextCheckAt: row.nextCheckAt?.toISOString() ?? null,
    lastNew: row.lastNew,
    totalLoaded: row.totalLoaded,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
  };
}

function check(ctx: AppContext, userId: string, input: SubscriptionInput) {
  siteFor(ctx, userId, input.siteId);
  // The mandatory protection applies to subscriptions too.
  if (!checkQueryProtection(tokenize(input.query)).ok) {
    throw new HttpError(422, 'BOORU_QUERY_REFUSED');
  }
}

export function listSubscriptions(ctx: AppContext, userId: string): SubscriptionDto[] {
  return ctx.db
    .select()
    .from(booruSubscriptions)
    .where(eq(booruSubscriptions.userId, userId))
    .all()
    .map((row) => toSubscriptionDto(ctx, row));
}

export function ownSubscription(ctx: AppContext, userId: string, id: string) {
  const row = ctx.db
    .select()
    .from(booruSubscriptions)
    .where(and(eq(booruSubscriptions.id, id), eq(booruSubscriptions.userId, userId)))
    .get();
  if (!row) throw new HttpError(404, 'NOT_FOUND');
  return row;
}

export function createSubscription(ctx: AppContext, userId: string, input: SubscriptionInput) {
  check(ctx, userId, input);
  const id = randomUUID();
  ctx.db
    .insert(booruSubscriptions)
    .values({
      id,
      userId,
      siteId: input.siteId,
      query: input.query,
      name: input.name,
      intervalHours: input.intervalHours,
      paused: input.paused,
      options: {
        limit: input.limit,
        targetIds: input.targetIds,
        workflowId: input.workflowId,
        notify: input.notify,
      } satisfies SubscriptionOptions,
      // The first check right away (fills up with the newest posts).
      nextCheckAt: new Date(),
    })
    .run();
  return toSubscriptionDto(ctx, ownSubscription(ctx, userId, id));
}

export function updateSubscription(
  ctx: AppContext,
  userId: string,
  id: string,
  input: SubscriptionInput,
) {
  const row = ownSubscription(ctx, userId, id);
  check(ctx, userId, input);
  const changedSearch = row.siteId !== input.siteId || row.query !== input.query;
  ctx.db
    .update(booruSubscriptions)
    .set({
      siteId: input.siteId,
      query: input.query,
      name: input.name,
      intervalHours: input.intervalHours,
      paused: input.paused,
      options: {
        limit: input.limit,
        targetIds: input.targetIds,
        workflowId: input.workflowId,
        notify: input.notify,
      } satisfies SubscriptionOptions,
      // Another search starts from the beginning.
      ...(changedSearch && { lastPostId: null, nextCheckAt: new Date() }),
      ...(!changedSearch &&
        row.lastCheckAt && {
          nextCheckAt: new Date(row.lastCheckAt.getTime() + input.intervalHours * HOUR),
        }),
    })
    .where(eq(booruSubscriptions.id, id))
    .run();
  return toSubscriptionDto(ctx, ownSubscription(ctx, userId, id));
}

export function deleteSubscription(ctx: AppContext, userId: string, id: string) {
  ownSubscription(ctx, userId, id);
  ctx.db.delete(booruSubscriptions).where(eq(booruSubscriptions.id, id)).run();
}

/** A check is running if one of its crawls is still active. */
function hasActiveJob(ctx: AppContext, subscriptionId: string): boolean {
  return (
    ctx.db
      .select({ id: booruJobs.id })
      .from(booruJobs)
      .where(
        and(
          eq(booruJobs.subscriptionId, subscriptionId),
          inArray(booruJobs.status, ['queued', 'running', 'waiting', 'paused']),
        ),
      )
      .get() !== undefined
  );
}

/** Starts a check now (button "Jetzt prüfen", or the timer). */
export async function runSubscription(
  ctx: AppContext,
  row: BooruSubscriptionRecord,
): Promise<boolean> {
  if (hasActiveJob(ctx, row.id)) return false;
  // The admin blocked the booru function for this user: the subscription rests.
  if (!ownerMay(ctx.db, row.userId, 'booru')) return false;
  const options = row.options as SubscriptionOptions;
  const next = new Date(Date.now() + row.intervalHours * HOUR);
  try {
    await createBooruJob(
      ctx,
      row.userId,
      row.siteId,
      {
        query: row.query,
        limit: options.limit,
        speed: 'normal',
        window: null,
        targetIds: options.targetIds,
        // Without a storage location the files wait for the conversion list.
        toList: options.targetIds.length === 0,
        workflowId: options.workflowId,
        after: options.workflowId ? { workflowId: options.workflowId } : null,
      },
      {
        subscriptionId: row.id,
        ...(row.lastPostId !== null && { stopAtId: row.lastPostId }),
      },
    );
    ctx.db
      .update(booruSubscriptions)
      .set({ nextCheckAt: next, lastError: null })
      .where(eq(booruSubscriptions.id, row.id))
      .run();
    return true;
  } catch (error) {
    const key = error instanceof HttpError ? API_ERROR_KEYS[error.code] : API_ERROR_KEYS.INTERNAL;
    ctx.db
      .update(booruSubscriptions)
      .set({ nextCheckAt: next, lastCheckAt: new Date(), lastError: key })
      .where(eq(booruSubscriptions.id, row.id))
      .run();
    return false;
  }
}

/** When a subscription's crawl ends: remember the newest post and what was new. */
export function subscriptionCrawlFinished(ctx: AppContext, job: BooruJobRecord): void {
  if (!job.subscriptionId) return;
  const row = ctx.db
    .select()
    .from(booruSubscriptions)
    .where(eq(booruSubscriptions.id, job.subscriptionId))
    .get();
  if (!row) return;
  const state = job.state as Partial<CrawlState>;
  const loaded = state.downloaded ?? 0;
  // Only move on when the crawl finished; after an error the same posts are tried again.
  const newest =
    job.status === 'done' && state.newestId
      ? Math.max(state.newestId, row.lastPostId ?? 0)
      : row.lastPostId;
  ctx.db
    .update(booruSubscriptions)
    .set({
      lastPostId: newest,
      lastCheckAt: new Date(),
      lastNew: loaded,
      totalLoaded: row.totalLoaded + loaded,
      lastError: job.status === 'error' ? job.errorKey : null,
    })
    .where(eq(booruSubscriptions.id, row.id))
    .run();
  const options = row.options as SubscriptionOptions;
  if (options.notify && (loaded > 0 || job.status === 'error')) {
    void notify(ctx, row.userId, {
      event: job.status === 'error' ? 'error' : 'subscription-new',
      titleKey:
        job.status === 'error'
          ? 'notifications.subscriptionError.title'
          : 'notifications.subscriptionNew.title',
      bodyKey:
        job.status === 'error'
          ? 'notifications.subscriptionError.body'
          : 'notifications.subscriptionNew.body',
      values: { name: row.name || row.query, count: loaded },
    }).catch(() => undefined);
  }
}

/** Every minute: start the subscriptions that are due. */
export function startSubscriptionScheduler(ctx: AppContext, log: FastifyBaseLogger): () => void {
  const tick = async () => {
    const due = ctx.db
      .select()
      .from(booruSubscriptions)
      .where(
        and(
          eq(booruSubscriptions.paused, false),
          or(
            isNull(booruSubscriptions.nextCheckAt),
            lte(booruSubscriptions.nextCheckAt, new Date()),
          ),
        ),
      )
      .all();
    for (const row of due) {
      if (!ctx.booru.queue.isHealthy()) break;
      await runSubscription(ctx, row).catch((err: unknown) =>
        log.warn({ err, subscription: row.id }, 'subscription check failed'),
      );
    }
    // Profiles, channels and threads (downloader subscriptions).
    for (const row of dueFeeds(ctx)) {
      if (!ctx.downloads.queue.isHealthy()) break;
      await runFeed(ctx, row).catch((err: unknown) =>
        log.warn({ err, feed: row.id }, 'feed check failed'),
      );
    }
  };
  const timer = setInterval(() => void tick(), TICK_MS);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
}
