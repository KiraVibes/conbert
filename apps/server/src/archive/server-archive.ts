import { existsSync } from 'node:fs';
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import {
  DEFAULT_ARCHIVE_KEEP_HOURS,
  MAX_ARCHIVE_KEEP_HOURS,
  type ArchivedFile,
} from '@conbert/schemas';
import type { AppContext } from '../context';
import { appSettings, files, type FileRecord } from '../db/schema';
import { removeThumbnails, thumbnailPath } from '../downloader/thumbnails';
import { deleteFileRecord } from '../storage/uploads';

/**
 * The server archive: downloads a user wanted without a storage location.
 * They are ordinary uploads (files table) marked with `archivedFrom`, which
 * live longer – the admin sets how long – and count against the quota.
 */

const KEEP_KEY = 'archive.keepHours';
const HOUR = 60 * 60 * 1000;

/** How long new files stay in the archive, in hours. */
export function archiveKeepHours(ctx: AppContext): number {
  const row = ctx.db.select().from(appSettings).where(eq(appSettings.key, KEEP_KEY)).get();
  const value = row ? Number(row.value) : NaN;
  return Number.isInteger(value) && value >= 1 && value <= MAX_ARCHIVE_KEEP_HOURS
    ? value
    : DEFAULT_ARCHIVE_KEEP_HOURS;
}

/** Changes the keeping time; files already in the archive keep their date. */
export function setArchiveKeepHours(ctx: AppContext, hours: number): void {
  ctx.db
    .insert(appSettings)
    .values({ key: KEEP_KEY, value: String(hours) })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: String(hours) } })
    .run();
}

/** Puts an uploaded file into the archive (or keeps it there longer). */
export function archiveFile(ctx: AppContext, fileId: string, source: string): void {
  ctx.db
    .update(files)
    .set({
      archivedFrom: source || '–',
      expiresAt: new Date(Date.now() + archiveKeepHours(ctx) * HOUR),
    })
    .where(eq(files.id, fileId))
    .run();
}

/** The user's archived files, newest first. */
export function archivedFiles(ctx: AppContext, userId: string, ids?: string[]): FileRecord[] {
  const own = and(eq(files.userId, userId), isNotNull(files.archivedFrom));
  return ctx.db
    .select()
    .from(files)
    .where(ids ? and(own, inArray(files.id, ids)) : own)
    .orderBy(desc(files.createdAt))
    .all();
}

export function toArchivedFile(ctx: AppContext, record: FileRecord): ArchivedFile {
  return {
    id: record.id,
    name: record.originalName,
    ext: record.ext,
    size: record.size,
    createdAt: record.createdAt.toISOString(),
    expiresAt: record.expiresAt.toISOString(),
    source: record.archivedFrom ?? '',
    thumbnail: existsSync(thumbnailPath(ctx.config, record.id)),
  };
}

/** Removes files from the archive: their data, row and preview picture. */
export async function removeArchived(ctx: AppContext, records: FileRecord[]): Promise<void> {
  for (const record of records) await deleteFileRecord(ctx, record);
  await removeThumbnails(
    ctx.config,
    records.map((r) => r.id),
  );
}
