import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
  detectPlatform,
  instagramAccount,
  parseDownloadUrl,
  pixivLink,
  toolsFor,
  type DownloadKind,
  type DownloadTool,
  type Platform,
} from '@conbert/core';
import { dataPaths } from '../config';
import type { AppContext } from '../context';
import { HttpError, type ApiErrorCode } from '../lib/http-error';
import { ProcessError, runProcess } from '../lib/run-process';
import { cookieFile } from './cookies';
import { deviantartConfigFile } from './deviantart';
import { pixivConfigFile } from './pixiv';
import {
  classifyDownloadError,
  ensurePublicLink,
  isMissingTool,
  toolEnv,
  toolHome,
  toolPath,
} from './tools';

export interface ProbeInfo {
  tool: DownloadTool;
  kind: DownloadKind;
  title: string | null;
  uploader: string | null;
  count: number | null;
  duration: number | null;
  thumbnailUrl: string | null;
  entries: string[];
  /** gallery-dl: links it would follow (a profile points to its posts). */
  queue?: string[];
}

const PREVIEW_ENTRIES = 20;
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
/** Pixiv: the artist is an object ({ id, name, account }). */
const userName = (v: unknown): string | null =>
  typeof v === 'object' && v !== null ? str((v as Record<string, unknown>)['name']) : null;

/** yt-dlp -J --flat-playlist output → what the preview shows. */
export function parseYtDlpProbe(json: string): ProbeInfo {
  const info = JSON.parse(json) as Record<string, unknown>;
  const entries = Array.isArray(info['entries'])
    ? (info['entries'] as Record<string, unknown>[])
    : [];
  const playlist = info['_type'] === 'playlist';
  const extractor = String(info['extractor_key'] ?? info['extractor'] ?? '');
  const thumbs = Array.isArray(info['thumbnails'])
    ? (info['thumbnails'] as Record<string, unknown>[])
    : [];
  return {
    tool: 'yt-dlp',
    kind: !playlist
      ? 'single'
      : /tab|user|channel|profile/i.test(extractor)
        ? 'profile'
        : 'playlist',
    title: str(info['title']),
    uploader: str(info['uploader']) ?? str(info['channel']) ?? str(info['uploader_id']),
    count: playlist ? (num(info['playlist_count']) ?? (entries.length || null)) : 1,
    duration: playlist ? null : num(info['duration']),
    thumbnailUrl:
      str(info['thumbnail']) ??
      str(thumbs.at(-1)?.['url']) ??
      str((entries[0]?.['thumbnails'] as Record<string, unknown>[] | undefined)?.at(-1)?.['url']),
    entries: entries
      .slice(0, PREVIEW_ENTRIES)
      .map((e) => str(e['title']) ?? str(e['id']) ?? '')
      .filter(Boolean),
  };
}

/** gallery-dl -j output (a list of messages: [3, url, meta] = one file). */
export function parseGalleryDlProbe(json: string, url: URL, platform: Platform): ProbeInfo {
  const messages = JSON.parse(json) as unknown[];
  const files: { url: string; meta: Record<string, unknown> }[] = [];
  const queue: string[] = [];
  const errors: string[] = [];
  let meta: Record<string, unknown> = {};
  for (const message of messages) {
    if (!Array.isArray(message)) continue;
    if (message[0] === 2 && typeof message[1] === 'object')
      meta = message[1] as Record<string, unknown>;
    if (message[0] === 3 && typeof message[1] === 'string') {
      files.push({ url: message[1], meta: (message[2] ?? {}) as Record<string, unknown> });
    }
    // 6 = "look there" (a profile points to its /posts/ …), -1 = an error.
    if (message[0] === 6 && typeof message[1] === 'string') queue.push(message[1]);
    if (message[0] === -1 && typeof message[1] === 'object' && message[1] !== null) {
      const e = message[1] as Record<string, unknown>;
      errors.push(`${String(e['error'] ?? '')}: ${String(e['message'] ?? '')}`);
    }
  }
  if (files.length === 0 && queue.length > 0) {
    return {
      tool: 'gallery-dl',
      kind: 'profile',
      title: null,
      // Pixiv links say "users/<number>" – the name comes with the first work.
      uploader:
        platform === 'pixiv'
          ? null
          : ((platform === 'instagram' ? instagramAccount(url.href) : null) ??
            url.pathname.split('/').filter(Boolean)[0] ??
            null),
      count: null,
      duration: null,
      thumbnailUrl: null,
      entries: [],
      queue,
    };
  }
  if (files.length === 0) {
    const details = errors.join('\n');
    // e.g. Instagram: "HTTP redirect to login page" – cookies needed.
    throw new HttpError(
      422,
      details ? classifyDownloadError(details) : 'DOWNLOAD_NOTHING',
      details || undefined,
    );
  }
  const first = files[0]?.meta ?? meta;
  const owner =
    str(first['username']) ??
    str(first['author']) ??
    str(first['owner']) ??
    str(first['user']) ??
    userName(first['user']);
  // instagram.com/<name>/ (one path part) is a profile; /p/<id> a single post.
  const parts = url.pathname.split('/').filter(Boolean);
  const profile = platform === 'instagram' ? parts.length === 1 || parts[1] === 'reels' : false;
  const account = profile ? instagramAccount(url.href) : null;
  const image = files.find((f) => /\.(jpe?g|png|webp|gif)(\?|$)/i.test(f.url));
  // Pixiv: one artwork can have many pages and still be one work.
  const pixiv = platform === 'pixiv' ? pixivLink(url.href) : null;
  const kind = pixiv?.kind ?? (profile ? 'profile' : files.length > 1 ? 'playlist' : 'single');
  return {
    tool: 'gallery-dl',
    kind,
    title:
      (pixiv?.tag ? `#${pixiv.tag}` : null) ??
      (pixiv?.kind === 'profile' ? owner : null) ??
      account ??
      str(first['title']) ??
      str(first['description'])?.slice(0, 120) ??
      str(first['content'])?.slice(0, 120) ??
      owner,
    uploader: account ?? owner,
    // gallery-dl only looked at the first few; more may exist.
    count: files.length < PREVIEW_ENTRIES ? files.length : null,
    duration: null,
    thumbnailUrl: str(first['display_url']) ?? str(first['thumbnail']) ?? image?.url ?? null,
    entries: files
      .slice(0, PREVIEW_ENTRIES)
      .map(
        (f) =>
          str(f.meta['filename']) ??
          str(f.meta['description'])?.slice(0, 80) ??
          f.url.split('/').pop() ??
          '',
      )
      .filter(Boolean),
  };
}

/** Looks at a link without downloading: title, picture, how many items. */
export async function probeUrl(
  ctx: AppContext,
  userId: string,
  url: URL,
): Promise<ProbeInfo & { platform: Platform }> {
  const platform = detectPlatform(url);
  await ensurePublicLink(url);
  const folder = path.join(dataPaths(ctx.config).tmp, 'downloader');
  await mkdir(folder, { recursive: true });
  const cookies = await cookieFile(ctx, userId, platform, folder);
  // Pixiv's API answers nothing without a login.
  const pixivConfig = platform === 'pixiv' ? await pixivConfigFile(ctx, userId, folder) : null;
  if (pixivConfig && !pixivConfig.file) throw new HttpError(422, 'DOWNLOAD_PIXIV_LOGIN');
  // Your own DeviantArt app (and login), if set up – otherwise gallery-dl's shared one.
  const deviantartConfig =
    platform === 'deviantart' ? await deviantartConfigFile(ctx, userId, folder) : null;
  let lastCode: ApiErrorCode = 'DOWNLOAD_UNSUPPORTED';
  let lastDetails = '';
  try {
    for (const tool of toolsFor(platform)) {
      const args =
        tool === 'yt-dlp'
          ? [
              '--ignore-config',
              '--no-warnings',
              '--js-runtimes',
              'node',
              '-J',
              '--flat-playlist',
              '--playlist-end',
              String(PREVIEW_ENTRIES),
              ...(cookies.file ? ['--cookies', cookies.file] : []),
              '--',
              url.href,
            ]
          : [
              '--config-ignore',
              ...(pixivConfig?.file ? ['-c', pixivConfig.file] : []),
              ...(deviantartConfig?.file ? ['-c', deviantartConfig.file] : []),
              '-j',
              '--range',
              `1-${PREVIEW_ENTRIES}`,
              ...(cookies.file ? ['--cookies', cookies.file] : []),
              '--',
              url.href,
            ];
      try {
        const result = await runProcess(toolPath(ctx.config, tool), args, {
          timeoutMs: 60_000,
          // yt-dlp describes a single video in a few hundred KB (all its formats).
          maxStdoutBytes: 32 * 1024 * 1024,
          env: toolEnv(toolHome(ctx.config, userId)),
        });
        let info =
          tool === 'yt-dlp'
            ? parseYtDlpProbe(result.stdout)
            : parseGalleryDlProbe(result.stdout, url, platform);
        // A profile only points to its parts: look one step further for the preview.
        const next = info.queue?.[0] ? parseDownloadUrl(info.queue[0]) : null;
        if (next && info.thumbnailUrl === null) {
          await ensurePublicLink(next);
          const deeper = await runProcess(
            toolPath(ctx.config, tool),
            args.slice(0, -1).concat(next.href),
            {
              timeoutMs: 60_000,
              maxStdoutBytes: 32 * 1024 * 1024,
              env: toolEnv(toolHome(ctx.config, userId)),
            },
          );
          const inner = parseGalleryDlProbe(deeper.stdout, next, platform);
          // The profile's name comes from the link: the newest post may be a
          // joint post that belongs to someone else.
          info = {
            ...info,
            title:
              info.uploader ??
              (platform === 'pixiv' ? inner.uploader : null) ??
              inner.title ??
              info.title,
            uploader: info.uploader ?? inner.uploader,
            thumbnailUrl: inner.thumbnailUrl,
            entries: inner.entries,
          };
        }
        return { ...info, kind: info.queue ? 'profile' : info.kind, platform };
      } catch (error) {
        if (isMissingTool(error)) {
          lastCode = 'DOWNLOAD_TOOL_MISSING';
          continue;
        }
        if (error instanceof HttpError) {
          // A clear answer (login needed, gone …) counts right away.
          if (
            !['DOWNLOAD_UNSUPPORTED', 'DOWNLOAD_FAILED', 'DOWNLOAD_NOTHING'].includes(error.code)
          ) {
            throw error;
          }
          lastCode = error.code;
          lastDetails = error.details ?? lastDetails;
          continue;
        }
        const details =
          error instanceof ProcessError
            ? error.result.stderr.trim() || error.result.stdout.trim() || error.message
            : String(error);
        const code =
          error instanceof SyntaxError ? 'DOWNLOAD_FAILED' : classifyDownloadError(details);
        // A clear answer (login needed, gone, too many requests) from the first tool counts.
        if (code !== 'DOWNLOAD_UNSUPPORTED' && code !== 'DOWNLOAD_FAILED') {
          throw new HttpError(422, code, details.slice(-1500));
        }
        lastCode =
          code === 'DOWNLOAD_FAILED' && lastCode === 'DOWNLOAD_UNSUPPORTED' ? lastCode : code;
        lastDetails = details.slice(-1500);
      }
    }
    throw new HttpError(422, lastCode, lastDetails || undefined);
  } catch (error) {
    // Instagram without a login hides almost everything – it even claims a
    // profile "could not be found". Without stored cookies, say what helps.
    if (
      platform === 'instagram' &&
      !cookies.file &&
      error instanceof HttpError &&
      error.code !== 'DOWNLOAD_TOOL_MISSING'
    ) {
      throw new HttpError(422, 'DOWNLOAD_LOGIN_REQUIRED', error.details);
    }
    // Pixiv refused the stored key (revoked, or the password was changed).
    if (
      platform === 'pixiv' &&
      error instanceof HttpError &&
      error.code === 'DOWNLOAD_LOGIN_REQUIRED'
    ) {
      throw new HttpError(422, 'DOWNLOAD_PIXIV_LOGIN', error.details);
    }
    if (
      platform === 'deviantart' &&
      error instanceof HttpError &&
      error.code === 'DOWNLOAD_LOGIN_REQUIRED'
    ) {
      throw new HttpError(422, 'DOWNLOAD_DEVIANTART_LOGIN', error.details);
    }
    throw error;
  } finally {
    await cookies.remove();
    await pixivConfig?.remove();
    await deviantartConfig?.remove();
  }
}
