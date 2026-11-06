import { randomUUID } from 'node:crypto';
import { checkQuota } from '../admin/quota';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { FileStore } from '@tus/file-store';
import { Server as TusServer } from '@tus/server';
import { and, eq } from 'drizzle-orm';
import { fileTypeFromFile } from 'file-type';
import { z } from 'zod';
import { getFormat, normalizeExt, refineDetectedExt } from '@conbert/core';
import { currentUser } from '../auth/plugin';
import { dataPaths } from '../config';
import type { AppContext } from '../context';
import { files, type FileRecord } from '../db/schema';
import { HttpError, apiError } from '../lib/http-error';
import { SECURITY_HEADERS } from '../lib/security-headers';

export const UPLOAD_PATH = '/api/upload';
/** Set by Conbert itself before tus sees the request (client values are removed). */
const USER_HEADER = 'x-conbert-user-id';
/** Unfinished uploads are removed after a day. */
const INCOMPLETE_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;

/** Keeps only the last path segment and removes control characters. */
export function sanitizeFileName(name: string | null | undefined): string {
  const base = (name ?? '').split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex -- stripping control characters on purpose
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (clean || 'file').slice(0, 255);
}

/** tus builds its Request from rawHeaders, so both lists must be kept in sync. */
function removeHeader(raw: FastifyRequest['raw'], name: string): void {
  raw.headers[name] = undefined;
  const list = raw.rawHeaders ?? [];
  for (let i = list.length - 2; i >= 0; i -= 2) {
    if (list[i]?.toLowerCase() === name) list.splice(i, 2);
  }
}

function setHeader(raw: FastifyRequest['raw'], name: string, value: string): void {
  removeHeader(raw, name);
  raw.headers[name] = value;
  raw.rawHeaders.push(name, value);
}

function extFromName(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? normalizeExt(name.slice(dot + 1)) : '';
}

export interface UploadService {
  store: FileStore;
  /** Deletes unfinished uploads older than a day. */
  deleteIncomplete(): Promise<number>;
}

/**
 * Resumable uploads (tus protocol) under /api/upload. Every upload belongs to
 * the signed-in user; finished uploads become rows in the `files` table.
 */
export function registerUploads(app: FastifyInstance, ctx: AppContext): UploadService {
  const directory = dataPaths(ctx.config).uploads;
  const store = new FileStore({
    directory,
    expirationPeriodInMilliseconds: INCOMPLETE_UPLOAD_TTL_MS,
  });

  const ownerOf = (req: Request) => req.headers.get(USER_HEADER) ?? '';

  const tus = new TusServer({
    path: UPLOAD_PATH,
    datastore: store,
    maxSize: ctx.config.maxUploadBytes,
    relativeLocation: true,
    namingFunction: () => randomUUID(),
    async onUploadCreate(req, upload) {
      const userId = ownerOf(req);
      if (!userId) throw { status_code: 401, body: 'Unauthorized' };
      // The announced size counts against the storage quota right away.
      try {
        checkQuota(ctx, userId, upload.size ?? 0);
      } catch (error) {
        if (error instanceof HttpError) {
          throw { status_code: 413, body: JSON.stringify(apiError(error.code, error.details)) };
        }
        throw error;
      }
      return { metadata: { ...upload.metadata, userId } };
    },
    async onIncomingRequest(req, uploadId) {
      // HEAD/PATCH/DELETE on an existing upload: only its owner may touch it.
      if (req.method === 'POST') return;
      const upload = await store.getUpload(uploadId).catch(() => undefined);
      if (!upload || upload.metadata?.['userId'] !== ownerOf(req)) {
        throw { status_code: 404, body: 'Not found' };
      }
    },
    async onUploadFinish(req, upload) {
      await recordFile(ctx, {
        id: upload.id,
        userId: ownerOf(req),
        filePath: upload.storage?.path ?? path.join(directory, upload.id),
        name: upload.metadata?.['filename'],
        size: upload.offset,
      });
      return {};
    },
  });

  // tus reads the raw body itself; Fastify must leave it alone.
  app.addContentTypeParser('application/offset+octet-stream', (_request, _payload, done) =>
    done(null),
  );

  const handler = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = currentUser(request);
    setHeader(request.raw, USER_HEADER, user.id);
    // The reply is handed to tus, so Fastify's onSend hooks won't run.
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) reply.raw.setHeader(name, value);
    reply.hijack();
    await tus.handle(request.raw, reply.raw);
  };
  app.addHook('onRequest', async (request) => {
    // Never trust an owner header coming from the client.
    if (request.url.startsWith(UPLOAD_PATH)) removeHeader(request.raw, USER_HEADER);
  });
  app.all(UPLOAD_PATH, handler);
  app.all(`${UPLOAD_PATH}/*`, handler);

  const idParams = z.object({ id: z.string().uuid() });

  /** Removes an uploaded file early (e.g. when the user removes it from the list). */
  app.delete('/api/files/:id', async (request, reply) => {
    const user = currentUser(request);
    const { id } = idParams.parse(request.params);
    const record = ctx.db
      .select()
      .from(files)
      .where(and(eq(files.id, id), eq(files.userId, user.id)))
      .get();
    if (!record) throw new HttpError(404, 'NOT_FOUND');
    await deleteFileRecord(ctx, record);
    reply.status(204);
  });

  return { store, deleteIncomplete: () => store.deleteExpired() };
}

/**
 * Registers a file that arrived in the uploads folder (by upload or from a
 * storage location). The real type comes from the content; the name is only
 * a fallback for text formats without magic bytes (SVG, CSV, JSON …).
 */
export async function recordFile(
  ctx: AppContext,
  file: {
    id: string;
    userId: string;
    filePath: string;
    name: string | null | undefined;
    size: number;
  },
): Promise<FileRecord> {
  const originalName = sanitizeFileName(file.name);
  const detected = await fileTypeFromFile(file.filePath).catch(() => undefined);
  const nameExt = extFromName(originalName) || null;
  const ext = detected ? refineDetectedExt(normalizeExt(detected.ext), nameExt) : (nameExt ?? '');
  ctx.db
    .insert(files)
    .values({
      id: file.id,
      userId: file.userId,
      originalName,
      ext,
      mime: detected?.mime ?? getFormat(ext)?.mime ?? null,
      size: file.size,
      path: file.filePath,
      expiresAt: new Date(Date.now() + ctx.config.cleanupAfterMs),
    })
    .run();
  return getOwnFile(ctx, file.userId, file.id);
}

/** Deletes a file row together with its data and tus metadata file. */
export async function deleteFileRecord(ctx: AppContext, record: FileRecord): Promise<void> {
  await rm(record.path, { force: true });
  await rm(`${record.path}.json`, { force: true });
  ctx.db.delete(files).where(eq(files.id, record.id)).run();
}

/** A file of the given user, or 404. */
export function getOwnFile(ctx: AppContext, userId: string, fileId: string): FileRecord {
  const record = ctx.db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.userId, userId)))
    .get();
  if (!record) throw new HttpError(404, 'NOT_FOUND');
  return record;
}
