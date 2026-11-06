import { and, eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { AppContext } from '../context';
import { storageTargets } from '../db/schema';
import { flushIdle, forgetOldActions } from '../media/swipe';
import { syncMedia } from '../media/sync';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** Swipe decisions without new swipes for this long are carried out. */
export const SWIPE_IDLE_MS = HOUR;
/** The media index is refreshed once a day (new files from outside Conbert). */
const SYNC_EVERY_MS = 24 * HOUR;

/**
 * Background work for the swipe game: carry out decisions nobody can undo
 * any more, and refresh every user's media index once a day.
 */
export function startMediaScheduler(ctx: AppContext, log: FastifyBaseLogger): () => void {
  const lastSync = new Map<string, number>();
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await flushIdle(ctx, SWIPE_IDLE_MS);
      forgetOldActions(ctx, 7 * 24 * HOUR);
      const users = ctx.db
        .select({ userId: storageTargets.userId })
        .from(storageTargets)
        .where(and(eq(storageTargets.isDefault, true), eq(storageTargets.asSource, true)))
        .all();
      for (const { userId } of users) {
        const last = lastSync.get(userId);
        if (last === undefined) {
          // After a restart: spread the first syncs over the first hour.
          lastSync.set(userId, Date.now() - SYNC_EVERY_MS + Math.random() * HOUR);
          continue;
        }
        if (Date.now() - last < SYNC_EVERY_MS) continue;
        lastSync.set(userId, Date.now());
        await syncMedia(ctx, userId).catch((error: unknown) =>
          log.warn({ err: error, userId }, 'media sync failed'),
        );
      }
    } catch (error) {
      log.error({ err: error }, 'media scheduler failed');
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void tick(), 5 * MINUTE);
  timer.unref();
  return () => clearInterval(timer);
}
