import type { FastifyInstance } from 'fastify';
import type { HealthResponse } from '@conbert/schemas';
import pkg from '../../package.json' with { type: 'json' };
import type { AppContext } from '../context';

export function registerHealthRoutes(app: FastifyInstance, ctx: AppContext): void {
  // Docker polls this every 30 s – keep it out of the info log.
  app.get('/api/health', { logLevel: 'warn' }, async (): Promise<HealthResponse> => {
    return {
      status: 'ok',
      name: 'conbert',
      version: pkg.version,
      uptimeSeconds: Math.round(process.uptime()),
      queue: ctx.jobs.queue.isHealthy() ? 'ok' : 'unavailable',
    };
  });
}
