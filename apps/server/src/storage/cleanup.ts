import { rm } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import { lt } from 'drizzle-orm';
import { deleteExpiredSessions } from '../auth/sessions';
import { dataPaths } from '../config';
import type { AppContext } from '../context';
import { files, jobs } from '../db/schema';
import { removeThumbnails } from '../downloader/thumbnails';
import { deleteFileRecord, type UploadService } from './uploads';

export interface CleanupResult {
  files: number;
  jobs: number;
  sessions: number;
  incompleteUploads: number;
}

/** Folder for the temporary files of one job: /data/tmp/<jobId>. */
export function jobDir(ctx: AppContext, jobId: string): string {
  return path.join(dataPaths(ctx.config).tmp, jobId);
}

/**
 * Deletes expired uploads, job results and sessions. Runs in-process on a
 * timer so it keeps working even when the job queue (Valkey) is down.
 */
export async function runCleanup(
  ctx: AppContext,
  uploads: UploadService | undefined,
  now = new Date(),
): Promise<CleanupResult> {
  const expiredFiles = ctx.db.select().from(files).where(lt(files.expiresAt, now)).all();
  for (const record of expiredFiles) await deleteFileRecord(ctx, record);
  // Downloads keep a preview picture (archive, download list) – it goes with them.
  await removeThumbnails(
    ctx.config,
    expiredFiles.map((r) => r.id),
  );

  const expiredJobs = ctx.db.select().from(jobs).where(lt(jobs.expiresAt, now)).all();
  for (const job of expiredJobs) {
    await rm(jobDir(ctx, job.id), { recursive: true, force: true });
  }
  if (expiredJobs.length > 0) ctx.db.delete(jobs).where(lt(jobs.expiresAt, now)).run();

  return {
    files: expiredFiles.length,
    jobs: expiredJobs.length,
    sessions: deleteExpiredSessions(ctx.db),
    incompleteUploads: uploads ? await uploads.deleteIncomplete().catch(() => 0) : 0,
  };
}

const INTERVAL_MS = 10 * 60 * 1000;

/** Starts the cleanup timer; returns a function that stops it. */
export function startCleanup(
  ctx: AppContext,
  uploads: UploadService,
  log: FastifyBaseLogger,
): () => void {
  const tick = () => {
    runCleanup(ctx, uploads)
      .then((r) => {
        if (r.files + r.jobs + r.incompleteUploads > 0) log.info(r, 'cleanup finished');
      })
      .catch((err: unknown) => log.error({ err }, 'cleanup failed'));
  };
  tick();
  const timer = setInterval(tick, INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
