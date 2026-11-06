import type { FastifyInstance } from 'fastify';
import { describeEngine } from '@conbert/core';
import type { EnginesResponse } from '@conbert/schemas';
import type { AppContext } from '../context';
import { getHardwareInfo } from '../engines/ffmpeg';

export function registerEngineRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/engines', async (): Promise<EnginesResponse> => {
    // Without the job queue no server engine can run – report that honestly,
    // so "Automatic" uses this device instead.
    const queueOk = ctx.jobs.queue.isHealthy();
    return {
      engines: ctx.engines.map((engine) => {
        const descriptor = describeEngine(engine);
        return queueOk ? descriptor : { ...descriptor, status: 'error' as const };
      }),
      hardware: getHardwareInfo(),
    };
  });
}
