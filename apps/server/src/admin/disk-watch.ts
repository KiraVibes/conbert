import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { AppContext } from '../context';
import { users } from '../db/schema';
import { notify } from '../notifications/service';
import { diskOf } from './overview';

/**
 * Warns the admins ("Speicherplatz knapp") when the data folder is nearly
 * full: less than 5 % or 2 GB free. At most every 12 hours, so a full disk
 * doesn't flood anyone.
 */
const CHECK_MS = 10 * 60 * 1000;
const REPEAT_MS = 12 * 60 * 60 * 1000;
const MIN_FREE = 2 * 1024 ** 3;

let lastWarned = 0;

export function isLow(disk: { total: number; free: number }): boolean {
  return disk.free < Math.max(MIN_FREE, disk.total * 0.05);
}

export async function checkDisk(ctx: AppContext, log?: FastifyBaseLogger): Promise<boolean> {
  const disk = await diskOf(ctx.config.dataDir);
  if (!isLow(disk) || Date.now() - lastWarned < REPEAT_MS) return false;
  lastWarned = Date.now();
  const gb = (bytes: number) => (bytes / 1024 ** 3).toFixed(1).replace('.', ',');
  const admins = ctx.db.select({ id: users.id }).from(users).where(eq(users.role, 'admin')).all();
  log?.warn({ free: disk.free, total: disk.total }, 'data folder is nearly full');
  await Promise.all(
    admins.map((admin) =>
      notify(
        ctx,
        admin.id,
        {
          event: 'storage-low',
          titleKey: 'notifications.storageLow.title',
          bodyKey: 'notifications.storageLow.body',
          values: { free: gb(disk.free), total: gb(disk.total) },
        },
        log ? { log } : {},
      ),
    ),
  );
  return true;
}

/** Starts the regular check; returns a function that stops it. */
export function startDiskWatch(ctx: AppContext, log: FastifyBaseLogger): () => void {
  const run = () =>
    void checkDisk(ctx, log).catch((err: unknown) => log.warn({ err }, 'disk check failed'));
  const first = setTimeout(run, 60_000);
  const timer = setInterval(run, CHECK_MS);
  timer.unref();
  first.unref();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}

/** Tests: forget when the last warning went out. */
export function resetDiskWarning(): void {
  lastWarned = 0;
}
