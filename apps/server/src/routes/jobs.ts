import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  IMAGE_AI_INPUTS,
  describeEngine,
  findRoutes,
  getFormat,
  normalizeExt,
  readImageAi,
  readTrim,
  type Route,
  type RouteStep,
} from '@conbert/core';
import { createJobRequestSchema } from '@conbert/schemas';

type CreateJobRequestParsed = ReturnType<typeof createJobRequestSchema.parse>;
import { currentUser } from '../auth/plugin';
import type { AppContext } from '../context';
import { jobs, type JobRecord } from '../db/schema';
import { HttpError } from '../lib/http-error';
import { toJobDto } from '../queue/events';
import { getOwnFile } from '../storage/uploads';

const idParams = z.object({ id: z.string().uuid() });

/** RFC 6266 header that keeps umlauts and other characters intact. */
export function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export function getOwnJob(ctx: AppContext, userId: string, id: string): JobRecord {
  const job = ctx.db
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, id), eq(jobs.userId, userId)))
    .get();
  if (!job) throw new HttpError(404, 'NOT_FOUND');
  return job;
}

/**
 * Files for options of type 'file' (e.g. subtitles to burn in): only the
 * user's own uploads, only for an option one of the route's engines has, and
 * only with an ending that option accepts.
 */
function checkedAttachments(
  ctx: AppContext,
  userId: string,
  route: Route,
  attachments: Record<string, string>,
): Record<string, string> {
  const options = route.steps.flatMap(
    (step) => ctx.engines.find((e) => e.id === step.engineId)?.options ?? [],
  );
  for (const [key, fileId] of Object.entries(attachments)) {
    const option = options.find((o) => o.key === key && o.type === 'file');
    if (!option) throw new HttpError(400, 'BAD_REQUEST', `no file option "${key}"`);
    const file = getOwnFile(ctx, userId, fileId);
    if (!(option.accept ?? []).includes(normalizeExt(file.ext))) {
      throw new HttpError(422, 'ATTACHMENT_INVALID', `.${file.ext} for ${key}`);
    }
  }
  return attachments;
}

/** OCR is not a conversion the router picks: PDF in, searchable PDF out. */
function ocrRoute(ctx: AppContext, inputExt: string, outputExt: string): Route[] {
  const engine = ctx.engines.find((e) => e.id === 'ocrmypdf' && e.status() !== 'error');
  if (!engine || inputExt !== 'pdf' || outputExt !== 'pdf') return [];
  return [
    {
      runtime: 'server',
      steps: [{ engineId: engine.id, runtime: 'server', from: 'pdf', to: 'pdf' }],
    },
  ];
}

/**
 * AI work on a picture (background, upscaling) comes first – as PNG, which
 * keeps the transparency – then the normal route to the wanted format.
 */
function imageAiRoute(ctx: AppContext, inputExt: string, outputExt: string): Route[] {
  const engine = ctx.engines.find((e) => e.id === 'image-ai' && e.status() !== 'error');
  if (!engine || !IMAGE_AI_INPUTS.includes(inputExt)) return [];
  const first: RouteStep = {
    engineId: engine.id,
    runtime: 'server',
    from: inputExt,
    to: 'png',
    withOptions: true,
  };
  if (outputExt === 'png') return [{ runtime: 'server', steps: [first] }];
  const [rest] = findRoutes(ctx.engines.map(describeEngine), 'png', outputExt, 'server');
  return rest ? [{ runtime: 'server', steps: [first, ...rest.steps] }] : [];
}

/**
 * Creates a job for an uploaded file and queues it (the web app, scripts and
 * the CLI all come through here).
 */
export async function startJob(
  ctx: AppContext,
  userId: string,
  body: CreateJobRequestParsed,
  log: FastifyBaseLogger,
): Promise<JobRecord> {
  const { queue, runner } = ctx.jobs;
  const file = getOwnFile(ctx, userId, body.fileId);
  if (!queue.isHealthy()) throw new HttpError(503, 'QUEUE_UNAVAILABLE');

  const [route] =
    body.mode === 'ocr'
      ? ocrRoute(ctx, file.ext, body.outputExt)
      : body.mode === 'convert' && readImageAi(body.options)
        ? imageAiRoute(ctx, file.ext, body.outputExt)
        : findRoutes(ctx.engines.map(describeEngine), file.ext, body.outputExt, 'server', {
            compress: body.mode === 'compress',
            // Cutting needs one engine that can cut (see trim.ts).
            trim: body.mode === 'convert' && readTrim(body.options) !== null,
          });
  if (!route) throw new HttpError(422, 'NO_SERVER_ROUTE', `${file.ext} → ${body.outputExt}`);
  const attachments = checkedAttachments(ctx, userId, route, body.attachments);

  const id = randomUUID();
  ctx.db
    .insert(jobs)
    .values({
      id,
      userId,
      fileId: file.id,
      mode: body.mode,
      inputExt: file.ext,
      outputExt: body.outputExt,
      steps: route.steps.map(({ engineId, from, to, withOptions }) => ({
        engineId,
        from,
        to,
        ...(withOptions && { withOptions }),
      })),
      options: body.options,
      attachments,
    })
    .run();
  try {
    await queue.enqueue(id);
  } catch (err) {
    log.error({ err }, 'enqueue failed');
    runner.update(id, {
      status: 'error',
      errorKey: 'errors.queueUnavailable',
      finishedAt: new Date(),
    });
    throw new HttpError(503, 'QUEUE_UNAVAILABLE');
  }
  return getOwnJob(ctx, userId, id);
}

export function registerJobRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { queue, runner } = ctx.jobs;

  app.post('/api/jobs', async (request, reply) => {
    const user = currentUser(request);
    const body = createJobRequestSchema.parse(request.body);
    const job = await startJob(ctx, user.id, body, request.log);
    reply.status(201);
    return { job: toJobDto(job) };
  });

  app.get('/api/jobs', async (request) => {
    const user = currentUser(request);
    const rows = ctx.db
      .select()
      .from(jobs)
      .where(eq(jobs.userId, user.id))
      .orderBy(desc(jobs.createdAt))
      .limit(50)
      .all();
    return { jobs: rows.map(toJobDto) };
  });

  app.get('/api/jobs/:id', async (request) => {
    const user = currentUser(request);
    const { id } = idParams.parse(request.params);
    return { job: toJobDto(getOwnJob(ctx, user.id, id)) };
  });

  app.delete('/api/jobs/:id', async (request) => {
    const user = currentUser(request);
    const { id } = idParams.parse(request.params);
    const job = getOwnJob(ctx, user.id, id);
    if (job.status === 'queued' || job.status === 'running') {
      // Running: stop the engine. Waiting: take it out of the queue.
      if (!runner.abort(id)) {
        await queue.removeWaiting(id);
        runner.update(id, { status: 'cancelled', finishedAt: new Date(), stage: null });
      }
    }
    return { job: toJobDto(getOwnJob(ctx, user.id, id)) };
  });

  app.get('/api/jobs/:id/result', async (request, reply) => {
    const user = currentUser(request);
    const { id } = idParams.parse(request.params);
    const job = getOwnJob(ctx, user.id, id);
    if (job.status !== 'done' || !job.resultPath || !existsSync(job.resultPath)) {
      throw new HttpError(410, 'RESULT_GONE');
    }
    reply
      .header('Content-Type', getFormat(job.outputExt)?.mime ?? 'application/octet-stream')
      .header(
        'Content-Disposition',
        contentDisposition(job.resultName ?? `result.${job.outputExt}`),
      )
      .header('Cache-Control', 'private, no-store');
    if (job.resultSize !== null) reply.header('Content-Length', String(job.resultSize));
    return reply.send(createReadStream(job.resultPath));
  });
}
