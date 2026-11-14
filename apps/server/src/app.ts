import { existsSync } from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import type { Engine } from '@conbert/core';
import { dataPaths, type Config } from './config';
import type { AppContext } from './context';
import { openDatabase, type Db } from './db';
import { registerAuth } from './auth/plugin';
import { generateSetupCode, getAuthState } from './auth/setup';
import { serverEngines } from './engines';
import { HttpError, apiError } from './lib/http-error';
import { registerSecurityHeaders } from './lib/security-headers';
import { registerAuthRoutes } from './routes/auth';
import { registerEngineRoutes } from './routes/engines';
import { registerHealthRoutes } from './routes/health';
import { registerSettingsRoutes } from './routes/settings';
import { registerJobRoutes } from './routes/jobs';
import { registerTargetRoutes } from './routes/targets';
import { registerDownloaderRoutes } from './routes/downloader';
import { registerBooruRoutes } from './routes/booru';
import { registerWorkflowRoutes } from './routes/workflows';
import { registerKeyRoutes } from './routes/keys';
import { registerMediaRoutes } from './routes/media';
import { startMediaScheduler } from './scheduler/media';
import { resumeWorkflowRuns, WorkflowRunner } from './workflows/executor';
import { DownloadRunner, resumeDownloads } from './downloader/runner';
import { BooruRunner } from './booru/crawler';
import { resumeBooruJobs } from './booru/jobs';
import { startSubscriptionScheduler, subscriptionCrawlFinished } from './scheduler/subscriptions';

/** Downloads at the same time (each also waits between requests). */
const DOWNLOAD_CONCURRENCY = 2;
/** Booru crawls at the same time (requests per site are spaced anyway). */
const BOORU_CONCURRENCY = 3;
import { createSecretBox } from './lib/secret-box';
import { prepareRclone } from './targets/rclone';
import { registerGroupRoutes } from './routes/groups';
import { registerLdapRoutes } from './routes/ldap';
import { ldaptsConnector, type LdapConnector } from './auth/ldap/client';
import { startLdapScheduler } from './auth/ldap/sync';
import { registerUserRoutes } from './routes/users';
import { registerWebSocket } from './routes/ws';
import { JobEvents } from './queue/events';
import { createBullQueue, createInlineQueue, type JobQueue } from './queue/job-queue';
import { JobRunner, resumeJobs } from './queue/runner';
import { startCleanup } from './storage/cleanup';
import { registerUploads } from './storage/uploads';
import { registerWhisperRoutes, readWhisperModel } from './routes/whisper';
import { registerPdfRoutes } from './routes/pdf';
import { registerImageAiRoutes } from './routes/image-ai';
import { registerTokenRoutes } from './routes/tokens';
import { registerScriptingRoutes } from './routes/scripting';
import { registerOpenApiRoutes } from './routes/openapi';
import { registerAdminRoutes } from './routes/admin';
import { startDiskWatch } from './admin/disk-watch';
import pkg from '../package.json' with { type: 'json' };
import { ModelStore } from './models/model-store';
import { configureWhisper } from './whisper/setup';
import { IMAGE_AI_MODELS, WHISPER_MODELS, WHISPER_MODEL_BASE_URL } from '@conbert/core';
import { configureImageAi } from './engines/image-ai';
import { configureBlender } from './engines/blender';
import { BlenderInstaller } from './blender/installer';
import { registerBlenderRoutes } from './routes/blender';
import { LogHub, logDir, readLogSettings } from './logs/hub';
import { registerLogRoutes } from './routes/logs';
import { registerArchiveRoutes } from './routes/archive';
import { setProcessLog } from './lib/run-process';

export { API_ERROR_KEYS } from './lib/http-error';

export interface BuildAppOptions {
  config: Config;
  /** Defaults to the database file in the data directory. */
  db?: Db;
  engines?: readonly Engine[];
  /**
   * The console (the container's output) and the log file in the data folder
   * that the admin reads. Default: neither (tests).
   */
  logging?: {
    console?: { level: string; stream: { write(line: string): unknown } } | null;
    file?: boolean;
  };
  /** Called with the one-time setup code when the first-start setup is pending. */
  onSetupRequired?: (setupCode: string) => void;
  /** Timers and the BullMQ worker (off in tests, which run jobs inline). Default: on. */
  backgroundTasks?: boolean;
  /** Custom job queue (tests). */
  queue?: (runner: JobRunner) => JobQueue;
  /** Custom download queue (tests). */
  downloadQueue?: (runner: DownloadRunner) => JobQueue;
  /** Custom booru queue (tests). */
  booruQueue?: (runner: BooruRunner) => JobQueue;
  /** Custom workflow queue (tests). */
  workflowQueue?: (runner: WorkflowRunner) => JobQueue;
  /** Where Whisper models come from (tests use a local server). */
  whisperModelUrl?: string;
  /** How LDAP connections are opened (tests use a fake directory). */
  ldapConnector?: LdapConnector;
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const { config } = options;
  const db = options.db ?? openDatabase(dataPaths(config).database, config.migrationsDir);
  const logs = new LogHub({
    dir: options.logging?.file ? logDir(config.dataDir) : null,
    console: options.logging?.console ?? null,
    settings: readLogSettings(db),
  });
  const app = Fastify({
    // pino's own type is wider than Fastify's logger type; the instance is the same.
    loggerInstance: logs.logger as FastifyBaseLogger,
    // Requests are logged by the hook below (only with "detailed").
    disableRequestLogging: true,
    // Uploads go through tus; plain JSON bodies stay small.
    bodyLimit: 1024 * 1024,
    // Behind a reverse proxy, request.ip must be the real client.
    trustProxy: config.proxyAuth?.trustedProxies ?? false,
  });

  // Set first, so it covers every plugin and hook registered below.
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) {
      return reply.status(error.statusCode).send(apiError(error.code, error.details));
    }
    if (error instanceof ZodError) {
      const issue = error.issues[0];
      const field = String(issue?.path.at(-1) ?? '');
      const code =
        field === 'password' || field === 'newPassword'
          ? 'WEAK_PASSWORD'
          : field === 'username'
            ? 'INVALID_USERNAME'
            : 'BAD_REQUEST';
      return reply.status(400).send(apiError(code, issue?.message));
    }
    const status =
      typeof error === 'object' && error !== null && 'statusCode' in error
        ? Number(error.statusCode)
        : 500;
    if (status >= 400 && status < 500) {
      const message = error instanceof Error ? error.message : undefined;
      return reply.status(status).send(apiError('BAD_REQUEST', message));
    }
    // Technical details go to the log only, never to the client.
    request.log.error({ area: 'http', err: error }, 'unhandled error');
    return reply.status(500).send(apiError('INTERNAL'));
  });

  const events = new JobEvents();
  const paths = dataPaths(config);
  const secrets = createSecretBox(config.secret, paths.secretKey);
  if (secrets.source === 'file') {
    app.log.warn(
      `CONBERT_SECRET is not set – stored passwords are encrypted with a key in ${paths.secretKey}. ` +
        'Set CONBERT_SECRET for a key that is not stored next to the data.',
    );
  }
  const ctx = {
    config,
    db,
    engines: options.engines ?? serverEngines,
    setupCode: config.setupCode ?? generateSetupCode(),
    secrets,
    ldap: options.ldapConnector ?? ldaptsConnector,
    rclone: prepareRclone(config.rclonePath, paths.rclone),
    log: app.log,
    logs,
  } as AppContext;
  app.addHook('onClose', async () => logs.close());
  // "Detailed": every API request with its answer and duration.
  app.addHook('onResponse', async (request, reply) => {
    const url = request.url.split('?')[0] ?? '';
    if (!url.startsWith('/api/') || url === '/api/health') return;
    request.log.debug(
      {
        area: 'http',
        method: request.method,
        path: url,
        status: reply.statusCode,
        ms: Math.round(reply.elapsedTime),
        user: request.user?.username,
      },
      'request',
    );
  });
  // "Detailed": every program Conbert starts (ffmpeg, gallery-dl, rclone …).
  setProcessLog((entry) => {
    const dataDir = config.dataDir;
    const short = (text: string) => text.split(dataDir).join('<data>');
    app.log.debug(
      {
        area: 'process',
        ...entry,
        args: entry.args.map(short),
        ...(entry.stderr && { stderr: short(entry.stderr) }),
      },
      'program finished',
    );
  });
  // Whisper models: downloaded into the data folder on first use.
  configureWhisper(
    new ModelStore(
      paths.whisperModels,
      options.whisperModelUrl ?? config.whisperModelUrl ?? WHISPER_MODEL_BASE_URL,
      WHISPER_MODELS,
    ),
    () => readWhisperModel(db),
  );
  configureImageAi(new ModelStore(paths.imageModels, '', IMAGE_AI_MODELS));
  const blender = new BlenderInstaller(paths.blender);
  configureBlender(blender);
  const runner = new JobRunner(ctx, events);
  const queue =
    options.queue?.(runner) ??
    (options.backgroundTasks === false
      ? createInlineQueue(runner)
      : createBullQueue(config.redisUrl, runner, config.jobConcurrency, app.log, config.queueName));
  ctx.jobs = { queue, runner, events };
  const downloadRunner = new DownloadRunner(ctx, events);
  const downloadQueue =
    options.downloadQueue?.(downloadRunner) ??
    (options.backgroundTasks === false
      ? createInlineQueue(downloadRunner)
      : createBullQueue(
          config.redisUrl,
          downloadRunner,
          DOWNLOAD_CONCURRENCY,
          app.log,
          `${config.queueName}-download`,
        ));
  ctx.downloads = { queue: downloadQueue, runner: downloadRunner };
  const booruRunner = new BooruRunner(ctx, events);
  const booruQueue =
    options.booruQueue?.(booruRunner) ??
    (options.backgroundTasks === false
      ? createInlineQueue(booruRunner)
      : createBullQueue(
          config.redisUrl,
          booruRunner,
          BOORU_CONCURRENCY,
          app.log,
          `${config.queueName}-booru`,
        ));
  booruRunner.queue = booruQueue;
  booruRunner.onFinished = (row) => subscriptionCrawlFinished(ctx, row);
  ctx.booru = { queue: booruQueue, runner: booruRunner };
  app.addHook('onClose', async () => booruQueue.close());
  const workflowRunner = new WorkflowRunner(ctx, events);
  const workflowQueue =
    options.workflowQueue?.(workflowRunner) ??
    (options.backgroundTasks === false
      ? createInlineQueue(workflowRunner)
      : createBullQueue(
          config.redisUrl,
          workflowRunner,
          1,
          app.log,
          `${config.queueName}-workflow`,
        ));
  ctx.workflows = { queue: workflowQueue, runner: workflowRunner };
  app.addHook('onClose', async () => workflowQueue.close());
  app.addHook('onClose', async () => downloadQueue.close());
  app.addHook('onClose', async () => queue.close());
  app.decorate('conbert', ctx);
  app.addHook('onClose', async () => {
    if (!options.db) ctx.db.$client.close();
  });
  if (!getAuthState(db).setupDone) options.onSetupRequired?.(ctx.setupCode);

  registerSecurityHeaders(app);
  await registerAuth(app, ctx);
  registerHealthRoutes(app, ctx);
  registerAuthRoutes(app, ctx);
  registerUserRoutes(app, ctx);
  registerGroupRoutes(app, ctx);
  registerLdapRoutes(app, ctx);
  registerSettingsRoutes(app, ctx);
  registerEngineRoutes(app, ctx);
  registerJobRoutes(app, ctx);
  registerTargetRoutes(app, ctx);
  registerDownloaderRoutes(app, ctx);
  registerBooruRoutes(app, ctx);
  registerWorkflowRoutes(app, ctx);
  registerKeyRoutes(app, ctx);
  registerMediaRoutes(app, ctx);
  registerWhisperRoutes(app, ctx);
  registerPdfRoutes(app, ctx);
  registerBlenderRoutes(app, blender);
  registerImageAiRoutes(app, ctx);
  registerTokenRoutes(app, ctx);
  registerScriptingRoutes(app, ctx);
  registerOpenApiRoutes(app, pkg.version);
  registerAdminRoutes(app, ctx);
  registerLogRoutes(app, ctx);
  registerArchiveRoutes(app, ctx);
  await registerWebSocket(app, ctx);
  const uploads = registerUploads(app, ctx);

  if (options.backgroundTasks !== false) {
    const stopCleanup = startCleanup(ctx, uploads, app.log);
    const stopDiskWatch = startDiskWatch(ctx, app.log);
    app.addHook('onClose', async () => stopDiskWatch());
    // Crawls interrupted by a restart go on where they stopped.
    void resumeBooruJobs(ctx).catch((err: unknown) => app.log.warn({ err }, 'booru resume failed'));
    // Conversions and workflow runs a restart interrupted go on.
    void resumeJobs(ctx).catch((err: unknown) => app.log.warn({ err }, 'job resume failed'));
    void resumeWorkflowRuns(ctx).catch((err: unknown) =>
      app.log.warn({ err }, 'workflow resume failed'),
    );
    // Downloads a restart interrupted go on (nothing is loaded twice).
    void resumeDownloads(ctx).catch((err: unknown) =>
      app.log.warn({ err }, 'download resume failed'),
    );
    const stopSubscriptions = startSubscriptionScheduler(ctx, app.log);
    app.addHook('onClose', async () => stopSubscriptions());
    const stopMedia = startMediaScheduler(ctx, app.log);
    app.addHook('onClose', async () => stopMedia());
    const stopLdap = startLdapScheduler(ctx, app.log);
    app.addHook('onClose', async () => stopLdap());
    app.addHook('onClose', async () => stopCleanup());
  }

  const indexHtml = path.join(config.webDir, 'index.html');
  const hasWebBuild = existsSync(indexHtml);
  if (hasWebBuild) {
    await app.register(fastifyStatic, {
      root: config.webDir,
      wildcard: false,
      // Hashed assets can be cached forever; index.html must always be fresh.
      setHeaders(res, filePath) {
        // Guides as readable text in the browser (not as a download).
        if (filePath.endsWith('.md')) res.header('Content-Type', 'text/plain; charset=utf-8');
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.header('Cache-Control', 'public, max-age=31536000, immutable');
        } else {
          res.header('Cache-Control', 'no-cache');
        }
      },
    });
  } else {
    app.log.warn({ webDir: config.webDir }, 'web build not found – only the API is served');
  }

  app.setNotFoundHandler((request, reply) => {
    const isApi = request.url === '/api' || request.url.startsWith('/api/');
    if (!isApi && hasWebBuild && request.method === 'GET') {
      // Single-page app: unknown paths are handled by the client router.
      return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
    }
    return reply.status(404).send(apiError('NOT_FOUND'));
  });

  return app;
}
