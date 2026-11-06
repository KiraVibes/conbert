import type { FastifyBaseLogger } from 'fastify';
import { Queue, Worker } from 'bullmq';
/** Anything that runs a queued item by id (conversions, downloads). */
export interface QueueRunner {
  run(id: string): Promise<void>;
}

/** What the API needs from a job queue. */
export interface JobQueue {
  /** `delayMs`: start later (night window, waiting after "too many requests"). */
  enqueue(jobId: string, delayMs?: number): Promise<void>;
  /** Removes a waiting job. Returns false if it was not waiting anymore. */
  removeWaiting(jobId: string): Promise<boolean>;
  isHealthy(): boolean;
  close(): Promise<void>;
}

const QUEUE_NAME = 'conbert-convert';
const ENQUEUE_TIMEOUT_MS = 5_000;
const HEALTH_INTERVAL_MS = 10_000;
/** While the queue is down, check more often so it is back quickly. */
const RETRY_INTERVAL_MS = 2_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('queue timeout')), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/**
 * BullMQ on Valkey/Redis. The worker runs in the same process; jobs survive
 * restarts of the server because they are stored in Valkey.
 */
export function createBullQueue(
  redisUrl: string,
  runner: QueueRunner,
  concurrency: number,
  log: FastifyBaseLogger,
  /** Separate names keep instances (or tests) sharing one Valkey apart. */
  queueName = QUEUE_NAME,
): JobQueue {
  // Producer. Commands wait while Valkey is down; withTimeout() below makes
  // sure no request hangs. (enableOfflineQueue: false would break BullMQ's
  // startup check for good.)
  const queue = new Queue(queueName, {
    connection: { url: redisUrl, maxRetriesPerRequest: 1 },
    skipWaitingForReady: true,
  });
  // Worker: must retry forever (BullMQ requirement).
  const worker = new Worker(queueName, async (job) => runner.run(String(job.data.jobId)), {
    connection: { url: redisUrl, maxRetriesPerRequest: null },
    concurrency,
  });

  let healthy = false;
  let warned = false;
  const check = async () => {
    try {
      // Any cheap round trip proves the connection works.
      await withTimeout(queue.getWaitingCount(), 3_000);
      if (!healthy) log.info('job queue connected');
      healthy = true;
      warned = false;
    } catch (err) {
      if (!warned) log.warn({ err, redisUrl }, 'job queue unavailable – server conversions paused');
      warned = true;
      healthy = false;
    }
  };
  let timer: NodeJS.Timeout | undefined;
  let closed = false;
  const loop = async () => {
    await check();
    if (closed) return;
    timer = setTimeout(() => void loop(), healthy ? HEALTH_INTERVAL_MS : RETRY_INTERVAL_MS);
    timer.unref();
  };
  void loop();
  // Connection errors repeat while Valkey is down; the health check reports
  // that once, so only log them at debug level.
  queue.on('error', (err) => log.debug({ err }, 'queue connection error'));
  worker.on('error', (err) => log.debug({ err }, 'worker connection error'));
  worker.on('ready', () => log.debug('queue worker ready'));
  worker.on('active', (job) => log.debug({ jobId: job.data.jobId }, 'job started'));
  worker.on('failed', (job, err) => log.error({ err, jobId: job?.data.jobId }, 'job crashed'));

  return {
    async enqueue(jobId, delayMs) {
      // BullMQ ignores an add under the id of a job that is running right now –
      // so a job that wants to go on later (waiting for the night window, after
      // "too many requests") gets a follow-up id. A waiting copy is still not
      // added twice.
      const existing = await withTimeout(queue.getJob(jobId), ENQUEUE_TIMEOUT_MS).catch(
        () => undefined,
      );
      const state = existing ? await existing.getState().catch(() => 'unknown') : null;
      const id = state === 'active' ? `${jobId}-again-${Date.now()}` : jobId;
      await withTimeout(
        queue.add(
          'convert',
          { jobId },
          {
            jobId: id,
            attempts: 1,
            removeOnComplete: true,
            removeOnFail: true,
            ...(delayMs && delayMs > 0 && { delay: delayMs }),
          },
        ),
        ENQUEUE_TIMEOUT_MS,
      );
    },
    async removeWaiting(jobId) {
      // The job itself and follow-ups (see enqueue) that are still waiting.
      const waiting = await withTimeout(
        queue.getJobs(['waiting', 'delayed', 'prioritized']),
        ENQUEUE_TIMEOUT_MS,
      ).catch(() => []);
      const mine = waiting.filter((job) => job && String(job.data?.jobId) === jobId);
      await Promise.all(mine.map((job) => job.remove().catch(() => undefined)));
      return mine.length > 0;
    },
    isHealthy: () => healthy,
    async close() {
      closed = true;
      clearTimeout(timer);
      await worker.close().catch(() => undefined);
      await queue.close().catch(() => undefined);
    },
  };
}

/** Runs jobs right away in the same process – for tests (no Valkey needed). */
export function createInlineQueue(runner: QueueRunner): JobQueue & { idle(): Promise<void> } {
  const pending = new Set<Promise<void>>();
  return {
    async enqueue(jobId, delayMs) {
      if (delayMs && delayMs > 0) {
        const timer = setTimeout(() => void this.enqueue(jobId), delayMs);
        timer.unref();
        return;
      }
      const run = runner.run(jobId).finally(() => pending.delete(run));
      pending.add(run);
    },
    removeWaiting: async () => false,
    isHealthy: () => true,
    close: async () => {
      await Promise.all(pending);
    },
    idle: async () => {
      await Promise.all(pending);
    },
  };
}
