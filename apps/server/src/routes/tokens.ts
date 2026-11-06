import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createTokenRequestSchema } from '@conbert/schemas';
import { currentUser } from '../auth/plugin';
import { createApiToken, listApiTokens, revokeApiToken } from '../auth/tokens';
import type { AppContext } from '../context';
import { HttpError } from '../lib/http-error';

/** Settings → "API access": the user's own tokens (only with a normal login). */
export function registerTokenRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/tokens', async (request) => ({
    tokens: listApiTokens(ctx.db, currentUser(request).id),
  }));

  app.post('/api/tokens', async (request, reply) => {
    const body = createTokenRequestSchema.parse(request.body);
    const created = createApiToken(ctx.db, currentUser(request).id, body.name, body.expiresInDays);
    return reply.status(201).send(created);
  });

  app.delete('/api/tokens/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    if (!revokeApiToken(ctx.db, currentUser(request).id, id)) {
      throw new HttpError(404, 'NOT_FOUND');
    }
    return reply.status(204).send();
  });
}
