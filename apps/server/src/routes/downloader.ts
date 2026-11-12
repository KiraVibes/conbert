import { randomUUID } from 'node:crypto';
import { checkQuota } from '../admin/quota';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray, like } from 'drizzle-orm';
import { z } from 'zod';
import { detectPlatform, downloadSourceName, parseDownloadUrl, type Platform } from '@conbert/core';
import {
  cookiePlatformSchema,
  createDownloadRequestSchema,
  createFeedRequestSchema,
  updateFeedRequestSchema,
  deviantartAppRequestSchema,
  deviantartCodeRequestSchema,
  pixivLoginCodeRequestSchema,
  pixivOptionsSchema,
  pixivTokenRequestSchema,
  probeDownloadRequestSchema,
  saveCookiesRequestSchema,
  type ProbeDownloadResponse,
} from '@conbert/schemas';
import { currentUser, requireAdmin } from '../auth/plugin';
import { FailureLimiter } from '../auth/rate-limit';
import type { AppContext } from '../context';
import { downloads } from '../db/schema';
import { HttpError } from '../lib/http-error';
import { deleteCookies, hasCookies, listCookies, saveCookies } from '../downloader/cookies';
import {
  deletePixivLogin,
  finishPixivLogin,
  hasPixivLogin,
  pixivStatus,
  savePixivToken,
  startPixivLogin,
} from '../downloader/pixiv';
import {
  deleteDeviantart,
  deviantartStatus,
  finishDeviantartLogin,
  hasDeviantartLogin,
  saveDeviantartApp,
  startDeviantartLogin,
} from '../downloader/deviantart';
import {
  createFeed,
  deleteFeed,
  downloadArchive,
  listFeeds,
  ownFeed,
  feedWaitsForDownload,
  runFeed,
  toFeedDto,
  updateFeed,
} from '../downloader/feeds';
import { probeUrl, type ProbeInfo } from '../downloader/probe';
import { toDownloadDto } from '../downloader/runner';
import { archivedFiles } from '../archive/server-archive';
import { removeThumbnails, thumbnailPath } from '../downloader/thumbnails';
import { toolVersion, updateTools } from '../downloader/tools';
import { publicFetch } from '../lib/public-net';

const idParams = z.object({ id: z.string().uuid() });
const platformParams = z.object({ platform: cookiePlatformSchema });

/** Probes are kept a while, so "Herunterladen" doesn't have to look again. */
const PROBE_TTL_MS = 30 * 60_000;
const THUMBNAIL_MAX_BYTES = 5 * 1024 * 1024;

interface StoredProbe {
  userId: string;
  url: string;
  platform: Platform;
  info: ProbeInfo;
  expires: number;
}

export function registerDownloaderRoutes(app: FastifyInstance, ctx: AppContext): void {
  const probes = new Map<string, StoredProbe>();
  const sweep = () => {
    const now = Date.now();
    for (const [id, probe] of probes) if (probe.expires < now) probes.delete(id);
  };
  const ownProbe = (userId: string, id: string | undefined) => {
    const probe = id ? probes.get(id) : undefined;
    return probe && probe.userId === userId && probe.expires > Date.now() ? probe : undefined;
  };
  const { queue, runner } = ctx.downloads;

  app.post('/api/downloader/probe', async (request): Promise<ProbeDownloadResponse> => {
    const user = currentUser(request);
    const { url: raw } = probeDownloadRequestSchema.parse(request.body);
    const url = parseDownloadUrl(raw);
    if (!url) throw new HttpError(400, 'DOWNLOAD_URL_INVALID');
    sweep();
    const info = await probeUrl(ctx, user.id, url);
    const probeId = randomUUID();
    probes.set(probeId, {
      userId: user.id,
      url: url.href,
      platform: info.platform,
      info,
      expires: Date.now() + PROBE_TTL_MS,
    });
    return {
      probeId,
      url: url.href,
      platform: info.platform,
      tool: info.tool,
      kind: info.kind,
      title: info.title,
      uploader: info.uploader,
      count: info.count,
      duration: info.duration,
      thumbnail: info.thumbnailUrl !== null,
      entries: info.entries,
      needsLogin: false,
      // Pixiv: "your login is used" means the stored Pixiv key.
      hasCookies:
        info.platform === 'pixiv'
          ? hasPixivLogin(ctx, user.id)
          : info.platform === 'deviantart'
            ? hasDeviantartLogin(ctx, user.id)
            : hasCookies(ctx, user.id, info.platform),
    };
  });

  /**
   * The preview picture, fetched by the server: the browser never talks to
   * the platform (privacy, and the page only loads pictures from Conbert).
   * Only the address the tool found for this probe is fetched.
   */
  app.get('/api/downloader/probes/:id/thumbnail', async (request, reply) => {
    const user = currentUser(request);
    const { id } = idParams.parse(request.params);
    const probe = ownProbe(user.id, id);
    const address = probe?.info.thumbnailUrl ? parseDownloadUrl(probe.info.thumbnailUrl) : null;
    if (!address) throw new HttpError(404, 'NOT_FOUND');
    // Pixiv's picture server only answers when the request seems to come from pixiv.net.
    const pixivImage = /(^|\.)pximg\.net$/i.test(address.hostname);
    const response = await publicFetch(address, {
      signal: AbortSignal.timeout(10_000),
      ...(pixivImage && { headers: { Referer: 'https://www.pixiv.net/' } }),
    }).catch(() => null);
    const type = response?.headers.get('content-type') ?? '';
    if (!response?.ok || !/^image\/(jpeg|png|webp|gif|avif)/.test(type)) {
      throw new HttpError(404, 'NOT_FOUND');
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > THUMBNAIL_MAX_BYTES) throw new HttpError(404, 'NOT_FOUND');
    reply.header('Content-Type', type).header('Cache-Control', 'private, max-age=600');
    return reply.send(bytes);
  });

  app.post('/api/downloader/jobs', async (request, reply) => {
    const user = currentUser(request);
    const body = createDownloadRequestSchema.parse(request.body);
    const url = parseDownloadUrl(body.url);
    if (!url) throw new HttpError(400, 'DOWNLOAD_URL_INVALID');
    if (!queue.isHealthy()) throw new HttpError(503, 'QUEUE_UNAVAILABLE');
    // Files kept on the server count against the quota: a full one starts nothing.
    if (body.toList || body.keepOnServer) checkQuota(ctx, user.id, 1);
    const probe = ownProbe(user.id, body.probeId);
    const info = probe && probe.url === url.href ? probe.info : await probeUrl(ctx, user.id, url);
    const id = randomUUID();
    const platform = probe?.platform ?? detectPlatform(url);
    // What was downloaded before is skipped (the tool keeps the list).
    const archiveFile = body.skipKnown
      ? downloadArchive(ctx, user.id, info.tool, platform)
      : undefined;
    if (archiveFile) await mkdir(path.dirname(archiveFile), { recursive: true });
    ctx.db
      .insert(downloads)
      .values({
        id,
        userId: user.id,
        url: url.href,
        platform,
        tool: info.tool,
        kind: info.kind,
        title: info.title,
        options: {
          sourceName: downloadSourceName({
            platform: probe?.platform ?? detectPlatform(url),
            kind: info.kind,
            title: info.title,
            uploader: info.uploader,
            url: url.href,
          }),
          quality: body.quality,
          parts: body.parts,
          ...(platform === 'pixiv' && { pixiv: pixivOptionsSchema.parse(body.pixiv ?? {}) }),
          limit: body.limit,
          sleepSeconds: body.sleepSeconds,
          targetIds: body.targetIds,
          toList: body.toList,
          keepOnServer: body.keepOnServer,
          after: body.after,
          ...(archiveFile && { archiveFile }),
          ...(body.dateAfter && { dateAfter: body.dateAfter }),
          ...(body.dateBefore && { dateBefore: body.dateBefore }),
        },
        total: info.kind === 'single' ? 1 : info.count && Math.min(info.count, body.limit),
        files: [],
      })
      .run();
    try {
      await queue.enqueue(id);
    } catch (err) {
      request.log.error({ err }, 'enqueue download failed');
      runner.update(id, {
        status: 'error',
        errorKey: 'errors.queueUnavailable',
        finishedAt: new Date(),
      });
      throw new HttpError(503, 'QUEUE_UNAVAILABLE');
    }
    reply.status(201);
    const row = ctx.db.select().from(downloads).where(eq(downloads.id, id)).get();
    if (!row) throw new HttpError(500, 'INTERNAL');
    return { download: toDownloadDto(row) };
  });

  app.get('/api/downloader/jobs', async (request) => {
    const user = currentUser(request);
    const rows = ctx.db
      .select()
      .from(downloads)
      .where(eq(downloads.userId, user.id))
      .orderBy(desc(downloads.createdAt))
      .limit(30)
      .all();
    return { downloads: rows.map(toDownloadDto) };
  });

  /** Takes finished downloads off the list (the files themselves stay). */
  async function removeFinished(userId: string, rows: (typeof downloads.$inferSelect)[]) {
    if (rows.length === 0) return;
    ctx.db
      .delete(downloads)
      .where(
        inArray(
          downloads.id,
          rows.map((r) => r.id),
        ),
      )
      .run();
    // Files still in the server archive keep their preview picture there.
    const fileIds = rows.flatMap((row) => toDownloadDto(row).files.map((f) => f.fileId));
    const archived = new Set(archivedFiles(ctx, userId, fileIds).map((r) => r.id));
    await removeThumbnails(
      ctx.config,
      fileIds.filter((fileId) => !archived.has(fileId)),
    );
  }

  const ownDownload = (userId: string, id: string) => {
    const row = ctx.db
      .select()
      .from(downloads)
      .where(and(eq(downloads.id, id), eq(downloads.userId, userId)))
      .get();
    if (!row) throw new HttpError(404, 'NOT_FOUND');
    return row;
  };

  app.get('/api/downloader/jobs/:id', async (request) => {
    const user = currentUser(request);
    const { id } = idParams.parse(request.params);
    return { download: toDownloadDto(ownDownload(user.id, id)) };
  });

  /** Cancels a running or waiting download, or removes a finished one from the list. */
  app.delete('/api/downloader/jobs/:id', async (request) => {
    const user = currentUser(request);
    const { id } = idParams.parse(request.params);
    const row = ownDownload(user.id, id);
    if (row.status === 'queued' || row.status === 'running') {
      if (!runner.abort(id)) {
        await queue.removeWaiting(id);
        runner.update(id, { status: 'cancelled', finishedAt: new Date() });
      }
      return { download: toDownloadDto(ownDownload(user.id, id)) };
    }
    await removeFinished(user.id, [row]);
    return { download: toDownloadDto(row) };
  });

  /** Empties the list: every finished download goes, running and waiting ones stay. */
  app.delete('/api/downloader/jobs', async (request) => {
    const user = currentUser(request);
    const rows = ctx.db
      .select()
      .from(downloads)
      .where(
        and(
          eq(downloads.userId, user.id),
          inArray(downloads.status, ['done', 'error', 'cancelled']),
        ),
      )
      .all();
    await removeFinished(user.id, rows);
    return { removed: rows.length };
  });

  /** Preview picture of a downloaded file – only for the owner of the download. */
  app.get('/api/downloader/thumbs/:id', async (request, reply) => {
    const user = currentUser(request);
    const { id } = idParams.parse(request.params);
    const owned = ctx.db
      .select({ id: downloads.id })
      .from(downloads)
      .where(and(eq(downloads.userId, user.id), like(downloads.files, `%"fileId":"${id}"%`)))
      .get();
    const file = thumbnailPath(ctx.config, id);
    if (!owned || !existsSync(file)) throw new HttpError(404, 'NOT_FOUND');
    reply.header('Content-Type', 'image/jpeg').header('Cache-Control', 'private, max-age=86400');
    return reply.send(createReadStream(file));
  });

  // --- Subscriptions ("Abos": profiles, channels, threads) ---
  app.get('/api/downloader/feeds', async (request) => {
    const user = currentUser(request);
    return { feeds: listFeeds(ctx, user.id) };
  });

  app.post('/api/downloader/feeds', async (request, reply) => {
    const user = currentUser(request);
    const body = createFeedRequestSchema.parse(request.body);
    const url = parseDownloadUrl(body.url);
    if (!url) throw new HttpError(400, 'DOWNLOAD_URL_INVALID');
    const probe = ownProbe(user.id, body.probeId);
    const info =
      probe && probe.url === url.href
        ? { ...probe.info, platform: probe.platform }
        : await probeUrl(ctx, user.id, url);
    const row = createFeed(ctx, user.id, body, url.href, info);
    reply.status(201);
    return { feed: toFeedDto(ctx, row) };
  });

  app.put('/api/downloader/feeds/:id', async (request) => {
    const user = currentUser(request);
    const { id } = idParams.parse(request.params);
    const body = updateFeedRequestSchema.parse(request.body);
    return { feed: toFeedDto(ctx, updateFeed(ctx, user.id, id, body)) };
  });

  app.delete('/api/downloader/feeds/:id', async (request, reply) => {
    const user = currentUser(request);
    const { id } = idParams.parse(request.params);
    await deleteFeed(ctx, user.id, id);
    reply.status(204);
  });

  /** "Jetzt prüfen". */
  app.post('/api/downloader/feeds/:id/check', async (request) => {
    const user = currentUser(request);
    const { id } = idParams.parse(request.params);
    const row = ownFeed(ctx, user.id, id);
    if (!queue.isHealthy()) throw new HttpError(503, 'QUEUE_UNAVAILABLE');
    const started = await runFeed(ctx, row);
    const waiting = !started && feedWaitsForDownload(ctx, row);
    return { started, waiting, feed: toFeedDto(ctx, ownFeed(ctx, user.id, id)) };
  });

  // --- Cookies ---
  app.get('/api/downloader/cookies', async (request) => {
    const user = currentUser(request);
    return {
      cookies: listCookies(ctx, user.id).map((c) => ({
        platform: c.platform,
        updatedAt: c.updatedAt.toISOString(),
      })),
    };
  });

  app.put('/api/downloader/cookies/:platform', async (request, reply) => {
    const user = currentUser(request);
    const { platform } = platformParams.parse(request.params);
    const { content } = saveCookiesRequestSchema.parse(request.body);
    saveCookies(ctx, user.id, platform, content);
    reply.status(204);
  });

  app.delete('/api/downloader/cookies/:platform', async (request, reply) => {
    const user = currentUser(request);
    const { platform } = platformParams.parse(request.params);
    deleteCookies(ctx, user.id, platform);
    reply.status(204);
  });

  // --- Pixiv login (refresh token; the password is only typed on pixiv.net) ---
  const pixivLimiter = new FailureLimiter();
  app.get('/api/downloader/pixiv', async (request) => pixivStatus(ctx, currentUser(request).id));

  app.post('/api/downloader/pixiv/login', async (request) => ({
    url: startPixivLogin(currentUser(request).id),
  }));

  app.post('/api/downloader/pixiv/code', async (request) => {
    const user = currentUser(request);
    if (pixivLimiter.retryAfter(user.id) > 0) throw new HttpError(429, 'TOO_MANY_ATTEMPTS');
    const { code } = pixivLoginCodeRequestSchema.parse(request.body);
    try {
      const status = await finishPixivLogin(ctx, user.id, code);
      pixivLimiter.reset(user.id);
      return status;
    } catch (error) {
      pixivLimiter.fail(user.id);
      throw error;
    }
  });

  app.put('/api/downloader/pixiv/token', async (request) => {
    const user = currentUser(request);
    const { refreshToken } = pixivTokenRequestSchema.parse(request.body);
    return savePixivToken(ctx, user.id, refreshToken);
  });

  app.delete('/api/downloader/pixiv', async (request, reply) => {
    deletePixivLogin(ctx, currentUser(request).id);
    reply.status(204);
  });

  // --- DeviantArt: your own API app + login (the password is only typed on deviantart.com) ---
  const deviantartLimiter = new FailureLimiter();
  app.get('/api/downloader/deviantart', async (request) =>
    deviantartStatus(ctx, currentUser(request).id),
  );

  app.put('/api/downloader/deviantart/app', async (request) => {
    const user = currentUser(request);
    if (deviantartLimiter.retryAfter(user.id) > 0) throw new HttpError(429, 'TOO_MANY_ATTEMPTS');
    const body = deviantartAppRequestSchema.parse(request.body);
    try {
      const status = await saveDeviantartApp(ctx, user.id, body);
      deviantartLimiter.reset(user.id);
      return status;
    } catch (error) {
      deviantartLimiter.fail(user.id);
      throw error;
    }
  });

  app.post('/api/downloader/deviantart/login', async (request) => ({
    url: startDeviantartLogin(ctx, currentUser(request).id),
  }));

  app.post('/api/downloader/deviantart/code', async (request) => {
    const user = currentUser(request);
    if (deviantartLimiter.retryAfter(user.id) > 0) throw new HttpError(429, 'TOO_MANY_ATTEMPTS');
    const { code } = deviantartCodeRequestSchema.parse(request.body);
    try {
      const status = await finishDeviantartLogin(ctx, user.id, code);
      deviantartLimiter.reset(user.id);
      return status;
    } catch (error) {
      deviantartLimiter.fail(user.id);
      throw error;
    }
  });

  /** Logs out of DeviantArt; `?all=1` also forgets the app. */
  app.delete('/api/downloader/deviantart', async (request, reply) => {
    const { all } = z.object({ all: z.enum(['0', '1']).optional() }).parse(request.query);
    await deleteDeviantart(ctx, currentUser(request).id, all === '1');
    reply.status(204);
  });

  // --- Tools ---
  app.get('/api/downloader/tools', async (request) => {
    const user = currentUser(request);
    const [ytDlp, galleryDl] = await Promise.all([
      toolVersion(ctx.config, 'yt-dlp'),
      toolVersion(ctx.config, 'gallery-dl'),
    ]);
    return { ytDlp, galleryDl, canUpdate: user.role === 'admin' };
  });

  app.post('/api/downloader/tools/update', { preHandler: requireAdmin }, async (request) => {
    try {
      await updateTools(ctx.config);
    } catch (err) {
      request.log.warn({ err }, 'downloader update failed');
      throw new HttpError(
        502,
        'DOWNLOAD_UPDATE_FAILED',
        err instanceof Error ? err.message.slice(-500) : undefined,
      );
    }
    const [ytDlp, galleryDl] = await Promise.all([
      toolVersion(ctx.config, 'yt-dlp'),
      toolVersion(ctx.config, 'gallery-dl'),
    ]);
    return { ytDlp, galleryDl, canUpdate: true };
  });
}
