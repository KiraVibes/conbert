import type { FastifyInstance } from 'fastify';
import type { BlenderStatus } from '@conbert/schemas';
import { requireAdmin } from '../auth/plugin';
import type { BlenderInstaller } from '../blender/installer';
import { HttpError } from '../lib/http-error';

/** Admin: install Blender on demand, see the progress, remove it again. */
export function registerBlenderRoutes(app: FastifyInstance, installer: BlenderInstaller): void {
  const admin = { preHandler: requireAdmin };

  app.get('/api/blender', admin, async (): Promise<BlenderStatus> => installer.status());

  app.post('/api/blender/install', admin, async (request, reply) => {
    if (!installer.supported()) throw new HttpError(409, 'BLENDER_UNSUPPORTED');
    installer.install().catch((error: unknown) => {
      request.log.warn({ err: error }, 'blender install failed');
    });
    return reply.status(202).send(await installer.status());
  });

  app.delete('/api/blender', admin, async (): Promise<BlenderStatus> => {
    if (installer.isRunning()) throw new HttpError(409, 'BLENDER_RUNNING');
    await installer.remove();
    return installer.status();
  });
}
