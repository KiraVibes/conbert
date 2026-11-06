import { mkdirSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import type { DownloadTool } from '@conbert/core';
import type { Config } from '../config';
import { ProcessError, runProcess } from '../lib/run-process';
import { HttpError, type ApiErrorCode } from '../lib/http-error';
import { hostCheck } from '../lib/public-net';

/** yt-dlp, gallery-dl and pip: from CONBERT_DOWNLOADER_BIN (Docker) or the PATH. */
export function toolPath(config: Config, name: DownloadTool | 'pip'): string {
  return config.downloaderBin ? path.join(config.downloaderBin, name) : name;
}

/**
 * The tools' own home folder per user, outside every job folder: gallery-dl
 * keeps its cache (cache.sqlite3 with sessions) and yt-dlp its cache there.
 * In the job folder they would end up among the downloads.
 */
export function toolHome(config: Config, userId: string): string {
  const home = path.join(config.dataDir, 'tool-home', userId);
  mkdirSync(home, { recursive: true });
  return home;
}

/**
 * A clean environment for the tools: nothing of Conbert's own (CONBERT_SECRET …)
 * and a private HOME, so no config files of other programs are read.
 */
export function toolEnv(home: string): NodeJS.ProcessEnv {
  return {
    PATH: process.env['PATH'] ?? '/usr/local/bin:/usr/bin:/bin',
    HOME: home,
    XDG_CACHE_HOME: path.join(home, '.cache'),
    XDG_CONFIG_HOME: path.join(home, '.config'),
    LANG: 'C.UTF-8',
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
  };
}

/**
 * Before a tool gets a link: the name must not lead into the home network
 * (a public-looking name can point to the router or the NAS). IP addresses
 * were checked when the link was entered (parseDownloadUrl).
 */
export async function ensurePublicLink(link: string | URL): Promise<void> {
  const host = new URL(link).hostname;
  if (net.isIP(host.replace(/^\[|\]$/g, '')) !== 0) return;
  const result = await hostCheck(host);
  if (result === 'private') throw new HttpError(422, 'DOWNLOAD_PRIVATE_ADDRESS', host);
  if (result === 'unknown') throw new HttpError(422, 'DOWNLOAD_HOST_UNKNOWN', host);
}

export async function toolVersion(config: Config, tool: DownloadTool): Promise<string | null> {
  try {
    const result = await runProcess(toolPath(config, tool), ['--version'], {
      timeoutMs: 15_000,
      env: toolEnv(config.dataDir),
    });
    return result.stdout.trim().split('\n')[0] ?? null;
  } catch {
    return null;
  }
}

/** Updates both tools (admin, button in the settings). Platforms change often. */
export async function updateTools(config: Config): Promise<void> {
  await runProcess(
    toolPath(config, 'pip'),
    [
      'install',
      '--no-cache-dir',
      '--disable-pip-version-check',
      '--upgrade',
      'yt-dlp[default]',
      'gallery-dl',
    ],
    { timeoutMs: 5 * 60_000, env: toolEnv(config.dataDir) },
  );
}

/** What went wrong, from the tools' messages – for an explanation people understand. */
export function classifyDownloadError(output: string): ApiErrorCode {
  const s = output.toLowerCase();
  if (/unsupported url|no suitable extractor|unsupported site/.test(s))
    return 'DOWNLOAD_UNSUPPORTED';
  // The site blocks this server's internet connection (IP) – no login helps.
  // e.g. Reddit: "Your IP address is unable to access the Reddit API".
  if (
    /ip address is unable|blocked by network security|your ip (has been|is) blocked|ip.{0,20}banned/.test(
      s,
    )
  ) {
    return 'DOWNLOAD_BLOCKED';
  }
  if (
    /log ?in|sign in|cookies|authentication|age.?restrict|confirm your age|private (video|account|profile)|requires? (a )?login|401|members only|not logged in/.test(
      s,
    )
  ) {
    return 'DOWNLOAD_LOGIN_REQUIRED';
  }
  if (/429|too many requests|rate.?limit|try again later|temporarily blocked/.test(s)) {
    return 'DOWNLOAD_RATE_LIMITED';
  }
  if (
    /404|not found|could not be found|unavailable|removed|deleted|does not exist|no video|no media/.test(
      s,
    )
  ) {
    return 'DOWNLOAD_NOT_FOUND';
  }
  return 'DOWNLOAD_FAILED';
}

/** The tool is missing (only outside Docker) or broken. */
export function isMissingTool(error: unknown): boolean {
  return error instanceof ProcessError && error.reason === 'spawn';
}
