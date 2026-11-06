import { randomUUID } from 'node:crypto';
import { and, eq, inArray, max, ne, notLike, sql } from 'drizzle-orm';
import {
  baseName,
  isFavoritePath,
  isPremiumPath,
  isSidecar,
  knownItemOf,
  mediaKind,
  type KnownItem,
} from '@conbert/core';
import type { MediaStatus } from '@conbert/schemas';
import type { AppContext } from '../context';
import { mediaItems } from '../db/schema';
import { HttpError } from '../lib/http-error';
import { connect, resolveRecord } from '../targets/service';
import { storageCall } from '../targets/export';
import { defaultTarget, itemKeyOf, rememberKnown, requireDefaultTarget } from './known';

/**
 * Sync with the storage location: everything found there is added to the
 * index (or updated). Nothing is ever removed – a file that is missing was
 * deleted, moved or is offline, and stays known.
 */

interface SyncState {
  running: boolean;
  seen: number;
  added: number;
  error: string | null;
}

const states = new Map<string, SyncState>();

/** Hidden folders (tool caches, .thumbs …) and sidecar files are not media. */
function worthIndexing(path: string): boolean {
  if (path.split('/').some((part) => part.startsWith('.'))) return false;
  return !isSidecar(baseName(path));
}

const statusOf = (path: string) =>
  isPremiumPath(path) ? 'premium' : isFavoritePath(path) ? 'favorite' : 'present';

export async function syncMedia(
  ctx: AppContext,
  userId: string,
): Promise<{ seen: number; added: number }> {
  const record = requireDefaultTarget(ctx, userId);
  const state = states.get(userId);
  if (state?.running) throw new HttpError(409, 'MEDIA_SYNC_RUNNING');
  const mine: SyncState = { running: true, seen: 0, added: 0, error: null };
  states.set(userId, mine);
  try {
    const known = new Map(
      ctx.db
        .select({ id: mediaItems.id, path: mediaItems.path })
        .from(mediaItems)
        .where(eq(mediaItems.targetId, record.id))
        .all()
        .map((r) => [r.path, r.id]),
    );
    const now = new Date();
    const knownItems: KnownItem[] = [];
    let batch: { path: string; size: number; modTime: string | null }[] = [];
    const write = () => {
      if (batch.length === 0) return;
      const rows = batch;
      batch = [];
      ctx.db.transaction((tx) => {
        for (const file of rows) {
          const id = known.get(file.path);
          if (id) {
            tx.update(mediaItems)
              .set({ size: file.size, modTime: file.modTime, lastSeenAt: now })
              .where(eq(mediaItems.id, id))
              .run();
            continue;
          }
          const name = baseName(file.path);
          const item = knownItemOf(file.path);
          if (item) knownItems.push(item);
          tx.insert(mediaItems)
            .values({
              id: randomUUID(),
              userId,
              targetId: record.id,
              path: file.path,
              name,
              size: file.size,
              modTime: file.modTime,
              kind: mediaKind(name),
              itemKey: itemKeyOf(item),
              status: statusOf(file.path),
              lastSeenAt: now,
            })
            .onConflictDoNothing()
            .run();
          mine.added++;
        }
      });
    };
    const connection = connect(ctx, resolveRecord(ctx, record));
    await storageCall(() =>
      connection.walk('', (file) => {
        if (!worthIndexing(file.path)) return;
        mine.seen++;
        batch.push(file);
        if (batch.length >= 500) write();
      }),
    );
    write();
    await rememberKnown(ctx, userId, knownItems);
    return { seen: mine.seen, added: mine.added };
  } catch (error) {
    mine.error = error instanceof HttpError ? error.code : 'STORAGE_FAILED';
    throw error;
  } finally {
    mine.running = false;
  }
}

/** Starts a sync in the background (the page asks for the status). */
export function startSync(ctx: AppContext, userId: string): void {
  requireDefaultTarget(ctx, userId);
  if (states.get(userId)?.running) return;
  // A failure is kept in the status (syncError) – the page shows it.
  void syncMedia(ctx, userId).catch(() => undefined);
}

export function mediaStatus(ctx: AppContext, userId: string): MediaStatus {
  const { record, problem } = defaultTarget(ctx, userId);
  const state = states.get(userId);
  const base = {
    target: record ? { id: record.id, name: record.name } : null,
    problem,
    syncing: state?.running ?? false,
    progress: state ? { seen: state.seen, added: state.added } : null,
    syncError: state?.error ?? null,
  };
  if (!record) return { ...base, items: 0, unsorted: 0, favorites: 0, lastSyncAt: null };
  const where = eq(mediaItems.targetId, record.id);
  const count = (extra: ReturnType<typeof and>) =>
    ctx.db
      .select({ n: sql<number>`count(*)` })
      .from(mediaItems)
      .where(and(where, extra))
      .get()?.n ?? 0;
  const items = count(undefined);
  const unsorted = count(
    and(
      eq(mediaItems.status, 'present'),
      ne(mediaItems.kind, 'other'),
      notLike(mediaItems.path, 'Favoriten/%'),
    ),
  );
  const favorites = count(inArray(mediaItems.status, ['favorite', 'premium']));
  const last = ctx.db
    .select({ at: max(mediaItems.lastSeenAt) })
    .from(mediaItems)
    .where(where)
    .get()?.at;
  return {
    ...base,
    items,
    unsorted,
    favorites,
    lastSyncAt: last ? new Date(last).toISOString() : null,
  };
}
