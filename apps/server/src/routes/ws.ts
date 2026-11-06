import type { FastifyInstance } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import type {
  BooruJobDto,
  DownloadDto,
  JobDto,
  NotificationDto,
  WorkflowRunDto,
  WsServerMessage,
} from '@conbert/schemas';
import { currentUser, isSameOrigin } from '../auth/plugin';
import type { AppContext } from '../context';

const PING_INTERVAL_MS = 30_000;

/**
 * WS /api/ws – live job progress. Each connection only receives events for
 * the signed-in user's own jobs. The auth hook runs before the upgrade.
 */
export async function registerWebSocket(app: FastifyInstance, ctx: AppContext): Promise<void> {
  await app.register(fastifyWebsocket, { options: { maxPayload: 4096 } });

  app.get('/api/ws', { websocket: true }, (socket, request) => {
    // Browsers don't apply CORS to WebSockets – refuse other websites.
    if (!isSameOrigin(request)) {
      socket.close(1008, 'cross-origin');
      return;
    }
    const user = currentUser(request);
    const send = (message: WsServerMessage) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
    };
    const onJob = (userId: string, job: JobDto) => {
      if (userId === user.id) send({ type: 'job', job });
    };
    const onDownload = (userId: string, download: DownloadDto) => {
      if (userId === user.id) send({ type: 'download', download });
    };
    const onBooru = (userId: string, job: BooruJobDto) => {
      if (userId === user.id) send({ type: 'booru', job });
    };
    ctx.jobs.events.on('job', onJob);
    ctx.jobs.events.on('download', onDownload);
    const onWorkflow = (userId: string, run: WorkflowRunDto) => {
      if (userId === user.id) send({ type: 'workflow', run });
    };
    const onNotification = (userId: string, notification: NotificationDto) => {
      if (userId === user.id) send({ type: 'notification', notification });
    };
    ctx.jobs.events.on('booru', onBooru);
    ctx.jobs.events.on('workflow', onWorkflow);
    ctx.jobs.events.on('notification', onNotification);
    send({ type: 'hello' });

    const ping = setInterval(() => socket.ping(), PING_INTERVAL_MS);
    socket.on('close', () => {
      clearInterval(ping);
      ctx.jobs.events.off('job', onJob);
      ctx.jobs.events.off('download', onDownload);
      ctx.jobs.events.off('booru', onBooru);
      ctx.jobs.events.off('workflow', onWorkflow);
      ctx.jobs.events.off('notification', onNotification);
    });
    // Clients don't send anything meaningful; ignore incoming messages.
    socket.on('message', () => undefined);
  });
}
