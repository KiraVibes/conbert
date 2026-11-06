import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { and, eq, or } from 'drizzle-orm';
import {
  isFavoritePath,
  isPremiumPath,
  knownItemOf,
  mediaKind,
  baseName,
  type KnownItem,
} from '@conbert/core';
import type { AppContext } from '../context';
import { booruArchive, mediaItems, storageTargets, type StorageTargetRecord } from '../db/schema';
import { downloadArchive } from '../downloader/archive-path';
import { HttpError } from '../lib/http-error';

/**
 * What Conbert knows was downloaded – also after the file was deleted or
 * moved into the favourites: such files are never saved again.
 */

export function sha256OfFile(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

/** "yt-dlp youtube <id>" / "booru gelbooru 123" – stored with the file. */
export function itemKeyOf(item: KnownItem | null): string | null {
  if (!item) return null;
  return item.tool === 'yt-dlp'
    ? `yt-dlp ${item.line}`
    : `booru ${item.siteId} ${String(item.postId)}`;
}

/**
 * Makes sure the tools skip this item next time: a line in yt-dlp's archive
 * for the platform, a row in the booru archive.
 */
export async function rememberKnown(
  ctx: AppContext,
  userId: string,
  items: readonly KnownItem[],
): Promise<void> {
  const lines = new Map<string, Set<string>>();
  for (const item of items) {
    if (item.tool === 'booru') {
      ctx.db
        .insert(booruArchive)
        .values({ userId, siteId: item.siteId, postId: item.postId })
        .onConflictDoNothing()
        .run();
      continue;
    }
    const file = downloadArchive(ctx, userId, 'yt-dlp', item.platform);
    const set = lines.get(file) ?? new Set<string>();
    set.add(item.line);
    lines.set(file, set);
  }
  for (const [file, wanted] of lines) {
    const have = new Set(
      (await readFile(file, 'utf8').catch(() => ''))
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean),
    );
    const missing = [...wanted].filter((l) => !have.has(l));
    if (missing.length === 0) continue;
    await mkdir(path.dirname(file), { recursive: true });
    await appendFile(file, missing.map((l) => `${l}\n`).join(''));
  }
}

/**
 * The same file (name and size, or the same content) is already known on a
 * location: deleted by swiping, moved into the favourites, or simply there.
 */
export function knownFile(
  ctx: AppContext,
  userId: string,
  file: { name: string; size: number; sha256?: string | null },
): boolean {
  const byName = and(eq(mediaItems.name, file.name), eq(mediaItems.size, file.size));
  const row = ctx.db
    .select({ id: mediaItems.id })
    .from(mediaItems)
    .where(
      and(
        eq(mediaItems.userId, userId),
        file.sha256 ? or(byName, eq(mediaItems.sha256, file.sha256)) : byName,
      ),
    )
    .get();
  return row !== undefined;
}

/** A file was saved (download, booru): into the index right away. */
export function indexSavedFile(
  ctx: AppContext,
  userId: string,
  targetId: string,
  file: { path: string; size: number; sha256?: string | null },
): void {
  const now = new Date();
  const name = baseName(file.path);
  ctx.db
    .insert(mediaItems)
    .values({
      id: randomUUID(),
      userId,
      targetId,
      path: file.path,
      name,
      size: file.size,
      kind: mediaKind(name),
      itemKey: itemKeyOf(knownItemOf(file.path)),
      sha256: file.sha256 ?? null,
      status: isPremiumPath(file.path)
        ? 'premium'
        : isFavoritePath(file.path)
          ? 'favorite'
          : 'present',
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: [mediaItems.targetId, mediaItems.path],
      set: { size: file.size, lastSeenAt: now, ...(file.sha256 && { sha256: file.sha256 }) },
    })
    .run();
}

export type MediaProblem = 'no-default' | 'not-source' | 'not-target';

/** The user's default location (or the only one) – the swipe game's home. */
export function defaultTarget(
  ctx: AppContext,
  userId: string,
): { record: StorageTargetRecord | null; problem: MediaProblem | null } {
  const all = ctx.db.select().from(storageTargets).where(eq(storageTargets.userId, userId)).all();
  const record = all.find((t) => t.isDefault) ?? (all.length === 1 ? all[0] : undefined) ?? null;
  if (!record) return { record: null, problem: 'no-default' };
  if (!record.asSource) return { record, problem: 'not-source' };
  if (!record.asTarget) return { record, problem: 'not-target' };
  return { record, problem: null };
}

const PROBLEM_CODES = {
  'no-default': 'MEDIA_NO_DEFAULT',
  'not-source': 'STORAGE_NOT_SOURCE',
  'not-target': 'STORAGE_NOT_TARGET',
} as const;

export function requireDefaultTarget(ctx: AppContext, userId: string): StorageTargetRecord {
  const { record, problem } = defaultTarget(ctx, userId);
  if (!record || problem) throw new HttpError(422, PROBLEM_CODES[problem ?? 'no-default']);
  return record;
}
