import type { FastifyInstance } from 'fastify';
import { IMAGE_AI_MODELS } from '@conbert/core';
import { imageAiStatusSchema, type ImageAiStatus } from '@conbert/schemas';
import { requireAdmin } from '../auth/plugin';
import type { AppContext } from '../context';
import { imageAiModels } from '../engines/image-ai';
import { HttpError } from '../lib/http-error';

const modelId = (params: unknown): string => {
  const id = (params as { id?: string }).id ?? '';
  if (!IMAGE_AI_MODELS.some((m) => m.id === id)) throw new HttpError(400, 'BAD_REQUEST', id);
  return id;
};

/** Settings → AI models for pictures: status, download now, delete (admins). */
export function registerImageAiRoutes(app: FastifyInstance, ctx: AppContext): void {
  const admin = { preHandler: requireAdmin };

  const status = async (): Promise<ImageAiStatus> =>
    imageAiStatusSchema.parse({
      available: ctx.engines.some((e) => e.id === 'image-ai' && e.status() !== 'error'),
      models: await imageAiModels().status(),
    });

  app.get('/api/image-ai', async () => status());

  app.post('/api/image-ai/models/:id/download', admin, async (request, reply) => {
    imageAiModels().start(modelId(request.params));
    return reply.status(202).send(await status());
  });

  app.delete('/api/image-ai/models/:id', admin, async (request) => {
    const id = modelId(request.params);
    if ((await status()).models.find((m) => m.id === id)?.downloading !== null) {
      throw new HttpError(409, 'DOWNLOAD_RUNNING');
    }
    await imageAiModels().remove(id);
    return status();
  });
}
