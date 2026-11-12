import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parsePostUrl } from '@conbert/core';
import {
  booruSearchRequestSchema,
  createBooruJobRequestSchema,
  subscriptionRequestSchema,
  createInstanceRequestSchema,
  pinRequestSchema,
  resolveUrlRequestSchema,
  saveAccountRequestSchema,
  siteIdSchema,
  updateBooruSettingsRequestSchema,
} from '@conbert/schemas';
import { currentUser } from '../auth/plugin';
import type { AppContext } from '../context';
import { HttpError } from '../lib/http-error';
import {
  asHttpError,
  autocomplete,
  clientFor,
  createInstance,
  deleteAccount,
  deleteInstance,
  fetchThumb,
  listSites,
  readSettings,
  removeLock,
  saveAccount,
  searchPosts,
  setLock,
  siteFor,
  updateSettings,
  userSites,
} from '../booru/service';
import { toBooruJobDto } from '../booru/crawler';
import {
  createSubscription,
  deleteSubscription,
  listSubscriptions,
  ownSubscription,
  runSubscription,
  toSubscriptionDto,
  updateSubscription,
} from '../scheduler/subscriptions';
import {
  booruJobFiles,
  createBooruJob,
  deleteBooruJob,
  listBooruJobs,
  ownBooruJob,
  pauseBooruJob,
  resumeBooruJob,
  clearFinishedBooruJobs,
} from '../booru/jobs';

const siteParams = z.object({ site: siteIdSchema });
const tokenParams = z.object({ token: z.string().uuid() });
const idParams = z.object({ id: z.string().uuid() });
const autocompleteQuery = z.object({ q: z.string().max(100).default('') });

/** Booru sites: settings, accounts, tag suggestions and the (already filtered) search. */
export function registerBooruRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/booru/sites', async (request) => {
    const user = currentUser(request);
    return { sites: listSites(ctx, user.id) };
  });

  app.post('/api/booru/instances', async (request, reply) => {
    const user = currentUser(request);
    const body = createInstanceRequestSchema.parse(request.body);
    const site = createInstance(ctx, user.id, body);
    reply.status(201);
    return { site: listSites(ctx, user.id).find((s) => s.id === site.id) };
  });

  app.delete('/api/booru/instances/:site', async (request, reply) => {
    const user = currentUser(request);
    const { site } = siteParams.parse(request.params);
    deleteInstance(ctx, user.id, site);
    reply.status(204);
  });

  // The API key is stored encrypted and never sent back.
  app.put('/api/booru/accounts/:site', async (request, reply) => {
    const user = currentUser(request);
    const { site } = siteParams.parse(request.params);
    saveAccount(ctx, user.id, site, saveAccountRequestSchema.parse(request.body));
    reply.status(204);
  });

  app.delete('/api/booru/accounts/:site', async (request, reply) => {
    const user = currentUser(request);
    const { site } = siteParams.parse(request.params);
    deleteAccount(ctx, user.id, site);
    reply.status(204);
  });

  app.get('/api/booru/settings', async (request) => {
    const user = currentUser(request);
    return { settings: readSettings(ctx, user.id) };
  });

  app.put('/api/booru/settings', async (request) => {
    const user = currentUser(request);
    const body = updateBooruSettingsRequestSchema.parse(request.body);
    return { settings: await updateSettings(ctx, user.id, body) };
  });

  app.post('/api/booru/settings/lock', async (request) => {
    const user = currentUser(request);
    const { pin } = pinRequestSchema.parse(request.body);
    return { settings: await setLock(ctx, user.id, pin) };
  });

  app.delete('/api/booru/settings/lock', async (request) => {
    const user = currentUser(request);
    const { pin } = pinRequestSchema.parse(request.body);
    return { settings: await removeLock(ctx, user.id, pin) };
  });

  /** A link to a single post → site and post ID. */
  app.post('/api/booru/resolve', async (request) => {
    const user = currentUser(request);
    const { url } = resolveUrlRequestSchema.parse(request.body);
    const found = parsePostUrl(url, userSites(ctx, user.id));
    if (!found) throw new HttpError(404, 'BOORU_SITE_UNKNOWN');
    return found;
  });

  app.get('/api/booru/:site/autocomplete', async (request) => {
    const user = currentUser(request);
    const { site } = siteParams.parse(request.params);
    const { q } = autocompleteQuery.parse(request.query);
    const client = clientFor(ctx, user.id, siteFor(ctx, user.id, site), { retries: 0 });
    try {
      return { tags: await autocomplete(client, q) };
    } catch (error) {
      throw asHttpError(error);
    }
  });

  app.post('/api/booru/:site/search', async (request) => {
    const user = currentUser(request);
    const { site } = siteParams.parse(request.params);
    const body = booruSearchRequestSchema.parse(request.body ?? {});
    return searchPosts(ctx, user.id, site, body);
  });

  /** Thumbnails, fetched by the server – only for posts that passed every check. */
  app.get('/api/booru/thumbs/:token', async (request, reply) => {
    const user = currentUser(request);
    const { token } = tokenParams.parse(request.params);
    const thumb = await fetchThumb(user.id, token);
    if (!thumb) throw new HttpError(404, 'NOT_FOUND');
    reply.header('Content-Type', thumb.type).header('Cache-Control', 'private, max-age=21600');
    return reply.send(thumb.bytes);
  });

  // --- Crawl jobs ---
  app.post('/api/booru/:site/jobs', async (request, reply) => {
    const user = currentUser(request);
    const { site } = siteParams.parse(request.params);
    const body = createBooruJobRequestSchema.parse(request.body ?? {});
    const row = await createBooruJob(ctx, user.id, site, body);
    reply.status(201);
    return { job: toBooruJobDto(ctx, row) };
  });

  app.get('/api/booru/jobs', async (request) => {
    const user = currentUser(request);
    return { jobs: listBooruJobs(ctx, user.id) };
  });

  app.get('/api/booru/jobs/:id', async (request) => {
    const user = currentUser(request);
    const { id } = idParams.parse(request.params);
    return { job: toBooruJobDto(ctx, ownBooruJob(ctx, user.id, id)) };
  });

  app.get('/api/booru/jobs/:id/files', async (request) => {
    const user = currentUser(request);
    const { id } = idParams.parse(request.params);
    return { files: booruJobFiles(ctx, user.id, id) };
  });

  app.post('/api/booru/jobs/:id/pause', async (request) => {
    const user = currentUser(request);
    const { id } = idParams.parse(request.params);
    return { job: await pauseBooruJob(ctx, user.id, id) };
  });

  app.post('/api/booru/jobs/:id/resume', async (request) => {
    const user = currentUser(request);
    const { id } = idParams.parse(request.params);
    return { job: await resumeBooruJob(ctx, user.id, id) };
  });

  app.delete('/api/booru/jobs', async (request) => {
    const user = currentUser(request);
    return { removed: await clearFinishedBooruJobs(ctx, user.id) };
  });

  app.delete('/api/booru/jobs/:id', async (request) => {
    const user = currentUser(request);
    const { id } = idParams.parse(request.params);
    return { job: await deleteBooruJob(ctx, user.id, id) };
  });

  // --- Subscriptions ---
  app.get('/api/subscriptions', async (request) => {
    const user = currentUser(request);
    return { subscriptions: listSubscriptions(ctx, user.id) };
  });

  app.post('/api/subscriptions', async (request, reply) => {
    const user = currentUser(request);
    const body = subscriptionRequestSchema.parse(request.body ?? {});
    reply.status(201);
    return { subscription: createSubscription(ctx, user.id, body) };
  });

  app.put('/api/subscriptions/:id', async (request) => {
    const user = currentUser(request);
    const { id } = idParams.parse(request.params);
    const body = subscriptionRequestSchema.parse(request.body ?? {});
    return { subscription: updateSubscription(ctx, user.id, id, body) };
  });

  app.delete('/api/subscriptions/:id', async (request, reply) => {
    const user = currentUser(request);
    const { id } = idParams.parse(request.params);
    deleteSubscription(ctx, user.id, id);
    reply.status(204);
  });

  /** "Jetzt prüfen": starts a check right away (unless one is running). */
  app.post('/api/subscriptions/:id/check', async (request) => {
    const user = currentUser(request);
    const { id } = idParams.parse(request.params);
    const started = await runSubscription(ctx, ownSubscription(ctx, user.id, id));
    return { started, subscription: toSubscriptionDto(ctx, ownSubscription(ctx, user.id, id)) };
  });
}
