import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { and, eq, inArray } from 'drizzle-orm';
import { fileTypeFromFile } from 'file-type';
import {
  PARALLEL_DOWNLOADS_PER_SITE,
  SPEED_INTERVAL_MS,
  getFormat,
  insideWindow,
  isAbortError,
  msUntilWindow,
  normalizeExt,
  renderPostName,
  requestInterval,
  safeName,
  type BooruPost,
  type CrawlSpeed,
  type SidecarKind,
  type TimeWindow,
} from '@conbert/core';
import type { AfterDownload, BooruJobDto, BooruSettings, HiddenCounts } from '@conbert/schemas';
import { runAfter } from '../workflows/service';
import { dataPaths } from '../config';
import type { AppContext } from '../context';
import { booruArchive, booruJobs, storageTargets, type BooruJobRecord } from '../db/schema';
import { API_ERROR_KEYS, HttpError } from '../lib/http-error';
import type { JobEvents } from '../queue/events';
import type { JobQueue } from '../queue/job-queue';
import { recordFile } from '../storage/uploads';
import { exportFile } from '../targets/export';
import { BooruError, booruRequest, checkedUrl, fileSlots } from './http';
import { embedMetadata, sidecarContent } from './metadata';
import {
  clientFor,
  emptyHidden,
  knownPosts,
  listPage,
  prepareQuery,
  readSettings,
  screenPost,
  siteFor,
  thumbToken,
  type PreparedQuery,
  type SiteClient,
} from './service';

/**
 * Booru crawls in the background (own BullMQ queue). The state – where the
 * crawl is, what was seen and loaded – is saved after every page, so a
 * restart, a pause or a lost connection only interrupts it.
 */

export interface CrawlOptions {
  limit: number;
  speed: CrawlSpeed;
  window: TimeWindow | null;
  filePattern: string;
  folderPattern: string;
  sidecars: SidecarKind[];
  sample: boolean;
  targetIds: string[];
  toList: boolean;
  workflowId: string | null;
  /** "Danach automatisch …": the files go through a workflow first. */
  after?: AfterDownload;
  /** Chosen posts from the preview grid (instead of the whole search). */
  postIds?: number[];
  /** Subscriptions: stop at posts with this ID or lower (seen before). */
  stopAtId?: number;
}

export interface CrawlFile {
  postId: number;
  name: string;
  ext: string;
  size: number;
  fileId: string | null;
  thumb: string | null;
}

export interface CrawlState {
  /** Where the next page starts (null = at the beginning). */
  cursor: { before?: number; page?: number } | null;
  /** Posts of a selection still to load. */
  pending?: number[];
  scanned: number;
  matched: number;
  downloaded: number;
  duplicates: number;
  failed: number;
  hidden: HiddenCounts;
  /** Newest loaded files (preview grid during the crawl). */
  recent: CrawlFile[];
  /** Files for the conversion list (only when toList). */
  files: CrawlFile[];
  savedTo: string[];
  /** Highest post ID seen (subscriptions go on from there). */
  newestId: number | null;
  /** Time spent working (for the time estimate). */
  workMs: number;
  /** Rough number of posts to look through. */
  estimate: number | null;
}

export function initialState(postIds?: number[]): CrawlState {
  return {
    cursor: null,
    ...(postIds && { pending: [...postIds] }),
    scanned: 0,
    matched: 0,
    downloaded: 0,
    duplicates: 0,
    failed: 0,
    hidden: emptyHidden(),
    recent: [],
    files: [],
    savedTo: [],
    newestId: null,
    workMs: 0,
    estimate: null,
  };
}

const RECENT = 24;
const FILE_TIMEOUT_MS = 10 * 60_000;
/** Lost connection: try again after this long (the crawl only pauses). */
const OFFLINE_WAIT_MS = 10 * 60_000;
const MIN_RATE_WAIT_MS = 5 * 60_000;

function etaSeconds(row: BooruJobRecord, state: CrawlState, options: CrawlOptions): number | null {
  if (row.status !== 'running' || state.scanned === 0 || state.workMs < 3_000) return null;
  const perScanned = state.workMs / state.scanned;
  const leftToLoad = options.limit - state.downloaded;
  const byLimit =
    state.downloaded > 0
      ? (leftToLoad * state.workMs) / state.downloaded
      : Number.POSITIVE_INFINITY;
  const byScan =
    state.estimate !== null
      ? Math.max(0, state.estimate - state.scanned) * perScanned
      : Number.POSITIVE_INFINITY;
  const eta = Math.min(byLimit, byScan);
  return Number.isFinite(eta) ? Math.round(eta / 1000) : null;
}

export function toBooruJobDto(ctx: AppContext, row: BooruJobRecord): BooruJobDto {
  const state = { ...initialState(), ...(row.state as Partial<CrawlState>) };
  const options = row.options as CrawlOptions;
  let siteName = row.siteId;
  try {
    siteName = siteFor(ctx, row.userId, row.siteId, { allowRetired: true }).name;
  } catch {
    // Own instance removed – keep the ID.
  }
  return {
    id: row.id,
    siteId: row.siteId,
    siteName,
    query: row.query,
    status: row.status,
    speed: options.speed,
    limit: options.limit,
    scanned: state.scanned,
    matched: state.matched,
    downloaded: state.downloaded,
    duplicates: state.duplicates,
    failed: state.failed,
    hidden: state.hidden,
    etaSeconds: etaSeconds(row, state, options),
    resumeAt: row.resumeAt?.toISOString() ?? null,
    recent: state.recent,
    // With a workflow, its results (not the originals) go to the list.
    toList: options.toList && !options.after,
    savedTo: state.savedTo,
    subscriptionId: row.subscriptionId,
    error: row.errorKey
      ? { messageKey: row.errorKey, ...(row.errorDetails ? { details: row.errorDetails } : {}) }
      : null,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

/** Stops a crawl from the outside (pause or cancel), with the status it should keep. */
type StopReason = 'paused' | 'cancelled';

export class BooruRunner {
  private readonly running = new Map<string, { controller: AbortController; stop?: StopReason }>();
  /** Set right after the queue exists (they need each other). */
  queue!: JobQueue;
  /** Called when a crawl ends (subscriptions, workflows, notifications). */
  onFinished?: (row: BooruJobRecord) => Promise<void> | void;

  constructor(
    private readonly ctx: AppContext,
    private readonly events: JobEvents,
  ) {}

  row(id: string): BooruJobRecord | undefined {
    return this.ctx.db.select().from(booruJobs).where(eq(booruJobs.id, id)).get();
  }

  update(id: string, patch: Partial<BooruJobRecord>): BooruJobRecord | undefined {
    if (Object.keys(patch).length > 0) {
      this.ctx.db.update(booruJobs).set(patch).where(eq(booruJobs.id, id)).run();
    }
    const row = this.row(id);
    if (row) this.events.emit('booru', row.userId, toBooruJobDto(this.ctx, row));
    return row;
  }

  /** Pause or cancel a running crawl. Returns false if it wasn't running here. */
  stop(id: string, reason: StopReason): boolean {
    const run = this.running.get(id);
    if (!run) return false;
    run.stop = reason;
    run.controller.abort();
    return true;
  }

  async run(id: string): Promise<void> {
    const row = this.row(id);
    if (!row || (row.status !== 'queued' && row.status !== 'waiting')) return;
    // A crawl that is started again while it runs (e.g. "go on" twice) runs once.
    if (this.running.has(id)) return;
    const options = row.options as CrawlOptions;
    const state: CrawlState = { ...initialState(), ...(row.state as Partial<CrawlState>) };
    const wait = msUntilWindow(options.window, new Date());
    if (wait > 0) {
      await this.later(id, wait);
      return;
    }
    const run = { controller: new AbortController() } as {
      controller: AbortController;
      stop?: StopReason;
    };
    this.running.set(id, run);
    const signal = run.controller.signal;
    const folder = path.join(dataPaths(this.ctx.config).tmp, `booru-${id}`);
    let started = Date.now();
    const save = (patch: Partial<BooruJobRecord> = {}) => {
      state.workMs += Date.now() - started;
      started = Date.now();
      return this.update(id, { state, ...patch });
    };
    try {
      this.update(id, { status: 'running', resumeAt: null, errorKey: null, errorDetails: null });
      await mkdir(folder, { recursive: true });
      const site = siteFor(this.ctx, row.userId, row.siteId);
      const settings = readSettings(this.ctx, row.userId);
      const intervalMs = requestInterval(options.speed, site.minIntervalMs);
      const client = clientFor(this.ctx, row.userId, site, {
        intervalMs,
        signal,
        retries: 6,
        maxWaitMs: 15 * 60_000,
      });
      const targets = this.chosenTargets(row.userId, options.targetIds);
      let lastReport = 0;
      const report = () => {
        if (Date.now() - lastReport < 1000) return;
        lastReport = Date.now();
        save();
      };
      const loader = new PostLoader(
        this.ctx,
        row,
        options,
        settings,
        client,
        folder,
        targets,
        state,
        signal,
        report,
      );
      // Counts what was tried, so failed files can't make it go through the whole site.
      const done = () => state.matched >= options.limit;

      if (state.pending) {
        // A selection: load these posts (checked again – settings may have changed).
        while (state.pending.length > 0 && !done()) {
          const batch = state.pending.slice(0, 100);
          const posts = await client.adapter.byIds(batch);
          await loader.handle(posts, null);
          state.pending = state.pending.slice(batch.length);
          save();
          if (!insideWindow(options.window, new Date()))
            return await this.later(id, msUntilWindow(options.window, new Date()), state);
        }
      } else {
        let prepared: PreparedQuery = await prepareQuery(client, row.query, settings);
        let current: SiteClient = client;
        if (state.estimate === null) state.estimate = await this.estimate(prepared);
        const perPage = Math.min(site.maxPerPage, 100);
        while (!done()) {
          const cursor = state.cursor;
          const page = await listPage(
            this.ctx,
            row.userId,
            current,
            prepared,
            row.query,
            settings,
            {
              limit: perPage,
              ...(cursor?.before !== undefined
                ? { beforeId: cursor.before }
                : cursor?.page !== undefined
                  ? { page: cursor.page }
                  : {}),
            },
          );
          current = page.client;
          prepared = page.prepared;
          if (page.posts.length === 0) break;
          const reachedOld = await loader.handle(page.posts, prepared);
          const lowest = Math.min(...page.posts.map((p) => p.id));
          state.cursor = prepared.plan.idNavigation
            ? { before: lowest }
            : { page: (cursor?.page ?? 1) + 1 };
          save();
          if (reachedOld) break;
          if (
            !prepared.plan.idNavigation &&
            site.pageLimit !== null &&
            (state.cursor.page ?? 0) > site.pageLimit
          ) {
            await loader.idle();
            this.finish(id, 'done', state, { errorKey: API_ERROR_KEYS.BOORU_PAGE_LIMIT });
            return;
          }
          if (!insideWindow(options.window, new Date())) {
            await loader.idle();
            await this.later(id, msUntilWindow(options.window, new Date()), state);
            return;
          }
        }
      }
      await loader.idle();
      this.finish(id, 'done', state);
    } catch (error) {
      await Promise.resolve();
      if (signal.aborted || isAbortError(error)) {
        const status = run.stop ?? 'cancelled';
        save({ status, ...(status === 'cancelled' && { finishedAt: new Date() }) });
        return;
      }
      if (error instanceof BooruError && error.code === 'BOORU_RATE_LIMITED') {
        await this.later(
          id,
          Math.max(MIN_RATE_WAIT_MS, error.retryAfterMs ?? 0),
          state,
          'BOORU_RATE_LIMITED',
        );
        return;
      }
      if (error instanceof BooruError && error.code === 'BOORU_UNREACHABLE') {
        await this.later(id, OFFLINE_WAIT_MS, state, 'BOORU_UNREACHABLE');
        return;
      }
      if (error instanceof BooruError && error.code === 'BOORU_BLOCKED') {
        // Never get around a block: pause and explain.
        save({
          status: 'paused',
          errorKey: API_ERROR_KEYS.BOORU_BLOCKED,
          errorDetails: error.details ?? null,
        });
        return;
      }
      const code =
        error instanceof BooruError
          ? error.code
          : error instanceof HttpError
            ? error.code
            : 'INTERNAL';
      const details =
        error instanceof Error
          ? error instanceof HttpError
            ? error.details
            : error.message
          : String(error);
      this.finish(id, 'error', state, {
        errorKey: API_ERROR_KEYS[code],
        errorDetails: details?.slice(0, 2000) ?? null,
      });
    } finally {
      this.running.delete(id);
      await rm(folder, { recursive: true, force: true });
    }
  }

  private async estimate(prepared: PreparedQuery): Promise<number | null> {
    const sent = prepared.plan.apiTokens.filter((t) => !t.startsWith('-') && !t.includes(':'));
    const counts = sent.map((t) => prepared.counts[t]).filter((n): n is number => n !== undefined);
    return counts.length > 0 ? Math.min(...counts) : null;
  }

  /** Waiting (night window, "too many requests", offline): goes on by itself. */
  private async later(
    id: string,
    ms: number,
    state?: CrawlState,
    reason?: keyof typeof API_ERROR_KEYS,
  ) {
    const resumeAt = new Date(Date.now() + ms);
    this.update(id, {
      status: 'waiting',
      resumeAt,
      ...(state && { state }),
      errorKey: reason ? API_ERROR_KEYS[reason] : null,
    });
    await this.queue.enqueue(id, ms).catch(() => undefined);
  }

  private finish(
    id: string,
    status: 'done' | 'error',
    state: CrawlState,
    patch: Partial<BooruJobRecord> = {},
  ) {
    const before = this.row(id);
    const options = before?.options as CrawlOptions | undefined;
    const fileIds = state.files.map((f) => f.fileId).filter((f): f is string => f !== null);
    // "Danach automatisch …": the loaded files go through the workflow now.
    if (before && options?.after && fileIds.length > 0) {
      void runAfter(this.ctx, before.userId, options.after, fileIds, {
        toList: options.toList,
        targetIds: options.targetIds,
        label: before.query || before.siteId,
      }).catch(() => undefined);
    }
    const row = this.update(id, {
      status,
      state,
      finishedAt: new Date(),
      resumeAt: null,
      ...patch,
    });
    if (row && this.onFinished) void Promise.resolve(this.onFinished(row)).catch(() => undefined);
  }

  private chosenTargets(userId: string, ids: string[]): { id: string; name: string }[] {
    if (ids.length === 0) return [];
    return this.ctx.db
      .select({
        id: storageTargets.id,
        name: storageTargets.name,
        asTarget: storageTargets.asTarget,
      })
      .from(storageTargets)
      .where(and(eq(storageTargets.userId, userId), inArray(storageTargets.id, ids)))
      .all()
      .filter((t) => t.asTarget);
  }
}

/** Checks, loads and saves the posts of one crawl – two files of a site at a time. */
/** Checks the magic bytes: only pictures and videos are kept (no error pages). */
async function assertMediaFile(file: string): Promise<void> {
  const detected = await fileTypeFromFile(file).catch(() => undefined);
  const category = detected ? getFormat(normalizeExt(detected.ext))?.category : undefined;
  if (category !== 'image' && category !== 'video') {
    throw new Error(`not a picture or video (${detected?.mime ?? 'unknown'})`);
  }
}

class PostLoader {
  private readonly pendingLoads = new Set<Promise<void>>();
  private readonly fileInterval: number;

  constructor(
    private readonly ctx: AppContext,
    private readonly row: BooruJobRecord,
    private readonly options: CrawlOptions,
    private readonly settings: BooruSettings,
    private readonly client: SiteClient,
    private readonly folder: string,
    private readonly targets: { id: string; name: string }[],
    private readonly state: CrawlState,
    private readonly signal: AbortSignal,
    private readonly report: () => void,
  ) {
    // Slow modes keep their distance for files too.
    this.fileInterval = options.speed === 'normal' ? 0 : SPEED_INTERVAL_MS[options.speed];
  }

  /** Returns true when a subscription reached posts it saw before. */
  async handle(posts: BooruPost[], prepared: PreparedQuery | null): Promise<boolean> {
    const local = prepared?.plan.local ?? [
      { kind: 'rating' as const, ratings: [...this.settings.ratings] },
    ];
    const known = knownPosts(this.ctx, this.row.userId, this.row.siteId, posts);
    let reachedOld = false;
    for (const post of posts) {
      if (this.signal.aborted) throw new DOMException('aborted', 'AbortError');
      if (this.options.stopAtId !== undefined && post.id <= this.options.stopAtId) {
        reachedOld = true;
        break;
      }
      this.state.scanned += 1;
      this.state.newestId = Math.max(this.state.newestId ?? 0, post.id);
      const verdict = screenPost(post, this.settings, local);
      if (verdict !== 'ok') {
        this.state.hidden[verdict] += 1;
        continue;
      }
      if (known.has(post.id)) {
        this.state.duplicates += 1;
        continue;
      }
      if (this.state.matched >= this.options.limit) break;
      this.state.matched += 1;
      // Mark at once, so the same file in this crawl isn't loaded twice.
      this.archive(post);
      while (this.pendingLoads.size >= PARALLEL_DOWNLOADS_PER_SITE)
        await Promise.race(this.pendingLoads);
      const load: Promise<void> = this.load(post)
        .catch((error: unknown) => {
          if (this.signal.aborted || isAbortError(error)) return;
          this.state.failed += 1;
          this.unarchive(post);
        })
        .finally(() => this.pendingLoads.delete(load));
      this.pendingLoads.add(load);
    }
    await this.idle();
    if (this.signal.aborted) throw new DOMException('aborted', 'AbortError');
    return reachedOld;
  }

  async idle(): Promise<void> {
    await Promise.all(this.pendingLoads);
  }

  private archive(post: BooruPost) {
    this.ctx.db
      .insert(booruArchive)
      .values({ userId: this.row.userId, siteId: this.row.siteId, postId: post.id, md5: post.md5 })
      .onConflictDoNothing()
      .run();
  }

  private unarchive(post: BooruPost) {
    this.ctx.db
      .delete(booruArchive)
      .where(
        and(
          eq(booruArchive.userId, this.row.userId),
          eq(booruArchive.siteId, this.row.siteId),
          eq(booruArchive.postId, post.id),
        ),
      )
      .run();
  }

  private async load(post: BooruPost): Promise<void> {
    const address = (this.options.sample && post.sampleUrl) || post.fileUrl;
    const url = address ? checkedUrl(address, this.client.allowPrivate) : null;
    if (!url) throw new Error('no file address');
    const ext = normalizeExt(
      this.options.sample && post.sampleUrl
        ? (/\.([a-z0-9]{2,5})(?:\?|$)/i.exec(post.sampleUrl)?.[1] ?? post.ext ?? 'jpg')
        : (post.ext ?? 'bin'),
    );
    const named = { ...post, ext };
    const release = await fileSlots(
      `${this.client.siteKey}:files`,
      PARALLEL_DOWNLOADS_PER_SITE,
    ).take();
    const file = path.join(this.folder, `${randomUUID()}.${ext}`);
    try {
      const res = await booruRequest(url, {
        siteKey: `${this.client.siteKey}:files`,
        intervalMs: this.fileInterval,
        headers: { ...this.client.headers, Accept: '*/*' },
        allowPrivate: this.client.allowPrivate,
        signal: this.signal,
        retries: 3,
        maxWaitMs: 15 * 60_000,
        timeoutMs: FILE_TIMEOUT_MS,
      });
      // An HTML or JSON answer is an error page, not the picture.
      if (/^(text\/|application\/json)/i.test(res.headers.get('content-type') ?? '')) {
        await res.body?.cancel();
        throw new Error(`not a media file (${res.headers.get('content-type')})`);
      }
      const length = Number(res.headers.get('content-length') ?? 0);
      if (length > this.ctx.config.maxUploadBytes || !res.body) {
        await res.body?.cancel();
        throw new Error('file too large');
      }
      let size = 0;
      const max = this.ctx.config.maxUploadBytes;
      const body = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
      body.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > max) body.destroy(new Error('file too large'));
      });
      await pipeline(body, createWriteStream(file), { signal: this.signal });
      await assertMediaFile(file);
    } catch (error) {
      await rm(file, { force: true });
      throw error;
    } finally {
      release();
    }
    await embedMetadata(named, file, this.options.sidecars.includes('embed'), this.signal);
    const info = await stat(file);
    const siteLabel = safeName(
      this.client.site.custom ? this.client.site.name : this.client.site.id,
    );
    const { folder, name } = renderPostName(
      this.options.filePattern,
      this.options.folderPattern,
      named,
      {
        site: siteLabel,
        // Folders carry the site's name, like the downloader's platform folders: Gelbooru/…
        siteFolder: safeName(this.client.site.name),
        searchTags: this.row.query,
      },
    );
    const entry: CrawlFile = {
      postId: post.id,
      name,
      ext,
      size: info.size,
      fileId: null,
      thumb: thumbToken(this.client, this.row.userId, post.previewUrl),
    };
    if (this.targets.length > 0 && !this.options.after) {
      const category = getFormat(ext)?.category;
      const results = await exportFile(
        this.ctx,
        this.row.userId,
        { filePath: file, name, ext },
        { targetIds: this.targets.map((t) => t.id), folder, name, ...(category && { category }) },
        { index: true },
      );
      if (!results.some((r) => r.status === 'saved' || r.status === 'skipped')) {
        throw new Error(results.find((r) => r.error)?.error?.messageKey ?? 'save failed');
      }
      for (const r of results) {
        const target = this.targets.find((t) => t.id === r.targetId)?.name;
        if (target && r.status !== 'error' && !this.state.savedTo.includes(target))
          this.state.savedTo.push(target);
      }
      for (const kind of this.options.sidecars) {
        if (kind === 'embed') continue;
        const side = `${file}.${kind}`;
        await writeFile(side, sidecarContent(kind, named, siteLabel));
        await exportFile(
          this.ctx,
          this.row.userId,
          { filePath: side, name: `${name}.${kind}`, ext: kind },
          { targetIds: this.targets.map((t) => t.id), folder, name: `${name}.${kind}` },
        ).catch(() => []);
        await rm(side, { force: true });
      }
    }
    if (this.options.toList || this.options.after) {
      const fileId = randomUUID();
      const target = path.join(dataPaths(this.ctx.config).uploads, fileId);
      await mkdir(path.dirname(target), { recursive: true });
      await rename(file, target);
      await recordFile(this.ctx, {
        id: fileId,
        userId: this.row.userId,
        filePath: target,
        name,
        size: info.size,
      });
      entry.fileId = fileId;
      this.state.files.push(entry);
    } else {
      await rm(file, { force: true });
    }
    this.state.downloaded += 1;
    this.state.recent = [entry, ...this.state.recent].slice(0, RECENT);
    this.report();
  }
}
