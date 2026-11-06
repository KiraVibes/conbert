import { readdir, stat, statfs } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { and, desc, eq, gt, inArray, sql, type SQL } from 'drizzle-orm';
import type { AdminOverview } from '@conbert/schemas';
import pkg from '../../package.json' with { type: 'json' };
import { dataPaths } from '../config';
import type { AppContext } from '../context';
import { downloads, jobs, users } from '../db/schema';
import { imageAiModels } from '../engines/image-ai';
import { whisperSetup } from '../whisper/setup';
import { defaultQuota, quotaOf, usageByUser } from './quota';

const DAY = 24 * 60 * 60 * 1000;

/** Free and total space of the file system the folder is on. */
export async function diskOf(dir: string): Promise<{ total: number; free: number }> {
  const info = await statfs(dir);
  return { total: info.blocks * info.bsize, free: info.bavail * info.bsize };
}

/** Sizes of folders, counted at most once a minute (walking a big folder takes a moment). */
const sizes = new Map<string, { at: number; bytes: Promise<number> }>();

async function walk(dir: string): Promise<number> {
  let total = 0;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await walk(full);
    else if (entry.isFile()) total += (await stat(full).catch(() => ({ size: 0 }))).size;
  }
  return total;
}

export function folderSize(dir: string): Promise<number> {
  const cached = sizes.get(dir);
  if (cached && Date.now() - cached.at < 60_000) return cached.bytes;
  const bytes = walk(dir);
  sizes.set(dir, { at: Date.now(), bytes });
  return bytes;
}

async function modelStatus() {
  const safe = async (
    kind: 'whisper' | 'image',
    load: () => Promise<{ id: string; bytes: number; installed: boolean }[]>,
  ) =>
    (await load().catch(() => [])).map((m) => ({
      kind,
      id: m.id,
      bytes: m.bytes,
      installed: m.installed,
    }));
  return [
    ...(await safe('whisper', () => whisperSetup().models.status())),
    ...(await safe('image', () => imageAiModels().status())),
  ];
}

/** Everything the admin dashboard shows. */
export async function adminOverview(ctx: AppContext): Promise<AdminOverview> {
  const paths = dataPaths(ctx.config);
  const since = new Date(Date.now() - DAY);
  const count = (where: SQL | undefined) =>
    Number(
      ctx.db
        .select({ n: sql<number>`count(*)` })
        .from(jobs)
        .where(where)
        .get()?.n ?? 0,
    );
  const usage = usageByUser(ctx);
  const names = new Map(
    ctx.db
      .select({ id: users.id, username: users.username })
      .from(users)
      .all()
      .map((u) => [u.id, u.username]),
  );
  const active = ctx.db
    .select()
    .from(jobs)
    .where(inArray(jobs.status, ['queued', 'running']))
    .orderBy(desc(jobs.createdAt))
    .limit(25)
    .all();
  const failed = ctx.db
    .select()
    .from(jobs)
    .where(and(eq(jobs.status, 'error'), gt(jobs.createdAt, since)))
    .orderBy(desc(jobs.createdAt))
    .limit(10)
    .all();
  const downloadCount = (status: 'queued' | 'running') =>
    Number(
      ctx.db
        .select({ n: sql<number>`count(*)` })
        .from(downloads)
        .where(eq(downloads.status, status))
        .get()?.n ?? 0,
    );
  const [disk, uploadsBytes, tmpBytes, modelsBytes, models] = await Promise.all([
    diskOf(ctx.config.dataDir),
    folderSize(paths.uploads),
    folderSize(paths.tmp),
    folderSize(path.join(ctx.config.dataDir, 'models')),
    modelStatus(),
  ]);
  const memory = process.memoryUsage();
  return {
    system: {
      version: pkg.version,
      node: process.version,
      platform: `${os.platform()} ${os.arch()}`,
      cpus: os.availableParallelism(),
      load: os.loadavg().map((l) => Math.round(l * 100) / 100),
      memTotal: os.totalmem(),
      memFree: os.freemem(),
      processMemory: memory.rss,
      uptimeSeconds: Math.round(process.uptime()),
    },
    disk: {
      path: ctx.config.dataDir,
      total: disk.total,
      free: disk.free,
      uploads: uploadsBytes,
      tmp: tmpBytes,
      models: modelsBytes,
    },
    quotaDefault: defaultQuota(ctx),
    users: ctx.db
      .select({
        id: users.id,
        username: users.username,
        role: users.role,
        quotaBytes: users.quotaBytes,
      })
      .from(users)
      .all()
      .map((u) => ({
        id: u.id,
        username: u.username,
        role: u.role,
        usedBytes: usage.get(u.id) ?? 0,
        quotaBytes: quotaOf(ctx, u.id),
        quotaSetting: u.quotaBytes === null ? 'default' : u.quotaBytes < 0 ? 'unlimited' : 'custom',
      })),
    jobs: {
      queueHealthy: ctx.jobs.queue.isHealthy(),
      queued: count(eq(jobs.status, 'queued')),
      running: count(eq(jobs.status, 'running')),
      done24h: count(and(eq(jobs.status, 'done'), gt(jobs.createdAt, since))),
      failed24h: count(and(eq(jobs.status, 'error'), gt(jobs.createdAt, since))),
      active: active.map((j) => ({
        id: j.id,
        user: names.get(j.userId) ?? '?',
        inputExt: j.inputExt,
        outputExt: j.outputExt,
        status: j.status,
        progress: j.progress,
        stage: j.stage,
        createdAt: j.createdAt.toISOString(),
      })),
      recentErrors: failed.map((j) => ({
        id: j.id,
        user: names.get(j.userId) ?? '?',
        inputExt: j.inputExt,
        outputExt: j.outputExt,
        errorKey: j.errorKey ?? 'errors.convertFailed',
        createdAt: j.createdAt.toISOString(),
      })),
    },
    downloads: { queued: downloadCount('queued'), running: downloadCount('running') },
    engines: ctx.engines.map((e) => ({ id: e.id, name: e.name, status: e.status() })),
    models,
  };
}

/** The same numbers for Prometheus (text format). */
export async function prometheusMetrics(ctx: AppContext): Promise<string> {
  const o = await adminOverview(ctx);
  const lines: string[] = [];
  const metric = (
    name: string,
    help: string,
    type: 'gauge' | 'counter',
    values: [string, number][],
  ) => {
    lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);
    for (const [labels, value] of values) lines.push(`${name}${labels} ${value}`);
  };
  const label = (key: string, value: string) => `{${key}="${value.replace(/["\\\n]/g, '_')}"}`;
  metric(
    'conbert_jobs',
    'Jobs by status (queued/running now, done/failed in the last 24 h)',
    'gauge',
    [
      [label('status', 'queued'), o.jobs.queued],
      [label('status', 'running'), o.jobs.running],
      [label('status', 'done_24h'), o.jobs.done24h],
      [label('status', 'failed_24h'), o.jobs.failed24h],
    ],
  );
  metric('conbert_queue_healthy', '1 when the job queue (Valkey/Redis) works', 'gauge', [
    ['', o.jobs.queueHealthy ? 1 : 0],
  ]);
  metric('conbert_downloads', 'Downloads by status', 'gauge', [
    [label('status', 'queued'), o.downloads.queued],
    [label('status', 'running'), o.downloads.running],
  ]);
  metric('conbert_disk_bytes', 'Space of the data folder', 'gauge', [
    [label('kind', 'total'), o.disk.total],
    [label('kind', 'free'), o.disk.free],
    [label('kind', 'uploads'), o.disk.uploads],
    [label('kind', 'tmp'), o.disk.tmp],
    [label('kind', 'models'), o.disk.models],
  ]);
  metric(
    'conbert_user_storage_bytes',
    'What each user keeps on the server',
    'gauge',
    o.users.map((u) => [label('user', u.username), u.usedBytes]),
  );
  metric('conbert_process_memory_bytes', 'Memory of the Conbert server process', 'gauge', [
    ['', o.system.processMemory],
  ]);
  metric(
    'conbert_engine_up',
    '1 when an engine is usable',
    'gauge',
    o.engines.map((e) => [label('engine', e.id), e.status === 'error' ? 0 : 1]),
  );
  return `${lines.join('\n')}\n`;
}
