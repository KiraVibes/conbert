import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import sharp from 'sharp';
import {
  DHASH_HEIGHT,
  DHASH_WIDTH,
  SIMILARITY_LEVELS,
  dHash,
  groupSimilar,
  hashDistance,
  type SimilarityLevel,
} from '@conbert/core';
import type { SimilarItem, SimilarResponse, SimilarScan } from '@conbert/schemas';
import { dataPaths } from '../config';
import type { AppContext } from '../context';
import { mediaItems, type MediaItemRecord } from '../db/schema';
import { API_ERROR_KEYS, HttpError } from '../lib/http-error';
import { storageCall } from '../targets/export';
import { connect, resolveRecord } from '../targets/service';
import { requireDefaultTarget } from './known';

/**
 * Similar pictures in the media index: every picture gets a fingerprint
 * (dHash) once, in the background; groups are worked out on request.
 * Deleting goes through the swipe decisions (see swipe.ts).
 */

const IDLE: SimilarScan = { running: false, done: 0, total: 0, failed: 0, error: null };
const scans = new Map<string, SimilarScan>();
/** Above this, comparing every picture with every other one gets slow. */
const MAX_COMPARED = 40_000;

const LIVE = ['present', 'kept', 'favorite', 'premium'] as const;

function inFolders(itemPath: string, folders: readonly string[]): boolean {
  return folders.length === 0 || folders.some((f) => itemPath.startsWith(`${f}/`));
}

/** Fingerprint and size of one picture file. */
export async function fingerprint(
  file: string,
): Promise<{ hash: string; width: number | null; height: number | null }> {
  // First frame only (GIFs); .rotate() follows the EXIF orientation.
  const image = sharp(file, { animated: false, failOn: 'none' });
  const meta = await image.metadata();
  const grey = await image
    .rotate()
    .greyscale()
    .resize(DHASH_WIDTH, DHASH_HEIGHT, { fit: 'fill', kernel: 'cubic' })
    .raw()
    .toBuffer();
  const sideways = (meta.orientation ?? 1) >= 5;
  return {
    hash: dHash(grey),
    width: (sideways ? meta.height : meta.width) ?? null,
    height: (sideways ? meta.width : meta.height) ?? null,
  };
}

export function similarScan(userId: string): SimilarScan {
  return scans.get(userId) ?? IDLE;
}

/** Pictures that are still there (optionally only those without a fingerprint). */
function pictures(
  ctx: AppContext,
  userId: string,
  targetId: string,
  onlyNew = false,
): MediaItemRecord[] {
  return ctx.db
    .select()
    .from(mediaItems)
    .where(
      and(
        eq(mediaItems.userId, userId),
        eq(mediaItems.targetId, targetId),
        inArray(mediaItems.kind, ['image', 'gif']),
        inArray(mediaItems.status, [...LIVE]),
        onlyNew ? isNull(mediaItems.phash) : undefined,
      ),
    )
    .all();
}

/** Fingerprints every picture (in the folders) that has none yet – in the background. */
export function startSimilarScan(ctx: AppContext, userId: string, folders: string[]): SimilarScan {
  if (similarScan(userId).running) return similarScan(userId);
  const target = requireDefaultTarget(ctx, userId);
  const todo = pictures(ctx, userId, target.id, true).filter((item) =>
    inFolders(item.path, folders),
  );
  const scan: SimilarScan = { running: true, done: 0, total: todo.length, failed: 0, error: null };
  scans.set(userId, scan);
  void (async () => {
    try {
      const connection = connect(ctx, resolveRecord(ctx, target));
      for (const item of todo) {
        const tmp = path.join(dataPaths(ctx.config).tmp, `similar-${randomUUID()}`);
        let set: Partial<MediaItemRecord> = { phash: '' };
        try {
          await storageCall(() => connection.download(item.path, tmp));
          const print = await fingerprint(tmp);
          set = { phash: print.hash, width: print.width, height: print.height };
        } catch {
          // Unreadable or gone: marked, so it isn't tried again and again.
          scan.failed++;
        } finally {
          await rm(tmp, { force: true });
        }
        ctx.db.update(mediaItems).set(set).where(eq(mediaItems.id, item.id)).run();
        scan.done++;
      }
    } catch (error) {
      // A text key, ready to show.
      scan.error = error instanceof HttpError ? API_ERROR_KEYS[error.code] : 'errors.storageFailed';
    } finally {
      scan.running = false;
    }
  })();
  return scan;
}

/** Best first: most pixels, then the bigger file. */
function better(a: MediaItemRecord, b: MediaItemRecord): number {
  const pixels = (i: MediaItemRecord) => (i.width ?? 0) * (i.height ?? 0);
  return pixels(b) - pixels(a) || b.size - a.size || a.path.localeCompare(b.path);
}

/** Groups of similar pictures in the chosen folders. */
export function similarGroups(
  ctx: AppContext,
  userId: string,
  level: SimilarityLevel,
  folders: string[],
): SimilarResponse {
  const target = requireDefaultTarget(ctx, userId);
  const all = pictures(ctx, userId, target.id).filter((item) => inFolders(item.path, folders));
  const hashed = all.filter((i) => i.phash);
  const unhashed = all.filter((i) => i.phash === null).length;
  const compared = hashed.slice(0, MAX_COMPARED);
  const byId = new Map(compared.map((i) => [i.id, i]));
  const groups = groupSimilar(
    compared.map((i) => ({ id: i.id, hash: i.phash ?? '' })),
    SIMILARITY_LEVELS[level],
  )
    .map((ids) =>
      ids
        .map((id) => byId.get(id))
        .filter((i) => i !== undefined)
        .sort(better),
    )
    .sort(
      (a, b) => b.length - a.length || better(a[0] as MediaItemRecord, b[0] as MediaItemRecord),
    );
  const toItem = (row: MediaItemRecord, best: MediaItemRecord): SimilarItem => ({
    id: row.id,
    targetId: row.targetId,
    path: row.path,
    name: row.name,
    size: row.size,
    kind: row.kind === 'gif' ? 'gif' : 'image',
    status: row.status as SimilarItem['status'],
    width: row.width,
    height: row.height,
    distance: hashDistance(row.phash ?? '', best.phash ?? ''),
  });
  return {
    scan: similarScan(userId),
    unhashed,
    hashed: hashed.length,
    groups: groups.map((g) => g.map((row) => toItem(row, g[0] as MediaItemRecord))),
  };
}
