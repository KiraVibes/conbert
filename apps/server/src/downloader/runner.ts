import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { and, eq, inArray } from 'drizzle-orm';
import {
  compactDate,
  DEFAULT_PIXIV_OPTIONS,
  getFormat,
  isAbortError,
  normalizeExt,
  platformFolder,
  type DownloadQuality,
  type PixivOptions,
  type Platform,
  type ProfilePart,
} from '@conbert/core';
import type { AfterDownload, DownloadDto, DownloadedFile } from '@conbert/schemas';
import { runAfter } from '../workflows/service';
import { dataPaths } from '../config';
import type { AppContext } from '../context';
import { downloads, storageTargets, type DownloadRecord } from '../db/schema';
import { API_ERROR_KEYS, HttpError } from '../lib/http-error';
import { tail, userName } from '../logs/who';
import { ProcessError, runProcess } from '../lib/run-process';
import type { JobEvents } from '../queue/events';
import { deleteFileRecord, recordFile } from '../storage/uploads';
import { exportFile } from '../targets/export';
import { cookieFile } from './cookies';
import { deviantartConfigFile } from './deviantart';
import { pixivConfigFile } from './pixiv';
import { feedDownloadFinished } from './feeds';
import { makeThumbnail } from './thumbnails';
import {
  classifyDownloadError,
  ensurePublicLink,
  isMissingTool,
  toolEnv,
  toolHome,
  toolPath,
} from './tools';

export interface DownloadOptions {
  quality: DownloadQuality;
  parts: ProfilePart[];
  /** Pixiv: animated pictures and works for adults. */
  pixiv?: PixivOptions;
  limit: number;
  dateAfter?: string;
  dateBefore?: string;
  sleepSeconds: number;
  /** Storage locations each file goes to as soon as it is done. */
  targetIds?: string[];
  /** Into the conversion list (default for older rows: yes). */
  toList?: boolean;
  /** "Danach automatisch …": the files go through a workflow first. */
  after?: AfterDownload;
  /** A subscription check: nothing new is no error. */
  feed?: boolean;
  /** Channel, profile, thread or playlist – the files get a folder of that name. */
  sourceName?: string | null;
  /** The tool's list of items seen (only new ones are loaded). */
  archiveFile?: string;
  /** Only note what is there, load nothing ("only new from now on"). */
  recordOnly?: boolean;
  /** Newest first: stop at the first item already known. */
  stopAtKnown?: boolean;
}

/** Long playlists or profiles in slow mode can take hours. */
const TIMEOUT_MS = 6 * 60 * 60_000;
/** A DeviantArt download of the same account is running: look again after this long. */
const TURN_WAIT_MS = 20_000;
/** Leftovers of interrupted downloads and the tools' own notes. */
const NOT_A_RESULT =
  /\.(part|ytdl|temp|tmp|json|txt|description|info|sqlite3|sqlite3-journal|db-wal|db-shm)$|^cookies-/i;

/** Notes and caches of the tools (gallery-dl's cache.sqlite3 …) – never a download. */
export function isToolLeftover(name: string): boolean {
  return NOT_A_RESULT.test(name);
}

/** Hidden folders (.cache, .config …) belong to the tools, never to the downloads. */
export function inHiddenFolder(folder: string, full: string): boolean {
  return path
    .relative(folder, full)
    .split(path.sep)
    .slice(0, -1)
    .some((part) => part.startsWith('.'));
}
/**
 * The post folder gallery-dl made for a post with several files
 * ("151308310"), or null for a file directly in the download folder.
 */
export function postFolderOf(folder: string, full: string): string | null {
  const parts = path.relative(folder, full).split(path.sep);
  return parts.length === 2 && /^[A-Za-z0-9_-]{1,64}$/.test(parts[0] ?? '')
    ? (parts[0] ?? null)
    : null;
}

/** yt-dlp puts the covers here (inside the download folder, not results). */
const THUMBS = '.thumbs';

export function toDownloadDto(row: DownloadRecord, current?: number): DownloadDto {
  const options = row.options as DownloadOptions;
  return {
    id: row.id,
    url: row.url,
    platform: row.platform as DownloadDto['platform'],
    title: row.title,
    status: row.status,
    progress: row.progress,
    current: row.status === 'running' && current !== undefined ? Math.round(current) : null,
    // With a workflow, its results (not the downloaded originals) go to the list.
    toList: (options.toList ?? true) && !options.after,
    done: row.done,
    total: row.total,
    files: (row.files as Partial<DownloadedFile>[]).map((f) => ({
      fileId: f.fileId ?? '',
      name: f.name ?? '',
      ext: f.ext ?? '',
      size: f.size ?? 0,
      savedTo: f.savedTo ?? [],
      saveError: f.saveError ?? null,
      onServer: f.onServer ?? true,
      thumbnail: f.thumbnail ?? false,
      alreadyThere: f.alreadyThere ?? false,
    })),
    skipped: row.skipped,
    known: row.known,
    savedTo: row.savedTo,
    error: row.errorKey
      ? { messageKey: row.errorKey, ...(row.errorDetails ? { details: row.errorDetails } : {}) }
      : null,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    feedId: row.feedId ?? null,
    recordOnly: options.recordOnly === true,
    // Done without a single file: everything had been loaded before.
    nothingNew:
      row.status === 'done' && (row.files as unknown[]).length === 0 && options.recordOnly !== true,
  };
}

const QUALITY_ARGS: Record<DownloadQuality, string[]> = {
  // Best picture and sound; MP4 when it costs nothing (plays everywhere).
  best: ['-S', 'res,ext:mp4:m4a', '--merge-output-format', 'mp4/mkv'],
  '1080': ['-S', 'res:1080,ext:mp4:m4a', '--merge-output-format', 'mp4/mkv'],
  '720': ['-S', 'res:720,ext:mp4:m4a', '--merge-output-format', 'mp4/mkv'],
  '480': ['-S', 'res:480,ext:mp4:m4a', '--merge-output-format', 'mp4/mkv'],
  audio: ['-x', '--audio-format', 'mp3', '--audio-quality', '0'],
};

/** yt-dlp arguments – the link always comes last, after "--". */
export function ytDlpArgs(
  url: string,
  single: boolean,
  folder: string,
  options: DownloadOptions,
  cookies: string | null,
): string[] {
  const after = options.dateAfter ? compactDate(options.dateAfter) : null;
  const before = options.dateBefore ? compactDate(options.dateBefore) : null;
  if (options.recordOnly && options.archiveFile) {
    // Note every item that is there now, without loading it (fast: list only).
    return [
      '--ignore-config',
      '--no-warnings',
      '--js-runtimes',
      'node',
      '--flat-playlist',
      '--simulate',
      '--force-write-archive',
      '--download-archive',
      options.archiveFile,
      '--sleep-requests',
      String(options.sleepSeconds),
      '-I',
      `:${options.limit}`,
      ...(cookies ? ['--cookies', cookies] : []),
      '--',
      url,
    ];
  }
  return [
    '--ignore-config',
    '--no-warnings',
    '--newline',
    '--no-mtime',
    '--js-runtimes',
    'node',
    '--windows-filenames',
    '--paths',
    folder,
    '-o',
    '%(title).90B [%(id)s].%(ext)s',
    '--sleep-requests',
    String(options.sleepSeconds),
    '--sleep-interval',
    String(options.sleepSeconds),
    single ? '--no-playlist' : '--yes-playlist',
    '-I',
    `:${options.limit}`,
    ...QUALITY_ARGS[options.quality],
    ...(after ? ['--dateafter', after] : []),
    ...(before ? ['--datebefore', before] : []),
    ...(cookies ? ['--cookies', cookies] : []),
    ...(options.archiveFile ? ['--download-archive', options.archiveFile] : []),
    ...(options.stopAtKnown ? ['--break-on-existing'] : []),
    // Announce every finished file (after merging/converting), so it can be
    // taken over right away; --no-simulate/--progress keep the download and
    // the progress lines that --print would otherwise switch off.
    '--no-simulate',
    '--progress',
    '--print',
    'after_move:CONBERT_FILE|%(id)s|%(filepath)s',
    // --print would silence yt-dlp; its "already recorded in the archive" lines are counted.
    '--no-quiet',
    // The cover of each item: kept apart for the tile, and put into the file
    // (music players show it), together with title and artist.
    '--write-thumbnail',
    '--convert-thumbnails',
    'jpg',
    '-o',
    `thumbnail:${THUMBS}/%(id)s.%(ext)s`,
    '--embed-thumbnail',
    '--embed-metadata',
    '--progress-template',
    'download:CONBERT|%(info.playlist_index)s|%(info.n_entries)s|%(progress._percent_str)s',
    '--',
    url,
  ];
}

/**
 * When gallery-dl puts a post into its own folder, and how the folder is
 * named – the number the file names start with (see postOf in @conbert/core).
 * 4chan threads are a folder already; yt-dlp sites are videos, one per post.
 */
const POST_FOLDERS: Partial<Record<Platform, { when: string; name: string }>> = {
  pixiv: { when: 'count > 1', name: '{id}' },
  x: { when: 'count > 1', name: '{tweet_id}' },
  instagram: { when: 'count > 1', name: '{post_id}' },
  tumblr: { when: 'count > 1', name: '{id}' },
  pinterest: { when: 'count > 1', name: '{id}' },
  deviantart: { when: 'count > 1', name: '{index}' },
  // Galleries and photo posts count their files in "num" (0 = a single file).
  reddit: { when: 'num > 0', name: '{id}' },
  tiktok: { when: 'num > 0', name: '{id}' },
};

/** gallery-dl arguments – dates become a filter built from checked numbers only. */
export function galleryDlArgs(
  url: string,
  platform: Platform,
  folder: string,
  options: DownloadOptions,
  cookies: string | null,
  config: string | null = null,
): string[] {
  const instagram = platform === 'instagram';
  const pixiv = platform === 'pixiv' ? (options.pixiv ?? DEFAULT_PIXIV_OPTIONS) : null;
  const date = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number);
    return `datetime(${y}, ${m}, ${d})`;
  };
  // Posts with several pictures or videos go into a folder named after the
  // post ("151308310/151308310_p76.jpg"); single files stay as they are.
  const post = POST_FOLDERS[platform];
  const where = post
    ? ['-d', folder, '-o', `directory=${JSON.stringify({ [post.when]: [post.name], '': [] })}`]
    : ['-D', folder];
  const filters = [
    ...(options.dateAfter ? [`date >= ${date(options.dateAfter)}`] : []),
    ...(options.dateBefore ? [`date < ${date(options.dateBefore)}`] : []),
    // Pixiv marks works for adults with x_restrict 1 (R-18) or 2 (R-18G).
    ...(pixiv && !pixiv.adult ? ['x_restrict == 0'] : []),
  ];
  return [
    '--config-ignore',
    ...(config ? ['-c', config] : []),
    ...where,
    '--range',
    `1-${options.limit}`,
    // The pause before each file – pointless while only remembering what exists
    // (a subscription's first run would wait sleepSeconds per item for nothing).
    ...(options.recordOnly ? [] : ['--sleep', String(options.sleepSeconds)]),
    '--sleep-request',
    String(options.sleepSeconds),
    ...(instagram && options.parts.length > 0 ? ['-o', `include=${options.parts.join(',')}`] : []),
    ...(filters.length > 0 ? ['--filter', filters.join(' and ')] : []),
    // Animated pictures: frames + timing → a video or GIF (ffmpeg), or kept as zip.
    ...(pixiv ? ['--ugoira', pixiv.ugoira] : []),
    ...(cookies ? ['--cookies', cookies] : []),
    ...(options.archiveFile ? ['--download-archive', options.archiveFile] : []),
    ...(options.recordOnly ? ['--no-download'] : []),
    // Newest first: three known items in a row mean everything after is known too.
    ...(options.stopAtKnown && !options.recordOnly ? ['--abort', '3'] : []),
    '--',
    url,
  ];
}

/** Runs the downloads waiting in the queue, one row in `downloads` each. */
export class DownloadRunner {
  private readonly running = new Map<string, AbortController>();

  constructor(
    private readonly ctx: AppContext,
    private readonly events: JobEvents,
  ) {}

  /** Progress of the item loading right now – only in memory, not worth a database write. */
  private readonly current = new Map<string, number>();

  update(id: string, patch: Partial<DownloadRecord>): DownloadRecord | undefined {
    if (Object.keys(patch).length > 0) {
      this.ctx.db.update(downloads).set(patch).where(eq(downloads.id, id)).run();
    }
    const row = this.ctx.db.select().from(downloads).where(eq(downloads.id, id)).get();
    if (row) this.events.emit('download', row.userId, toDownloadDto(row, this.current.get(id)));
    return row;
  }

  abort(id: string): boolean {
    const controller = this.running.get(id);
    controller?.abort();
    return controller !== undefined;
  }

  /**
   * DeviantArt hands out a new token when gallery-dl logs in; two downloads
   * of the same account starting together could use up each other's token.
   * They take turns instead (also kinder to DeviantArt's request limit).
   */
  private takingTurns(row: DownloadRecord): boolean {
    if (row.platform !== 'deviantart') return false;
    const ids = [...this.running.keys()].filter((other) => other !== row.id);
    if (ids.length === 0) return false;
    return this.ctx.db
      .select({ id: downloads.id })
      .from(downloads)
      .where(
        and(
          inArray(downloads.id, ids),
          eq(downloads.userId, row.userId),
          eq(downloads.platform, 'deviantart'),
        ),
      )
      .all()
      .some(() => true);
  }

  async run(id: string): Promise<void> {
    const row = this.ctx.db.select().from(downloads).where(eq(downloads.id, id)).get();
    if (!row || row.status !== 'queued' || this.running.has(id)) return;
    if (this.takingTurns(row)) {
      await this.ctx.downloads.queue.enqueue(id, TURN_WAIT_MS).catch(() => undefined);
      return;
    }
    const controller = new AbortController();
    this.running.set(id, controller);
    const paths = dataPaths(this.ctx.config);
    const folder = path.join(paths.tmp, `download-${id}`);
    const options = row.options as DownloadOptions;
    const targets = this.chosenTargets(row.userId, options.targetIds ?? []);
    // Files of an earlier run that a restart interrupted stay in the list.
    const earlier = row.files as DownloadedFile[];
    this.update(id, { status: 'running', progress: 0, done: earlier.length });
    await mkdir(folder, { recursive: true });
    await mkdir(paths.uploads, { recursive: true });
    const cookies = await cookieFile(this.ctx, row.userId, row.platform, paths.tmp);
    // Pixiv's key or your own DeviantArt app: a private gallery-dl config for this run.
    const pixivConfig =
      row.platform === 'pixiv'
        ? await pixivConfigFile(this.ctx, row.userId, paths.tmp)
        : row.platform === 'deviantart'
          ? await deviantartConfigFile(this.ctx, row.userId, paths.tmp)
          : null;

    const files: DownloadedFile[] = [...earlier];
    let skipped = row.skipped;
    /** Items the download archive skipped (downloaded before). */
    let known = row.known;
    // Without the user's own archive, a private one per download remembers what
    // is done – after a restart the download goes on without loading it twice.
    const resumeArchive = options.archiveFile
      ? null
      : path.join(paths.tmp, `download-${id}.${row.tool === 'yt-dlp' ? 'txt' : 'sqlite3'}`);
    const runOptions = resumeArchive ? { ...options, archiveFile: resumeArchive } : options;
    let total: number | null = row.total;
    let progress = 0;
    let lastEmit = 0;
    const taken = new Set<string>();
    /** Pixiv works with several pages: file id → the work's folder. */
    const subfolders: Record<string, string> = {};
    /** One file at a time: take it over, save it to the chosen locations. */
    let chain: Promise<void> = Promise.resolve();

    const report = (force = false) => {
      const now = Date.now();
      if (!force && now - lastEmit < 500) return;
      lastEmit = now;
      const of = Math.max(total ?? options.limit, files.length, 1);
      const current = this.current.get(id) ?? 0;
      // Video and sound arrive one after the other (each 0–100 %): never go back.
      progress = Math.max(
        progress,
        Math.min(99, Math.round(((files.length + current / 100) / of) * 100)),
      );
      this.update(id, { done: files.length, total, progress, files: [...files], skipped, known });
    };

    const takeOne = (file: string, itemId?: string) => {
      const full = path.resolve(file);
      if (!full.startsWith(folder + path.sep) || taken.has(full)) return;
      if (inHiddenFolder(folder, full)) return;
      if (NOT_A_RESULT.test(path.basename(full))) return;
      taken.add(full);
      chain = chain.then(async () => {
        const info = await stat(full).catch(() => null);
        if (!info?.isFile()) return;
        if (info.size > this.ctx.config.maxUploadBytes) {
          skipped += 1;
          await rm(full, { force: true });
          return;
        }
        const fileId = randomUUID();
        // A Pixiv work with several pages came in its own folder: keep it.
        const sub = postFolderOf(folder, full);
        if (sub) subfolders[fileId] = sub;
        const target = path.join(paths.uploads, fileId);
        await rename(full, target);
        const saved = await recordFile(this.ctx, {
          id: fileId,
          userId: row.userId,
          filePath: target,
          name: path.basename(full),
          size: info.size,
        });
        const entry: DownloadedFile = {
          fileId,
          name: saved.originalName,
          ext: saved.ext,
          size: info.size,
          savedTo: [],
          saveError: null,
          onServer: true,
          thumbnail: false,
          alreadyThere: false,
        };
        entry.thumbnail = await makeThumbnail(
          this.ctx.config,
          fileId,
          target,
          saved.ext,
          itemId ? await this.coverOf(folder, itemId) : null,
        );
        // With a workflow, it saves (after its own steps).
        if (targets.length > 0 && !options.after) {
          const results = await exportFile(
            this.ctx,
            row.userId,
            { filePath: target, name: entry.name, ext: normalizeExt(entry.ext) },
            {
              targetIds: targets.map((t) => t.id),
              ...(getFormat(entry.ext) && { category: getFormat(entry.ext)?.category }),
            },
            {
              platform: row.platform,
              platformFolder: platformFolder(row.platform, row.url),
              source: options.sourceName ?? undefined,
              sameFileSkips: true,
              subfolder: sub ?? undefined,
            },
          ).catch(() => []);
          entry.savedTo = results
            .filter((r) => r.status === 'saved' || r.status === 'skipped')
            .map((r) => targets.find((t) => t.id === r.targetId)?.name ?? '');
          // Every location already had this very file: it was there before.
          entry.alreadyThere = results.length > 0 && results.every((r) => r.status === 'skipped');
          entry.saveError =
            results.find((r) => r.status === 'error')?.error?.messageKey ??
            (results.length === 0 ? API_ERROR_KEYS.STORAGE_FAILED : null);
          // Not for the list and safely saved: no need to keep it on the server.
          if (options.toList === false && entry.savedTo.length === targets.length) {
            await deleteFileRecord(this.ctx, saved);
            entry.onServer = false;
          }
        }
        // Announced only now: the browser may take the file into its list (and
        // free it on the server) – that must not happen before it is saved.
        files.push(entry);
        this.current.set(id, 0);
        report(true);
      });
    };

    try {
      const onStdout = (chunk: string) => {
        for (const raw of chunk.split('\n')) {
          const line = raw.trim();
          if (!line) continue;
          if (row.tool === 'yt-dlp') {
            const file = /^CONBERT_FILE\|([^|]*)\|(.+)$/.exec(line);
            if (file?.[2]) {
              takeOne(file[2], file[1]);
              continue;
            }
            if (/has already been recorded in the archive/.test(line)) {
              // Loaded before the restart (private archive): already in the list.
              if (!resumeArchive) known += 1;
              report();
              continue;
            }
            const m = /^CONBERT\|(\S+)\|(\S+)\|\s*([\d.]+)%/.exec(line);
            if (!m) continue;
            const count = Number(m[2]);
            if (Number.isFinite(count) && count > 0) total = Math.min(count, options.limit);
            // Picture and sound each count 0–100 %; the overall bar never goes back.
            this.current.set(id, Number(m[3]) || 0);
          } else if (line.startsWith('#') || options.recordOnly) {
            // gallery-dl: "# path" = skipped, it had been downloaded before.
            // With --no-download (only remembering) every line is such an item,
            // printed without the "#".
            if (!resumeArchive) known += 1;
          } else {
            // gallery-dl prints each finished file.
            takeOne(line);
          }
          report();
        }
      };
      const args =
        row.tool === 'yt-dlp'
          ? ytDlpArgs(row.url, row.kind === 'single', folder, runOptions, cookies.file)
          : galleryDlArgs(
              row.url,
              row.platform as Platform,
              folder,
              runOptions,
              cookies.file,
              pixivConfig?.file ?? null,
            );
      // Checked again right before: the name may point elsewhere by now.
      await ensurePublicLink(row.url);
      try {
        await runProcess(toolPath(this.ctx.config, row.tool), args, {
          timeoutMs: TIMEOUT_MS,
          signal: controller.signal,
          env: toolEnv(toolHome(this.ctx.config, row.userId)),
          onStdout,
        });
      } catch (error) {
        // Playlists: some items may fail (private, removed) – keep what worked.
        await chain;
        const left = await this.resultFiles(folder);
        // yt-dlp ends with 101 when it stopped at a known item on purpose.
        const stoppedAtKnown =
          options.stopAtKnown && error instanceof ProcessError && error.result.code === 101;
        if (
          !stoppedAtKnown &&
          (controller.signal.aborted || isAbortError(error) || files.length + left.length === 0)
        ) {
          throw error;
        }
      }
      // Anything the tool didn't announce (older versions) is taken over now.
      for (const file of await this.resultFiles(folder)) takeOne(file);
      await chain;
      this.current.delete(id);
      if (files.length === 0) {
        // A subscription check without anything new is the normal case – and so is
        // a download where everything was loaded before (the archive skipped it all).
        if (options.feed || options.archiveFile) {
          this.finish(id, 'done', { skipped, known, progress: 100, total: 0 });
        } else {
          this.finish(id, 'error', { errorKey: API_ERROR_KEYS.DOWNLOAD_NOTHING, skipped, known });
        }
        return;
      }
      const savedTo = targets
        .filter((t) => files.some((f) => f.savedTo.includes(t.name)))
        .map((t) => t.name);
      if (options.after) {
        await runAfter(
          this.ctx,
          row.userId,
          options.after,
          files.map((f) => f.fileId),
          {
            toList: options.toList ?? true,
            targetIds: options.targetIds ?? [],
            label: row.title ?? row.url,
            ...(options.sourceName && { source: options.sourceName }),
            platformFolder: platformFolder(row.platform, row.url),
            sameFileSkips: true,
            ...(Object.keys(subfolders).length > 0 && { subfolders }),
          },
        ).catch(() => undefined);
      }
      this.finish(id, 'done', {
        files,
        skipped,
        known,
        done: files.length,
        total: files.length,
        progress: 100,
        savedTo: savedTo.length > 0 ? savedTo.join(', ') : null,
      });
    } catch (error) {
      await chain.catch(() => undefined);
      this.current.delete(id);
      const partial = { files, skipped, known, done: files.length };
      if (controller.signal.aborted || isAbortError(error)) {
        this.finish(id, 'cancelled', partial);
        return;
      }
      const details =
        error instanceof ProcessError
          ? error.result.stderr.trim() || error.result.stdout.trim() || error.message
          : String(error);
      let code =
        error instanceof HttpError
          ? error.code
          : isMissingTool(error)
            ? 'DOWNLOAD_TOOL_MISSING'
            : classifyDownloadError(details);
      // Pixiv: without a (working) login the key has to be renewed in the settings.
      if (row.platform === 'pixiv' && code === 'DOWNLOAD_LOGIN_REQUIRED') {
        code = 'DOWNLOAD_PIXIV_LOGIN';
      }
      // DeviantArt: no login yet, or it ran out (refresh tokens last three months).
      if (row.platform === 'deviantart' && code === 'DOWNLOAD_LOGIN_REQUIRED') {
        code = 'DOWNLOAD_DEVIANTART_LOGIN';
      }
      this.finish(id, 'error', {
        ...partial,
        errorKey: API_ERROR_KEYS[code],
        errorDetails: details.slice(-2000),
      });
    } finally {
      this.running.delete(id);
      await cookies.remove();
      await pixivConfig?.remove();
      await rm(folder, { recursive: true, force: true });
      if (resumeArchive) await rm(resumeArchive, { force: true });
    }
  }

  private finish(id: string, status: DownloadRecord['status'], patch: Partial<DownloadRecord>) {
    const row = this.update(id, { ...patch, status, finishedAt: new Date() });
    if (row) this.logFinished(row);
    if (row?.feedId) feedDownloadFinished(this.ctx, row);
  }

  private logFinished(row: DownloadRecord): void {
    const options = row.options as DownloadOptions;
    const files = row.files as DownloadedFile[];
    const entry = {
      area: row.feedId ? 'feed' : 'download',
      download: row.id,
      user: userName(this.ctx, row.userId),
      platform: row.platform,
      tool: row.tool,
      title: row.title,
      url: row.url,
      files: files.length,
      skipped: row.skipped,
      known: row.known,
      ...(options.recordOnly && { recordOnly: true }),
      ...(row.finishedAt && {
        seconds: Math.round((row.finishedAt.getTime() - row.createdAt.getTime()) / 1000),
      }),
      ...(row.savedTo && { savedTo: row.savedTo }),
      saveErrors: files.filter((f) => f.saveError).length,
    };
    if (row.status === 'error') {
      this.ctx.log.warn(
        { ...entry, errorKey: row.errorKey, details: tail(row.errorDetails) },
        'download failed',
      );
    } else {
      this.ctx.log.info(
        entry,
        row.status === 'cancelled' ? 'download cancelled' : 'download finished',
      );
    }
    // "Detailed": every file with where it went.
    for (const file of files) {
      this.ctx.log.debug(
        {
          area: entry.area,
          download: row.id,
          name: file.name,
          bytes: file.size,
          savedTo: file.savedTo,
          ...(file.alreadyThere && { alreadyThere: true }),
          ...(file.saveError && { saveError: file.saveError }),
        },
        'downloaded file',
      );
    }
  }

  /** The cover yt-dlp wrote for an item, if any. */
  private async coverOf(folder: string, itemId: string): Promise<string | null> {
    const dir = path.join(folder, THUMBS);
    const names = await readdir(dir).catch(() => [] as string[]);
    const name = names.find((n) => n.startsWith(`${itemId}.`));
    return name ? path.join(dir, name) : null;
  }

  private async resultFiles(folder: string): Promise<string[]> {
    const names = await readdir(folder, { recursive: true }).catch(() => [] as string[]);
    const files: string[] = [];
    for (const name of names) {
      const full = path.join(folder, name);
      if (inHiddenFolder(folder, full)) continue;
      if (NOT_A_RESULT.test(path.basename(name))) continue;
      if ((await stat(full).catch(() => null))?.isFile()) files.push(full);
    }
    return files.sort();
  }

  /** The user's own locations among the chosen ones (others are ignored). */
  private chosenTargets(userId: string, ids: string[]): { id: string; name: string }[] {
    if (ids.length === 0) return [];
    return this.ctx.db
      .select({
        id: storageTargets.id,
        name: storageTargets.name,
        asTarget: storageTargets.asTarget,
      })
      .from(storageTargets)
      .where(eq(storageTargets.userId, userId))
      .all()
      .filter((t) => t.asTarget && ids.includes(t.id));
  }
}

/**
 * After a restart: downloads that were loading go on (their private archive
 * skips what is done), waiting ones are queued again. A job that is still in
 * the queue is not added twice.
 */
export async function resumeDownloads(ctx: AppContext): Promise<void> {
  const rows = ctx.db
    .select({ id: downloads.id, status: downloads.status })
    .from(downloads)
    .where(inArray(downloads.status, ['queued', 'running']))
    .all();
  for (const row of rows) {
    if (row.status === 'running') ctx.downloads.runner.update(row.id, { status: 'queued' });
    await ctx.downloads.queue.enqueue(row.id).catch(() => undefined);
  }
}
