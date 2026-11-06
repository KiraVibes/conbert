import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { quotaDefaultRequestSchema, userQuotaRequestSchema, type Usage } from '@conbert/schemas';
import { adminOverview, prometheusMetrics } from '../admin/overview';
import { UNLIMITED, quotaOf, setDefaultQuota, usageOf } from '../admin/quota';
import { currentUser, requireAdmin } from '../auth/plugin';
import type { AppContext } from '../context';
import { users } from '../db/schema';
import { HttpError } from '../lib/http-error';

export function registerAdminRoutes(app: FastifyInstance, ctx: AppContext): void {
  const admin = { preHandler: requireAdmin };

  /** Everyone: how much of the server do I use? */
  app.get('/api/me/usage', async (request): Promise<Usage> => {
    const user = currentUser(request);
    return { usedBytes: usageOf(ctx, user.id), quotaBytes: quotaOf(ctx, user.id) };
  });

  app.get('/api/admin/overview', admin, async () => adminOverview(ctx));

  app.put('/api/admin/quota-default', admin, async (request) => {
    const { bytes } = quotaDefaultRequestSchema.parse(request.body);
    setDefaultQuota(ctx, bytes);
    return adminOverview(ctx);
  });

  app.put('/api/admin/users/:id/quota', admin, async (request) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const { quota } = userQuotaRequestSchema.parse(request.body);
    const value = quota === 'default' ? null : quota === 'unlimited' ? UNLIMITED : quota;
    const changed = ctx.db.update(users).set({ quotaBytes: value }).where(eq(users.id, id)).run();
    if (changed.changes === 0) throw new HttpError(404, 'NOT_FOUND');
    return adminOverview(ctx);
  });

  /** Prometheus (scrape with an admin's API token as bearer). */
  app.get('/api/metrics', admin, async (_request, reply) =>
    reply
      .header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
      .send(await prometheusMetrics(ctx)),
  );
}
