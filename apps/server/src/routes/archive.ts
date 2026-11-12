import { createReadStream, existsSync } from 'node:fs';
import { once } from 'node:events';
import { PassThrough } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { Zip, ZipPassThrough } from 'fflate';
import { z } from 'zod';
import {
  ARCHIVE_ZIP_MAX_BYTES,
  archiveKeepRequestSchema,
  archiveZipQuerySchema,
  type ServerArchive,
} from '@conbert/schemas';
import { adminOverview } from '../admin/overview';
import {
  archiveKeepHours,
  archivedFiles,
  removeArchived,
  setArchiveKeepHours,
  toArchivedFile,
} from '../archive/server-archive';
import { currentUser, requireAdmin } from '../auth/plugin';
import type { AppContext } from '../context';
import type { FileRecord } from '../db/schema';
import { thumbnailPath } from '../downloader/thumbnails';
import { HttpError } from '../lib/http-error';
import { userName } from '../logs/who';
import { contentDisposition } from './jobs';

const idParams = z.object({ id: z.string().uuid() });

/** "a.jpg", "a.jpg" → "a.jpg", "a (2).jpg" – names inside one ZIP. */
function uniqueNames(names: readonly string[]): string[] {
  const used = new Set<string>();
  return names.map((original) => {
    const name = original.replace(/[\\/]/g, '_') || 'file';
    const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    let candidate = name;
    for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${base} (${n})${ext}`;
    used.add(candidate.toLowerCase());
    return candidate;
  });
}

/** Streams the files as a ZIP (stored, not compressed again – media is compressed already). */
function zipStream(records: FileRecord[]): PassThrough {
  const out = new PassThrough();
  const zip = new Zip((error, chunk) => {
    if (error) out.destroy(error);
    else out.write(Buffer.from(chunk));
  });
  const names = uniqueNames(records.map((r) => r.originalName));
  void (async () => {
    try {
      for (const [index, record] of records.entries()) {
        if (!existsSync(record.path)) continue;
        const entry = new ZipPassThrough(names[index] ?? `file-${index + 1}`);
        entry.mtime = record.createdAt;
        zip.add(entry);
        for await (const chunk of createReadStream(record.path)) {
          entry.push(chunk as Buffer);
          if (out.writableNeedDrain) await once(out, 'drain');
          if (out.destroyed) return;
        }
        entry.push(new Uint8Array(0), true);
      }
      zip.end();
      out.end();
    } catch (error) {
      out.destroy(error instanceof Error ? error : new Error(String(error)));
    }
  })();
  return out;
}

export function registerArchiveRoutes(app: FastifyInstance, ctx: AppContext): void {
  /** Everything the user keeps in the server archive. */
  app.get('/api/archive/files', async (request): Promise<ServerArchive> => {
    const user = currentUser(request);
    return {
      files: archivedFiles(ctx, user.id).map((r) => toArchivedFile(ctx, r)),
      keepHours: archiveKeepHours(ctx),
    };
  });

  app.get('/api/archive/files/:id/thumb', async (request, reply) => {
    const user = currentUser(request);
    const { id } = idParams.parse(request.params);
    const [record] = archivedFiles(ctx, user.id, [id]);
    const file = thumbnailPath(ctx.config, id);
    if (!record || !existsSync(file)) throw new HttpError(404, 'NOT_FOUND');
    reply.header('Content-Type', 'image/jpeg').header('Cache-Control', 'private, max-age=86400');
    return reply.send(createReadStream(file));
  });

  app.delete('/api/archive/files/:id', async (request, reply) => {
    const user = currentUser(request);
    const { id } = idParams.parse(request.params);
    const records = archivedFiles(ctx, user.id, [id]);
    if (records.length === 0) throw new HttpError(404, 'NOT_FOUND');
    await removeArchived(ctx, records);
    return reply.status(204).send();
  });

  /** Empties the user's archive. */
  app.delete('/api/archive/files', async (request, reply) => {
    const user = currentUser(request);
    const records = archivedFiles(ctx, user.id);
    await removeArchived(ctx, records);
    ctx.log.info(
      { area: 'storage', user: userName(ctx, user.id), files: records.length },
      'server archive emptied',
    );
    return reply.status(204).send();
  });

  /** Several (or all) archived files as one ZIP. */
  app.get('/api/archive/zip', async (request, reply) => {
    const user = currentUser(request);
    const { ids } = archiveZipQuerySchema.parse(request.query);
    const wanted = ids
      ?.split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    const records = archivedFiles(ctx, user.id, wanted?.length ? wanted : undefined);
    if (records.length === 0) throw new HttpError(404, 'NOT_FOUND');
    const total = records.reduce((sum, r) => sum + r.size, 0);
    if (total > ARCHIVE_ZIP_MAX_BYTES) throw new HttpError(413, 'ARCHIVE_ZIP_TOO_BIG');
    reply
      .header('Content-Type', 'application/zip')
      .header('Content-Disposition', contentDisposition('conbert-archive.zip'))
      .header('Cache-Control', 'private, no-store');
    return reply.send(zipStream(records.slice().reverse()));
  });

  /** Admin: how long downloads stay in the archive. */
  app.put('/api/admin/archive-keep', { preHandler: requireAdmin }, async (request) => {
    const { hours } = archiveKeepRequestSchema.parse(request.body);
    setArchiveKeepHours(ctx, hours);
    return adminOverview(ctx);
  });
}
