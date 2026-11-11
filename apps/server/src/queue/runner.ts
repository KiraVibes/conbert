import { existsSync } from 'node:fs';
import { rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { and, eq, inArray } from 'drizzle-orm';
import {
  ConversionError,
  defaultOptions,
  findQualityForSize,
  getFormat,
  isAbortError,
  outputFileName,
  type Engine,
} from '@conbert/core';
import type { AppContext } from '../context';
import { files, jobs, type JobRecord } from '../db/schema';
import { isSystemKill } from '../lib/run-process';
import { tail, userName } from '../logs/who';
import { jobDir } from '../storage/cleanup';
import { toJobDto, type JobEvents } from './events';

interface Step {
  engineId: string;
  from: string;
  to: string;
  /** Gets the job's options although it isn't the last step (AI work first). */
  withOptions?: boolean;
}

/** How often progress is written to the database / sent to the browser. */
const PROGRESS_INTERVAL_MS = 250;

/**
 * Runs conversion jobs. Used by the BullMQ worker and by the inline queue in
 * tests. Jobs can be cancelled while they run.
 */
export class JobRunner {
  private readonly running = new Map<string, AbortController>();

  constructor(
    private readonly ctx: AppContext,
    readonly events: JobEvents,
  ) {}

  /** Updates a job row and tells the owner's browser. */
  update(jobId: string, patch: Partial<JobRecord>): JobRecord | undefined {
    this.ctx.db.update(jobs).set(patch).where(eq(jobs.id, jobId)).run();
    const job = this.ctx.db.select().from(jobs).where(eq(jobs.id, jobId)).get();
    if (job) this.events.emit('job', job.userId, toJobDto(job));
    return job;
  }

  isRunning(jobId: string): boolean {
    return this.running.has(jobId);
  }

  abort(jobId: string): boolean {
    const controller = this.running.get(jobId);
    controller?.abort();
    return controller !== undefined;
  }

  /**
   * Paths of the job's extra files (options of type 'file'), checked once
   * more: still the owner's, still on disk.
   */
  private attachmentPaths(job: JobRecord): Record<string, string> | undefined {
    const entries = Object.entries(job.attachments ?? {});
    if (entries.length === 0) return undefined;
    const paths: Record<string, string> = {};
    for (const [key, fileId] of entries) {
      const record = this.ctx.db
        .select()
        .from(files)
        .where(and(eq(files.id, fileId), eq(files.userId, job.userId)))
        .get();
      if (!record || !existsSync(record.path)) {
        throw new ConversionError('errors.attachmentGone', key);
      }
      paths[key] = record.path;
    }
    return paths;
  }

  async run(jobId: string): Promise<void> {
    const job = this.ctx.db.select().from(jobs).where(eq(jobs.id, jobId)).get();
    // Cancelled while waiting, already handled, or running here already (a
    // job a restart interrupted can come twice: resumeJobs and BullMQ itself).
    if (!job || job.status !== 'queued' || this.running.has(jobId)) return;

    const file = job.fileId
      ? this.ctx.db.select().from(files).where(eq(files.id, job.fileId)).get()
      : undefined;
    if (!file) {
      this.finish(jobId, { status: 'error', errorKey: 'errors.resultGone' });
      return;
    }

    const controller = new AbortController();
    this.running.set(jobId, controller);
    const workDir = jobDir(this.ctx, jobId);
    this.update(jobId, { status: 'running', startedAt: new Date(), progress: 0, stage: null });

    const steps = job.steps as Step[];
    let lastWrite = 0;
    try {
      const attachments = this.attachmentPaths(job);
      let input = file.path;
      for (const [index, step] of steps.entries()) {
        const engine = this.engine(step.engineId);
        const isLast = index === steps.length - 1;
        const options =
          isLast || step.withOptions
            ? {
                ...defaultOptions(engine.options, step.to),
                // Name for the result's metadata (HTML title, GBA cartridge title).
                title: file.originalName.replace(/\.[^.]+$/, ''),
                ...(job.options as Record<string, unknown>),
              }
            : defaultOptions(engine.options, step.to);
        const run = (stepOptions: Record<string, unknown>) =>
          engine.convert({
            input,
            inputExt: step.from,
            outputExt: step.to,
            options: stepOptions,
            workDir,
            ...(attachments && { attachments }),
            signal: controller.signal,
            onProgress: ({ percent, stage }) => {
              const now = Date.now();
              if (now - lastWrite < PROGRESS_INTERVAL_MS && percent < 100) return;
              lastWrite = now;
              const overall = Math.round(((index + percent / 100) / steps.length) * 100);
              this.update(jobId, { progress: Math.min(99, overall), stage: stage ?? null });
            },
          });
        const targetBytes = Number(options['targetBytes']);
        // Pictures to a target size: try a few qualities, keep the best fit.
        const searchSize =
          isLast &&
          job.mode === 'compress' &&
          targetBytes > 0 &&
          getFormat(step.to)?.category === 'image';
        const output = searchSize
          ? await findQualityForSize(
              async (quality) => {
                const out = await run({ ...options, quality });
                return { out, size: typeof out === 'string' ? (await stat(out)).size : 0 };
              },
              (r) => r.size,
              targetBytes,
              (attempt, total) =>
                this.update(jobId, {
                  progress: Math.round((attempt / total) * 95),
                  stage: 'converting',
                }),
            ).then((r) => r.out)
          : await run(options);
        if (typeof output !== 'string') {
          throw new ConversionError('errors.convertFailed', 'server engine returned no file');
        }
        input = output;
      }

      const resultPath = path.join(workDir, `result.${job.outputExt}`);
      await rename(input, resultPath);
      const { size } = await stat(resultPath);
      const expiresAt = new Date(Date.now() + this.ctx.config.cleanupAfterMs);
      // Keep the upload as long as the result, so "convert again" still works.
      this.ctx.db.update(files).set({ expiresAt }).where(eq(files.id, file.id)).run();
      this.finish(jobId, {
        status: 'done',
        progress: 100,
        stage: 'done',
        resultPath,
        resultName: outputFileName(file.originalName, job.outputExt),
        resultSize: size,
        expiresAt,
      });
    } catch (error) {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
      if (controller.signal.aborted || isAbortError(error)) {
        this.finish(jobId, { status: 'cancelled', stage: null });
      } else if (error instanceof ConversionError) {
        this.finish(jobId, {
          status: 'error',
          // Out of memory on the server explains itself better than "failed".
          errorKey: isSystemKill(error.details) ? 'errors.serverOutOfMemory' : error.messageKey,
          errorDetails: error.details ?? null,
        });
      } else {
        this.finish(jobId, {
          status: 'error',
          errorKey: 'errors.convertFailed',
          errorDetails: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      this.running.delete(jobId);
    }
  }

  private finish(jobId: string, patch: Partial<JobRecord>): void {
    this.update(jobId, {
      finishedAt: new Date(),
      expiresAt: new Date(Date.now() + this.ctx.config.cleanupAfterMs),
      ...patch,
    });
    const job = this.ctx.db.select().from(jobs).where(eq(jobs.id, jobId)).get();
    if (!job) return;
    const entry = {
      area: 'job',
      job: job.id,
      user: userName(this.ctx, job.userId),
      mode: job.mode,
      from: job.inputExt,
      to: job.outputExt,
      engines: (job.steps as Step[]).map((s) => s.engineId),
      ...(job.startedAt &&
        job.finishedAt && {
          seconds: Math.round((job.finishedAt.getTime() - job.startedAt.getTime()) / 100) / 10,
        }),
      ...(job.resultSize !== null && { resultBytes: job.resultSize }),
    };
    if (job.status === 'done') this.ctx.log.info(entry, 'conversion finished');
    else if (job.status === 'cancelled') this.ctx.log.info(entry, 'conversion cancelled');
    else {
      this.ctx.log.warn(
        { ...entry, errorKey: job.errorKey, details: tail(job.errorDetails) },
        'conversion failed',
      );
    }
  }

  private engine(id: string): Engine {
    const engine = this.ctx.engines.find((e) => e.id === id);
    if (!engine) throw new ConversionError('errors.noServerRoute', `engine ${id} not available`);
    return engine;
  }
}

/**
 * After a restart: conversions that were running start over (the upload is
 * still there), waiting ones are queued again. A job that is still in the
 * queue is not added twice.
 */
export async function resumeJobs(ctx: AppContext): Promise<void> {
  const rows = ctx.db
    .select({ id: jobs.id, status: jobs.status })
    .from(jobs)
    .where(inArray(jobs.status, ['queued', 'running']))
    .all();
  for (const row of rows) {
    if (row.status === 'running') {
      await rm(jobDir(ctx, row.id), { recursive: true, force: true }).catch(() => undefined);
      ctx.jobs.runner.update(row.id, { status: 'queued', progress: 0, stage: null });
    }
    await ctx.jobs.queue.enqueue(row.id).catch(() => undefined);
  }
}
