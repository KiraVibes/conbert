import { randomUUID } from 'node:crypto';
import { checkQuota } from '../admin/quota';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getFormat, joinStoragePath, safeName } from '@conbert/core';
import {
  exportRequestSchema,
  importRequestSchema,
  mkdirRequestSchema,
  probeMkdirRequestSchema,
  probeRequestSchema,
  patchTargetRequestSchema,
  saveTargetRequestSchema,
} from '@conbert/schemas';
import { currentUser } from '../auth/plugin';
import { dataPaths } from '../config';
import type { AppContext } from '../context';
import { jobs, storageTargets, type StorageTargetRecord } from '../db/schema';
import { HttpError } from '../lib/http-error';
import { recordFile, getOwnFile } from '../storage/uploads';
import { exportFile, storageCall } from '../targets/export';
import {
  assertInsideRoot,
  connect,
  getOwnTarget,
  relativePath,
  resolveRecord,
  saveTarget,
  toTargetDto,
  validateTarget,
} from '../targets/service';
import { contentDisposition } from './jobs';

const idParams = z.object({ id: z.string().uuid() });
const browseQuery = z.object({ path: z.string().max(1024).optional() });
const fileQuery = z.object({ path: z.string().min(1).max(1024) });
/** Files bigger than this are not fetched just to look at them. */
const PREVIEW_MAX_BYTES = 300 * 1024 * 1024;

/**
 * Whether something is really mounted at a root (or right below it). The
 * image ships an empty /storage; files saved there without a mount would be
 * lost with the next container update, so such a root is not offered.
 */
export async function hasMountedStorage(root: string): Promise<boolean> {
  try {
    const own = await stat(root);
    if (!own.isDirectory()) return false;
    if (own.dev !== (await stat(path.dirname(root))).dev) return true;
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if ((await stat(path.join(root, entry.name))).dev !== own.dev) return true;
    }
    return false;
  } catch {
    return false;
  }
}

// Saving to locations lives in targets/export.ts (also used by the downloader).

export function registerTargetRoutes(app: FastifyInstance, ctx: AppContext): void {
  const list = (userId: string): StorageTargetRecord[] =>
    ctx.db
      .select()
      .from(storageTargets)
      .where(eq(storageTargets.userId, userId))
      .orderBy(asc(storageTargets.name))
      .all();

  app.get('/api/targets', async (request) => {
    const user = currentUser(request);
    return { targets: list(user.id).map(toTargetDto) };
  });

  /** Folders that "local folder" locations may use (mounted into the container). */
  app.get('/api/targets/roots', async () => {
    const roots = [];
    for (const root of ctx.config.storageRoots) if (await hasMountedStorage(root)) roots.push(root);
    return { roots };
  });

  app.post('/api/targets', async (request, reply) => {
    const user = currentUser(request);
    const body = saveTargetRequestSchema.parse(request.body);
    const record = saveTarget(ctx, user.id, body);
    reply.status(201);
    return { target: toTargetDto(record) };
  });

  app.put('/api/targets/:id', async (request) => {
    const user = currentUser(request);
    const { id } = idParams.parse(request.params);
    const existing = getOwnTarget(ctx, user.id, id);
    const body = saveTargetRequestSchema.parse(request.body);
    if (body.type !== existing.type) throw new HttpError(400, 'BAD_REQUEST', 'type');
    return { target: toTargetDto(saveTarget(ctx, user.id, body, existing)) };
  });

  // Quick edit: name, use and default – the connection and passwords stay untouched.
  app.patch('/api/targets/:id', async (request) => {
    const user = currentUser(request);
    const { id } = idParams.parse(request.params);
    getOwnTarget(ctx, user.id, id);
    const body = patchTargetRequestSchema.parse(request.body);
    ctx.db.transaction((tx) => {
      if (body.isDefault) {
        tx.update(storageTargets)
          .set({ isDefault: false })
          .where(eq(storageTargets.userId, user.id))
          .run();
      }
      tx.update(storageTargets)
        .set({
          ...(body.name !== undefined && { name: body.name }),
          ...(body.usage && { asTarget: body.usage.asTarget, asSource: body.usage.asSource }),
          ...(body.isDefault !== undefined && { isDefault: body.isDefault }),
          updatedAt: new Date(),
        })
        .where(and(eq(storageTargets.id, id), eq(storageTargets.userId, user.id)))
        .run();
    });
    return { target: toTargetDto(getOwnTarget(ctx, user.id, id)) };
  });

  app.delete('/api/targets/:id', async (request, reply) => {
    const user = currentUser(request);
    const { id } = idParams.parse(request.params);
    getOwnTarget(ctx, user.id, id);
    ctx.db
      .delete(storageTargets)
      .where(and(eq(storageTargets.id, id), eq(storageTargets.userId, user.id)))
      .run();
    reply.status(204);
  });

  /**
   * Test a location before saving it (or a saved one with changed fields) and
   * list one folder – used by the setup wizard and its folder picker.
   */
  app.post('/api/targets/probe', async (request) => {
    const user = currentUser(request);
    const body = probeRequestSchema.parse(request.body);
    const previous = body.id ? resolveRecord(ctx, getOwnTarget(ctx, user.id, body.id)).secrets : {};
    const target = validateTarget(ctx, body.target, previous);
    const folder = relativePath(body.path);
    await assertInsideRoot(target, folder);
    const listing = await storageCall(() => connect(ctx, target).list(folder));
    return { path: folder, ...listing };
  });

  /** A new folder from the setup wizard, before the location is saved. */
  app.post('/api/targets/probe/mkdir', async (request) => {
    const user = currentUser(request);
    const body = probeMkdirRequestSchema.parse(request.body);
    const previous = body.id ? resolveRecord(ctx, getOwnTarget(ctx, user.id, body.id)).secrets : {};
    const target = validateTarget(ctx, body.target, previous);
    const folder = joinStoragePath(relativePath(body.path), safeName(body.name));
    await assertInsideRoot(target, folder);
    await storageCall(() => connect(ctx, target).mkdir(folder));
    return { path: folder };
  });

  app.post('/api/targets/:id/test', async (request) => {
    const user = currentUser(request);
    const { id } = idParams.parse(request.params);
    const target = resolveRecord(ctx, getOwnTarget(ctx, user.id, id));
    await assertInsideRoot(target, '');
    const listing = await storageCall(() => connect(ctx, target).list(''));
    return { ok: true, entries: listing.entries.length };
  });

  app.get('/api/targets/:id/browse', async (request) => {
    const user = currentUser(request);
    const { id } = idParams.parse(request.params);
    const folder = relativePath(browseQuery.parse(request.query).path);
    const target = resolveRecord(ctx, getOwnTarget(ctx, user.id, id));
    await assertInsideRoot(target, folder);
    const listing = await storageCall(() => connect(ctx, target).list(folder));
    return { path: folder, ...listing };
  });

  app.post('/api/targets/:id/mkdir', async (request) => {
    const user = currentUser(request);
    const { id } = idParams.parse(request.params);
    const body = mkdirRequestSchema.parse(request.body);
    const record = getOwnTarget(ctx, user.id, id);
    if (!record.asTarget) throw new HttpError(422, 'STORAGE_NOT_TARGET', record.name);
    const target = resolveRecord(ctx, record);
    const folder = joinStoragePath(relativePath(body.path), safeName(body.name));
    await assertInsideRoot(target, folder);
    await storageCall(() => connect(ctx, target).mkdir(folder));
    return { path: folder };
  });

  /** Copies files from a location to Conbert; they then work like uploads. */
  app.post('/api/targets/:id/import', async (request) => {
    const user = currentUser(request);
    const { id } = idParams.parse(request.params);
    const body = importRequestSchema.parse(request.body);
    const record = getOwnTarget(ctx, user.id, id);
    if (!record.asSource) throw new HttpError(422, 'STORAGE_NOT_SOURCE', record.name);
    const target = resolveRecord(ctx, record);
    const connection = connect(ctx, target);
    const uploads = dataPaths(ctx.config).uploads;
    await mkdir(uploads, { recursive: true });
    const imported = [];
    for (const raw of body.paths) {
      const file = relativePath(raw);
      await assertInsideRoot(target, file);
      const entry = await storageCall(() => connection.stat(file));
      if (!entry) throw new HttpError(404, 'STORAGE_NOT_FOUND', file);
      if (entry.isDir) throw new HttpError(422, 'STORAGE_IS_FOLDER', file);
      if (entry.size > ctx.config.maxUploadBytes) throw new HttpError(413, 'FILE_TOO_LARGE', file);
      checkQuota(ctx, user.id, entry.size);
      const fileId = randomUUID();
      const filePath = path.join(uploads, fileId);
      try {
        await storageCall(() => connection.download(file, filePath));
        const saved = await recordFile(ctx, {
          id: fileId,
          userId: user.id,
          filePath,
          name: path.posix.basename(file),
          size: entry.size,
        });
        imported.push({ fileId, name: saved.originalName, ext: saved.ext, size: saved.size });
      } catch (error) {
        await rm(filePath, { force: true });
        throw error;
      }
    }
    return { files: imported };
  });

  /**
   * One file of a location, only to look at it (preview while choosing what to
   * open). Nothing is kept: the temporary copy is deleted once it was sent.
   */
  app.get('/api/targets/:id/file', async (request, reply) => {
    const user = currentUser(request);
    const { id } = idParams.parse(request.params);
    const record = getOwnTarget(ctx, user.id, id);
    if (!record.asSource) throw new HttpError(422, 'STORAGE_NOT_SOURCE', record.name);
    const target = resolveRecord(ctx, record);
    const file = relativePath(fileQuery.parse(request.query).path);
    await assertInsideRoot(target, file);
    const connection = connect(ctx, target);
    const entry = await storageCall(() => connection.stat(file));
    if (!entry) throw new HttpError(404, 'STORAGE_NOT_FOUND', file);
    if (entry.isDir) throw new HttpError(422, 'STORAGE_IS_FOLDER', file);
    if (entry.size > Math.min(PREVIEW_MAX_BYTES, ctx.config.maxUploadBytes)) {
      throw new HttpError(413, 'STORAGE_PREVIEW_TOO_LARGE', String(entry.size));
    }
    // A file of its own (UUID name) – never the tmp folder itself.
    const tmp = path.join(dataPaths(ctx.config).tmp, `preview-${randomUUID()}`);
    await mkdir(path.dirname(tmp), { recursive: true });
    try {
      await storageCall(() => connection.download(file, tmp));
    } catch (error) {
      await rm(tmp, { force: true });
      throw error;
    }
    const stream = createReadStream(tmp);
    stream.on('close', () => void rm(tmp, { force: true }));
    reply
      .header(
        'Content-Type',
        getFormat(path.posix.extname(file).slice(1).toLowerCase())?.mime ??
          'application/octet-stream',
      )
      .header('Content-Length', String(entry.size))
      .header('Cache-Control', 'private, no-store');
    return reply.send(stream);
  });

  /** The content of an uploaded or imported file (e.g. to show it in the browser). */
  app.get('/api/files/:id/content', async (request, reply) => {
    const user = currentUser(request);
    const { id } = idParams.parse(request.params);
    const file = getOwnFile(ctx, user.id, id);
    if (!existsSync(file.path)) throw new HttpError(410, 'RESULT_GONE');
    reply
      .header('Content-Type', file.mime ?? 'application/octet-stream')
      .header('Content-Disposition', contentDisposition(file.originalName))
      .header('Content-Length', String(file.size))
      .header('Cache-Control', 'private, no-store');
    return reply.send(createReadStream(file.path));
  });

  /** Saves a finished server result to storage locations. */
  app.post('/api/jobs/:id/export', async (request) => {
    const user = currentUser(request);
    const { id } = idParams.parse(request.params);
    const body = exportRequestSchema.parse(request.body);
    const job = ctx.db
      .select()
      .from(jobs)
      .where(and(eq(jobs.id, id), eq(jobs.userId, user.id)))
      .get();
    if (!job) throw new HttpError(404, 'NOT_FOUND');
    if (job.status !== 'done' || !job.resultPath || !existsSync(job.resultPath)) {
      throw new HttpError(410, 'RESULT_GONE');
    }
    const results = await exportFile(
      ctx,
      user.id,
      {
        filePath: job.resultPath,
        name: job.resultName ?? `result.${job.outputExt}`,
        ext: job.outputExt,
      },
      {
        ...body,
        category: body.category ?? getFormat(job.outputExt)?.category,
      },
    );
    return { results };
  });

  /** Saves an uploaded file (e.g. a result made in the browser) to storage locations. */
  app.post('/api/files/:id/export', async (request) => {
    const user = currentUser(request);
    const { id } = idParams.parse(request.params);
    const body = exportRequestSchema.parse(request.body);
    const file = getOwnFile(ctx, user.id, id);
    if (!existsSync(file.path)) throw new HttpError(410, 'RESULT_GONE');
    const results = await exportFile(
      ctx,
      user.id,
      {
        filePath: file.path,
        name: file.originalName,
        ext: file.ext,
      },
      {
        ...body,
        category: body.category ?? getFormat(file.ext)?.category,
      },
    );
    return { results };
  });
}
