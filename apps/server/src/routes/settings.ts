import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { userSettingsSchema, type SettingsResponse } from '@conbert/schemas';
import { currentUser } from '../auth/plugin';
import type { AppContext } from '../context';
import { userSettings } from '../db/schema';

/** UI settings of the signed-in user (theme, language, expert mode …). */
export function registerSettingsRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/settings', async (request): Promise<SettingsResponse> => {
    const user = currentUser(request);
    const row = ctx.db.select().from(userSettings).where(eq(userSettings.userId, user.id)).get();
    return { settings: (row?.data as Record<string, unknown> | undefined) ?? {} };
  });

  app.put('/api/settings', async (request): Promise<SettingsResponse> => {
    const user = currentUser(request);
    const body = (request.body ?? {}) as { settings?: unknown };
    const settings = userSettingsSchema.parse(body.settings);
    const now = new Date();
    ctx.db
      .insert(userSettings)
      .values({ userId: user.id, data: settings, updatedAt: now })
      .onConflictDoUpdate({ target: userSettings.userId, set: { data: settings, updatedAt: now } })
      .run();
    return { settings };
  });
}
