import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { getFormat } from '@conbert/core';
import { checkQuota, quotaOf, usageOf } from '../admin/quota';
import { currentUser } from '../auth/plugin';
import { dataPaths } from '../config';
import type { AppContext } from '../context';
import type { FileRecord } from '../db/schema';
import { API_ERROR_KEYS, HttpError } from '../lib/http-error';
import { toJobDto } from '../queue/events';
import { recordFile } from '../storage/uploads';
import { contentDisposition, getOwnJob, startJob } from './jobs';

/**
 * Simple endpoints for scripts, Home Assistant, n8n and the CLI: the file
 * goes in as the raw request body (no tus, no multipart), any content type.
 *
 *   POST /api/files?name=foto.heic            → { file }
 *   POST /api/convert?to=jpg&name=foto.heic   → the converted file
 */

const fileQuery = z.object({ name: z.string().max(255).optional() });

const convertQuery = z.object({
  to: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]{1,10}$/),
  name: z.string().max(255).optional(),
  mode: z.enum(['convert', 'compress', 'ocr']).default('convert'),
  /** Options as JSON, e.g. {"quality":80}. */
  options: z
    .string()
    .max(4000)
    .optional()
    .transform((v, ctx) => {
      if (!v) return {} as Record<string, unknown>;
      try {
        return z.record(z.string(), z.unknown()).parse(JSON.parse(v));
      } catch {
        ctx.addIssue({ code: 'custom', message: 'options must be a JSON object' });
        return z.NEVER;
      }
    }),
  /** How long to wait for the result (seconds); after that the job is returned. */
  wait: z.coerce.number().int().min(0).max(1800).default(600),
});

/** Saves the raw request body as an upload of the user. */
async function receiveFile(
  ctx: AppContext,
  request: FastifyRequest,
  name: string | undefined,
): Promise<FileRecord> {
  const user = currentUser(request);
  const dir = dataPaths(ctx.config).uploads;
  await mkdir(dir, { recursive: true });
  const id = randomUUID();
  const filePath = path.join(dir, id);
  const limit = ctx.config.maxUploadBytes;
  // Storage quota: refuse early when the announced size doesn't fit, and stop
  // the upload as soon as it grows past the room that is left.
  checkQuota(ctx, user.id, Number(request.headers['content-length'] ?? 0));
  const quota = quotaOf(ctx, user.id);
  const room = quota === null ? Infinity : quota - usageOf(ctx, user.id);
  let size = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      if (size > limit) callback(new HttpError(413, 'FILE_TOO_LARGE', `> ${limit} bytes`));
      else if (size > room) callback(new HttpError(413, 'QUOTA_EXCEEDED', `${quota ?? 0}`));
      else callback(null, chunk);
    },
  });
  try {
    await pipeline(request.raw, counter, createWriteStream(filePath));
  } catch (error) {
    await rm(filePath, { force: true });
    throw error instanceof HttpError ? error : new HttpError(400, 'BAD_REQUEST', String(error));
  }
  if (size === 0) {
    await rm(filePath, { force: true });
    throw new HttpError(400, 'BAD_REQUEST', 'empty body – send the file as the request body');
  }
  return recordFile(ctx, { id, userId: user.id, filePath, name: name ?? 'upload', size });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function registerScriptingRoutes(app: FastifyInstance, ctx: AppContext): void {
  // Own scope: every content type is taken as raw bytes (curl --data-binary
  // sends "application/x-www-form-urlencoded" unless told otherwise).
  void app.register(async (scoped) => {
    scoped.removeAllContentTypeParsers();
    scoped.addContentTypeParser('*', (_request, _payload, done) => done(null));

    scoped.post('/api/files', async (request, reply) => {
      const { name } = fileQuery.parse(request.query);
      const file = await receiveFile(ctx, request, name);
      return reply.status(201).send({
        file: { id: file.id, name: file.originalName, ext: file.ext, size: file.size },
      });
    });

    scoped.post('/api/convert', async (request, reply) => {
      const user = currentUser(request);
      const query = convertQuery.parse(request.query);
      const file = await receiveFile(ctx, request, query.name);
      const job = await startJob(
        ctx,
        user.id,
        {
          fileId: file.id,
          outputExt: query.to,
          options: query.options,
          attachments: {},
          mode: query.mode,
        },
        request.log,
      );
      // The caller hung up: no need to keep working.
      let gone = false;
      request.raw.on('close', () => {
        if (!reply.sent) gone = true;
      });
      const deadline = Date.now() + query.wait * 1000;
      let current = job;
      while (current.status === 'queued' || current.status === 'running') {
        if (gone) {
          ctx.jobs.runner.abort(job.id);
          return reply;
        }
        if (Date.now() >= deadline) return reply.status(202).send({ job: toJobDto(current) });
        await sleep(300);
        current = getOwnJob(ctx, user.id, job.id);
      }
      if (current.status !== 'done' || !current.resultPath || !existsSync(current.resultPath)) {
        // The engine's own error text (three-part key), plus the job for details.
        return reply.status(422).send({
          error: {
            code: 'CONVERSION_FAILED',
            messageKey: current.errorKey ?? API_ERROR_KEYS.CONVERSION_FAILED,
            ...(current.errorDetails && { details: current.errorDetails }),
          },
          job: toJobDto(current),
        });
      }
      reply
        .header('Content-Type', getFormat(current.outputExt)?.mime ?? 'application/octet-stream')
        .header(
          'Content-Disposition',
          contentDisposition(current.resultName ?? `result.${current.outputExt}`),
        )
        .header('X-Conbert-Job', current.id)
        .header('Cache-Control', 'private, no-store');
      if (current.resultSize !== null) reply.header('Content-Length', String(current.resultSize));
      return reply.send(createReadStream(current.resultPath));
    });
  });
}
