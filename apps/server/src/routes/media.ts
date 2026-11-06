import type { FastifyInstance } from 'fastify';
import { similarQuerySchema, similarScanRequestSchema } from '@conbert/schemas';
import { similarGroups, startSimilarScan } from '../media/similar';
import { z } from 'zod';
import {
  reorganizeRequestSchema,
  swipeActionRequestSchema,
  swipeModeSchema,
  swipeNextQuerySchema,
} from '@conbert/schemas';
import { currentUser } from '../auth/plugin';
import type { AppContext } from '../context';
import { applyReorganize, planReorganize } from '../media/reorganize';
import {
  flushSwipes,
  nextItems,
  pendingCount,
  recordSwipe,
  sourceTree,
  undoSwipe,
} from '../media/swipe';
import { mediaStatus, startSync } from '../media/sync';

/** Media index (sync with the default location), tidying up, and the swipe game. */
export function registerMediaRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/media/status', async (request) => mediaStatus(ctx, currentUser(request).id));

  app.post('/api/media/sync', async (request) => {
    const user = currentUser(request);
    startSync(ctx, user.id);
    return mediaStatus(ctx, user.id);
  });

  app.get('/api/media/reorganize', async (request) => planReorganize(ctx, currentUser(request).id));

  app.post('/api/media/reorganize', async (request) => {
    const body = reorganizeRequestSchema.parse(request.body);
    return applyReorganize(ctx, currentUser(request).id, body);
  });

  app.get('/api/swipe/sources', async (request) => {
    const query = z
      .object({ mode: swipeModeSchema.default('normal'), sorted: z.enum(['0', '1']).default('0') })
      .parse(request.query);
    return {
      sources: sourceTree(ctx, currentUser(request).id, query.mode, query.sorted === '1'),
    };
  });

  app.get('/api/swipe/next', async (request) => {
    const query = swipeNextQuerySchema.parse(request.query);
    const user = currentUser(request);
    return {
      ...nextItems(ctx, user.id, {
        mode: query.mode,
        folders: query.folders,
        sorted: query.sorted === '1',
        count: query.count,
        exclude: (query.exclude ?? '').split(',').filter(Boolean).slice(0, 50),
      }),
      pending: pendingCount(ctx, user.id),
    };
  });

  app.post('/api/swipe/action', async (request) => {
    const body = swipeActionRequestSchema.parse(request.body);
    return recordSwipe(ctx, currentUser(request).id, body.itemId, body.action);
  });

  app.post('/api/swipe/undo', async (request) => undoSwipe(ctx, currentUser(request).id));

  app.post('/api/swipe/flush', async (request) => flushSwipes(ctx, currentUser(request).id));

  app.get('/api/media/similar', async (request) => {
    const query = similarQuerySchema.parse(request.query);
    return similarGroups(ctx, currentUser(request).id, query.level, query.folders);
  });

  app.post('/api/media/similar/scan', async (request) => {
    const { folders } = similarScanRequestSchema.parse(request.body ?? {});
    return startSimilarScan(ctx, currentUser(request).id, folders);
  });
}
