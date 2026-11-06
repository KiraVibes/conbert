import { and, eq, sql } from 'drizzle-orm';
import type { AppContext } from '../context';
import { appSettings, files, jobs, users } from '../db/schema';
import { HttpError } from '../lib/http-error';

/**
 * Storage quotas: how much one user may keep on the server at the same time
 * – uploads, finished results and downloads waiting to be picked up. All of
 * it is temporary (cleaned up after CONBERT_CLEANUP_MINUTES), so the quota
 * limits the space a user can hold at once, not over time. Storage
 * locations (NAS …) belong to the user and don't count.
 */

const DEFAULT_KEY = 'quota.defaultBytes';
/** In the users table: no limit for this user (null = the default). */
export const UNLIMITED = -1;

/** The default for everyone, in bytes, or null for no limit. */
export function defaultQuota(ctx: AppContext): number | null {
  const row = ctx.db.select().from(appSettings).where(eq(appSettings.key, DEFAULT_KEY)).get();
  const value = row ? Number(row.value) : NaN;
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function setDefaultQuota(ctx: AppContext, bytes: number | null): void {
  if (bytes === null) {
    ctx.db.delete(appSettings).where(eq(appSettings.key, DEFAULT_KEY)).run();
    return;
  }
  ctx.db
    .insert(appSettings)
    .values({ key: DEFAULT_KEY, value: String(bytes) })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: String(bytes) } })
    .run();
}

/** The user's limit in bytes, or null for none. */
export function quotaOf(ctx: AppContext, userId: string): number | null {
  const user = ctx.db
    .select({ quota: users.quotaBytes })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  if (!user || user.quota === UNLIMITED) return null;
  return user.quota ?? defaultQuota(ctx);
}

/** Bytes the user has on the server right now. */
export function usageOf(ctx: AppContext, userId: string): number {
  const uploaded = ctx.db
    .select({ total: sql<number>`coalesce(sum(${files.size}), 0)` })
    .from(files)
    .where(eq(files.userId, userId))
    .get();
  const results = ctx.db
    .select({ total: sql<number>`coalesce(sum(${jobs.resultSize}), 0)` })
    .from(jobs)
    .where(and(eq(jobs.userId, userId), eq(jobs.status, 'done')))
    .get();
  return Number(uploaded?.total ?? 0) + Number(results?.total ?? 0);
}

/** Usage of every user at once (dashboard). */
export function usageByUser(ctx: AppContext): Map<string, number> {
  const usage = new Map<string, number>();
  const add = (rows: { userId: string; total: number }[]) => {
    for (const r of rows) usage.set(r.userId, (usage.get(r.userId) ?? 0) + Number(r.total));
  };
  add(
    ctx.db
      .select({ userId: files.userId, total: sql<number>`coalesce(sum(${files.size}), 0)` })
      .from(files)
      .groupBy(files.userId)
      .all(),
  );
  add(
    ctx.db
      .select({ userId: jobs.userId, total: sql<number>`coalesce(sum(${jobs.resultSize}), 0)` })
      .from(jobs)
      .where(eq(jobs.status, 'done'))
      .groupBy(jobs.userId)
      .all(),
  );
  return usage;
}

/**
 * Refuses when `incoming` more bytes would go over the user's limit
 * (413 QUOTA_EXCEEDED, details: used/limit for the message).
 */
export function checkQuota(ctx: AppContext, userId: string, incoming: number): void {
  const quota = quotaOf(ctx, userId);
  if (quota === null) return;
  const used = usageOf(ctx, userId);
  if (used + Math.max(0, incoming) > quota) {
    throw new HttpError(413, 'QUOTA_EXCEEDED', `${used}/${quota}`);
  }
}
