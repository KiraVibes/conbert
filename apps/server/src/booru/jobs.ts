import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { z } from 'zod';
import type { createBooruJobRequestSchema } from '@conbert/schemas';
import type { AppContext } from '../context';
import { booruJobs, files, type BooruJobRecord } from '../db/schema';
import { HttpError } from '../lib/http-error';
import { deleteFileRecord } from '../storage/uploads';
import { initialState, toBooruJobDto, type CrawlOptions, type CrawlState } from './crawler';
import { asHttpError, clientFor, prepareQuery, readSettings, siteFor } from './service';

type CreateBody = z.infer<typeof createBooruJobRequestSchema>;

/** Checks the search right away (mandatory protection, tag limit), then queues the crawl. */
export async function createBooruJob(
  ctx: AppContext,
  userId: string,
  siteId: string,
  body: CreateBody,
  extra: { subscriptionId?: string; stopAtId?: number } = {},
): Promise<BooruJobRecord> {
  const site = siteFor(ctx, userId, siteId);
  const settings = readSettings(ctx, userId);
  if (!body.postIds || body.postIds.length === 0) {
    try {
      await prepareQuery(clientFor(ctx, userId, site), body.query, settings);
    } catch (error) {
      throw asHttpError(error);
    }
  } else {
    clientFor(ctx, userId, site);
  }
  if (!ctx.booru.queue.isHealthy()) throw new HttpError(503, 'QUEUE_UNAVAILABLE');
  const options: CrawlOptions = {
    limit: body.postIds?.length ? Math.min(body.limit, body.postIds.length) : body.limit,
    speed: body.speed,
    window: body.window,
    filePattern: body.filePattern ?? settings.filePattern,
    folderPattern: body.folderPattern ?? settings.folderPattern,
    sidecars: body.sidecars ?? settings.sidecars,
    sample: body.sample ?? settings.sample,
    targetIds: body.targetIds,
    toList: body.toList,
    workflowId: body.workflowId,
    after: body.after ?? (body.workflowId ? { workflowId: body.workflowId } : null),
    ...(body.postIds?.length && { postIds: body.postIds }),
    ...(extra.stopAtId !== undefined && { stopAtId: extra.stopAtId }),
  };
  const id = randomUUID();
  ctx.db
    .insert(booruJobs)
    .values({
      id,
      userId,
      siteId: site.id,
      query: body.query,
      options,
      state: initialState(options.postIds),
      subscriptionId: extra.subscriptionId ?? null,
    })
    .run();
  try {
    await ctx.booru.queue.enqueue(id);
  } catch {
    ctx.booru.runner.update(id, {
      status: 'error',
      errorKey: 'errors.queueUnavailable',
      finishedAt: new Date(),
    });
    throw new HttpError(503, 'QUEUE_UNAVAILABLE');
  }
  const row = ctx.booru.runner.row(id);
  if (!row) throw new HttpError(500, 'INTERNAL');
  return row;
}

export function ownBooruJob(ctx: AppContext, userId: string, id: string): BooruJobRecord {
  const row = ctx.db
    .select()
    .from(booruJobs)
    .where(and(eq(booruJobs.id, id), eq(booruJobs.userId, userId)))
    .get();
  if (!row) throw new HttpError(404, 'NOT_FOUND');
  return row;
}

export function listBooruJobs(ctx: AppContext, userId: string) {
  return ctx.db
    .select()
    .from(booruJobs)
    .where(eq(booruJobs.userId, userId))
    .orderBy(desc(booruJobs.createdAt))
    .limit(50)
    .all()
    .map((row) => toBooruJobDto(ctx, row));
}

const ACTIVE = ['queued', 'running', 'waiting'] as const;
const isActive = (status: BooruJobRecord['status']) =>
  (ACTIVE as readonly string[]).includes(status);

export async function pauseBooruJob(ctx: AppContext, userId: string, id: string) {
  const row = ownBooruJob(ctx, userId, id);
  if (!isActive(row.status)) throw new HttpError(409, 'BOORU_JOB_NOT_ACTIVE');
  if (!ctx.booru.runner.stop(id, 'paused')) {
    await ctx.booru.queue.removeWaiting(id);
    ctx.booru.runner.update(id, { status: 'paused', resumeAt: null });
  }
  return toBooruJobDto(ctx, ownBooruJob(ctx, userId, id));
}

export async function resumeBooruJob(ctx: AppContext, userId: string, id: string) {
  const row = ownBooruJob(ctx, userId, id);
  if (row.status !== 'paused' && row.status !== 'waiting') {
    throw new HttpError(409, 'BOORU_JOB_NOT_ACTIVE');
  }
  if (row.status === 'waiting') await ctx.booru.queue.removeWaiting(id);
  ctx.booru.runner.update(id, {
    status: 'queued',
    resumeAt: null,
    errorKey: null,
    errorDetails: null,
  });
  try {
    await ctx.booru.queue.enqueue(id);
  } catch {
    ctx.booru.runner.update(id, { status: 'paused' });
    throw new HttpError(503, 'QUEUE_UNAVAILABLE');
  }
  return toBooruJobDto(ctx, ownBooruJob(ctx, userId, id));
}

/** Cancels an active crawl, or removes a finished one (and its files still on the server). */
export async function deleteBooruJob(ctx: AppContext, userId: string, id: string) {
  const row = ownBooruJob(ctx, userId, id);
  if (isActive(row.status)) {
    if (!ctx.booru.runner.stop(id, 'cancelled')) {
      await ctx.booru.queue.removeWaiting(id);
      ctx.booru.runner.update(id, { status: 'cancelled', finishedAt: new Date(), resumeAt: null });
    }
    return toBooruJobDto(ctx, ownBooruJob(ctx, userId, id));
  }
  const state = row.state as Partial<CrawlState>;
  const ids = (state.files ?? []).map((f) => f.fileId).filter((f): f is string => f !== null);
  if (ids.length > 0) {
    const records = ctx.db
      .select()
      .from(files)
      .where(and(eq(files.userId, userId), inArray(files.id, ids)))
      .all();
    for (const record of records) await deleteFileRecord(ctx, record);
  }
  ctx.db.delete(booruJobs).where(eq(booruJobs.id, id)).run();
  return toBooruJobDto(ctx, row);
}

/** Empties the list: finished crawls go (with their files still waiting for the list); running, waiting and paused ones stay. */
export async function clearFinishedBooruJobs(ctx: AppContext, userId: string): Promise<number> {
  const rows = ctx.db
    .select({ id: booruJobs.id })
    .from(booruJobs)
    .where(
      and(eq(booruJobs.userId, userId), inArray(booruJobs.status, ['done', 'error', 'cancelled'])),
    )
    .all();
  for (const row of rows) await deleteBooruJob(ctx, userId, row.id);
  return rows.length;
}

/** The files of a crawl that are waiting for the conversion list. */
export function booruJobFiles(ctx: AppContext, userId: string, id: string) {
  const state = ownBooruJob(ctx, userId, id).state as Partial<CrawlState>;
  return (state.files ?? []).filter((f) => f.fileId !== null);
}

/** After a restart: interrupted crawls go on, waiting ones keep their time. */
export async function resumeBooruJobs(ctx: AppContext): Promise<void> {
  const rows = ctx.db
    .select()
    .from(booruJobs)
    .where(inArray(booruJobs.status, [...ACTIVE]))
    .all();
  for (const row of rows) {
    if (row.status === 'running') ctx.booru.runner.update(row.id, { status: 'queued' });
    const delay =
      row.status === 'waiting' && row.resumeAt ? row.resumeAt.getTime() - Date.now() : 0;
    // A job with the same ID that is still in the queue is not added twice.
    await ctx.booru.queue.enqueue(row.id, Math.max(0, delay)).catch(() => undefined);
  }
}
