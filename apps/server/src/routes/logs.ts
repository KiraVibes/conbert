import { createReadStream } from 'node:fs';
import { PassThrough } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import {
  logQuerySchema,
  logSettingsSchema,
  type LogPage,
  type LogSettingsResponse,
} from '@conbert/schemas';
import { currentUser, requireAdmin } from '../auth/plugin';
import type { AppContext } from '../context';

/** The server log in the admin area: settings, reading, download, clearing. */
export function registerLogRoutes(app: FastifyInstance, ctx: AppContext): void {
  const admin = { preHandler: requireAdmin };

  app.get('/api/admin/logs/settings', admin, async (): Promise<LogSettingsResponse> =>
    ctx.logs.current(),
  );

  app.put('/api/admin/logs/settings', admin, async (request): Promise<LogSettingsResponse> => {
    const next = logSettingsSchema.parse(request.body);
    const before = ctx.logs.current();
    ctx.logs.update(ctx.db, next, [app.log]);
    ctx.log.info(
      {
        area: 'system',
        user: currentUser(request).username,
        from: { detail: before.detail, limit: before.limit },
        to: next,
      },
      'log settings changed',
    );
    return ctx.logs.current();
  });

  app.get('/api/admin/logs', admin, async (request): Promise<LogPage> =>
    ctx.logs.read(logQuerySchema.parse(request.query)),
  );

  /** Both files, oldest first, as one text file. */
  app.get('/api/admin/logs/download', admin, async (_request, reply) => {
    const out = new PassThrough();
    const files = ctx.logs.files().reverse();
    void (async () => {
      for (const file of files) {
        await new Promise<void>((resolve) => {
          const input = createReadStream(file);
          input.on('end', resolve);
          input.on('error', () => resolve());
          input.pipe(out, { end: false });
        });
      }
      out.end();
    })();
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    return reply
      .header('content-type', 'text/plain; charset=utf-8')
      .header('content-disposition', `attachment; filename="conbert-log-${stamp}.txt"`)
      .send(out);
  });

  app.delete('/api/admin/logs', admin, async (request) => {
    ctx.logs.clear();
    ctx.log.info({ area: 'system', user: currentUser(request).username }, 'log cleared');
    return ctx.logs.current();
  });
}
