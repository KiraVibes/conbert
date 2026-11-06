import { stat } from 'node:fs/promises';
import type { z } from 'zod';
import { downloadFolder, joinStoragePath, numberedName, safeName } from '@conbert/core';
import type { ExportResult, exportRequestSchema } from '@conbert/schemas';
import type { AppContext } from '../context';
import { API_ERROR_KEYS, HttpError } from '../lib/http-error';
import { indexSavedFile, knownFile, sha256OfFile } from '../media/known';
import { StorageError } from './rclone';
import { assertInsideRoot, connect, getOwnTarget, relativePath, resolveRecord } from './service';

/** Storage problems become API errors with a three-part explanation. */
export async function storageCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof StorageError) throw new HttpError(422, error.code, error.details);
    throw error;
  }
}

export interface ExportSource {
  filePath: string;
  name: string;
  ext: string;
}

/** Saves one file to one or more locations; each location reports on its own. */
export async function exportFile(
  ctx: AppContext,
  userId: string,
  source: ExportSource,
  body: z.infer<typeof exportRequestSchema>,
  /** Downloads: {platform}, {username} and the folder named after the source. */
  extra: {
    platform?: string | undefined;
    username?: string | undefined;
    source?: string | undefined;
    /** Downloads: the platform's top folder ("Instagram", "4chan/g"). */
    platformFolder?: string | undefined;
    /**
     * Downloads: a file with the same name and size is already there – it is
     * the same file, so it is skipped instead of saved again as "name (2)".
     */
    sameFileSkips?: boolean;
    /** Downloads and booru: the saved file goes into the media index right away. */
    index?: boolean;
  } = {},
): Promise<ExportResult[]> {
  const name = safeName(body.name ?? source.name);
  const results: ExportResult[] = [];
  // Downloads: deleted by swiping, moved into the favourites or simply there
  // somewhere else – the same file is never saved again.
  let fingerprint: { size: number; sha256: string } | null = null;
  if (extra.sameFileSkips || extra.index) {
    const info = await stat(source.filePath).catch(() => null);
    if (info) fingerprint = { size: info.size, sha256: await sha256OfFile(source.filePath) };
  }
  if (extra.sameFileSkips && fingerprint && knownFile(ctx, userId, { name, ...fingerprint })) {
    return body.targetIds.map((targetId) => ({
      targetId,
      status: 'skipped' as const,
      path: null,
      error: null,
    }));
  }
  for (const targetId of body.targetIds) {
    try {
      const record = getOwnTarget(ctx, userId, targetId);
      if (!record.asTarget) throw new HttpError(422, 'STORAGE_NOT_TARGET', record.name);
      const target = resolveRecord(ctx, record);
      const folder =
        body.folder !== undefined
          ? relativePath(body.folder)
          : downloadFolder(record.subfolderPattern, {
              date: new Date(),
              ext: source.ext,
              ...(body.category && { category: body.category }),
              ...(extra.platform && { platform: extra.platform }),
              ...(extra.username && { username: extra.username }),
              ...(extra.source && { source: extra.source }),
              ...(extra.platformFolder && { platformFolder: extra.platformFolder }),
            });
      await assertInsideRoot(target, folder);
      const connection = connect(ctx, target);
      let finalName = name;
      // Only a file counts as taken (S3 reports any missing path as an empty folder).
      const fileExists = async (file: string) =>
        (await storageCall(() => connection.stat(joinStoragePath(folder, file))))?.isDir === false;
      const existing = await fileExists(finalName);
      if (existing && extra.sameFileSkips) {
        const there = await storageCall(() => connection.stat(joinStoragePath(folder, finalName)));
        const here = await stat(source.filePath).catch(() => null);
        if (there && here && there.size === here.size) {
          results.push({
            targetId,
            status: 'skipped',
            path: joinStoragePath(folder, name),
            error: null,
          });
          continue;
        }
      }
      if (existing && record.conflictPolicy === 'skip') {
        results.push({
          targetId,
          status: 'skipped',
          path: joinStoragePath(folder, name),
          error: null,
        });
        continue;
      }
      if (existing && record.conflictPolicy === 'rename') {
        for (let n = 2; ; n++) {
          if (n > 999) throw new HttpError(409, 'STORAGE_FAILED', 'too many copies');
          finalName = numberedName(name, n);
          const taken = await fileExists(finalName);
          if (!taken) break;
        }
      }
      const destination = joinStoragePath(folder, finalName);
      await storageCall(() => connection.upload(source.filePath, destination));
      if (fingerprint) indexSavedFile(ctx, userId, targetId, { path: destination, ...fingerprint });
      results.push({ targetId, status: 'saved', path: destination, error: null });
    } catch (error) {
      if (!(error instanceof HttpError)) throw error;
      results.push({
        targetId,
        status: 'error',
        path: null,
        error: {
          messageKey: API_ERROR_KEYS[error.code],
          ...(error.details && { details: error.details }),
        },
      });
    }
  }
  return results;
}
