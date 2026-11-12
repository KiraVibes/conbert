import { z } from 'zod';
import { afterDownloadSchema } from './workflows';
import {
  COOKIE_PLATFORMS,
  DEFAULT_DOWNLOAD_LIMIT,
  FEED_INTERVALS_MINUTES,
  DEFAULT_SLEEP_SECONDS,
  DOWNLOAD_QUALITIES,
  MAX_DOWNLOAD_LIMIT,
  MAX_SLEEP_SECONDS,
  MAX_URL_LENGTH,
  MIN_SLEEP_SECONDS,
  PLATFORMS,
  PROFILE_PARTS,
  UGOIRA_FORMATS,
} from '@conbert/core';

export const platformSchema = z.enum(PLATFORMS);
export const cookiePlatformSchema = z.enum(COOKIE_PLATFORMS as [string, ...string[]]);
const urlSchema = z.string().trim().min(1).max(MAX_URL_LENGTH);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Pixiv only: animated pictures (Ugoira) and works for adults. */
export const pixivOptionsSchema = z.object({
  ugoira: z.enum(UGOIRA_FORMATS).default('mp4'),
  adult: z.boolean().default(false),
});

// --- POST /api/downloader/probe ---
export const probeDownloadRequestSchema = z.object({ url: urlSchema });

export const probeDownloadResponseSchema = z.object({
  probeId: z.string(),
  url: z.string(),
  platform: platformSchema,
  tool: z.enum(['yt-dlp', 'gallery-dl']),
  kind: z.enum(['single', 'playlist', 'profile']),
  title: z.string().nullable(),
  uploader: z.string().nullable(),
  /** Number of items, if the site says so (null = unknown, "many"). */
  count: z.number().nullable(),
  /** Duration in seconds (single videos). */
  duration: z.number().nullable(),
  /** Whether /api/downloader/probes/:id/thumbnail has a picture. */
  thumbnail: z.boolean(),
  /** The first few item titles (playlists, profiles). */
  entries: z.array(z.string()),
  /** The site needs a login for this – cookies would help. */
  needsLogin: z.boolean(),
  /** Cookies for this platform are stored. */
  hasCookies: z.boolean(),
});
export type ProbeDownloadResponse = z.infer<typeof probeDownloadResponseSchema>;

// --- POST /api/downloader/jobs ---
export const createDownloadRequestSchema = z
  .object({
    url: urlSchema,
    probeId: z.string().optional(),
    quality: z.enum(DOWNLOAD_QUALITIES).default('best'),
    /** Profile parts (Instagram); empty = the site's default (posts). */
    parts: z.array(z.enum(PROFILE_PARTS)).max(PROFILE_PARTS.length).default([]),
    pixiv: pixivOptionsSchema.optional(),
    limit: z.number().int().min(1).max(MAX_DOWNLOAD_LIMIT).default(DEFAULT_DOWNLOAD_LIMIT),
    dateAfter: isoDate.optional(),
    dateBefore: isoDate.optional(),
    sleepSeconds: z
      .number()
      .min(MIN_SLEEP_SECONDS)
      .max(MAX_SLEEP_SECONDS)
      .default(DEFAULT_SLEEP_SECONDS),
    /** Storage locations every file is saved to as soon as it is done. */
    targetIds: z.array(z.string().uuid()).max(10).default([]),
    /** Also into the conversion list (the browser loads the files). */
    toList: z.boolean().default(true),
    /** Kept in the server archive until the admin's keeping time is over. */
    keepOnServer: z.boolean().default(false),
    /** "Danach automatisch …": a saved workflow or a quick action. */
    after: afterDownloadSchema,
    /** Skip what was downloaded before (kept per user and platform). */
    skipKnown: z.boolean().default(true),
  })
  .refine((r) => r.toList || r.keepOnServer || r.targetIds.length > 0, {
    message: 'destination',
    path: ['targetIds'],
  });
export type CreateDownloadRequest = z.input<typeof createDownloadRequestSchema>;

export const downloadedFileSchema = z.object({
  fileId: z.string(),
  name: z.string(),
  ext: z.string(),
  size: z.number(),
  /** Names of the storage locations it was saved to. */
  savedTo: z.array(z.string()).default([]),
  /** Saving to a location failed (message key). */
  saveError: z.string().nullable().default(null),
  /** Still on the server (for the list); false once only saved elsewhere. */
  onServer: z.boolean().default(true),
  /** A preview picture exists: GET /api/downloader/thumbs/:fileId. */
  thumbnail: z.boolean().default(false),
  /** The storage locations had this very file already (same name and size). */
  alreadyThere: z.boolean().default(false),
});
export type DownloadedFile = z.infer<typeof downloadedFileSchema>;

export const downloadSchema = z.object({
  id: z.string(),
  url: z.string(),
  platform: platformSchema,
  title: z.string().nullable(),
  status: z.enum(['queued', 'running', 'done', 'error', 'cancelled']),
  /** Overall progress – only ever goes up. */
  progress: z.number().min(0).max(100),
  /** Progress of the item being loaded right now (0–100), while running. */
  current: z.number().min(0).max(100).nullable(),
  /** Files go into the conversion list. */
  toList: z.boolean(),
  /** Files stay in the server archive (the list must not free them). */
  keepOnServer: z.boolean().default(false),
  /** "3 of 12" while it runs. */
  done: z.number(),
  total: z.number().nullable(),
  files: z.array(downloadedFileSchema),
  /** Files that were too big and skipped. */
  skipped: z.number(),
  /** Items skipped because they had been downloaded before. */
  known: z.number().default(0),
  /** Name of the default storage location the files were saved to. */
  savedTo: z.string().nullable(),
  error: z.object({ messageKey: z.string(), details: z.string().optional() }).nullable(),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
  /** Started by a subscription check. */
  feedId: z.string().nullable().default(null),
  /** Finished without a file: everything had been downloaded before. */
  nothingNew: z.boolean().default(false),
  /** A subscription's first run with "only new": remembers what exists, loads nothing. */
  recordOnly: z.boolean().default(false),
});
export type DownloadDto = z.infer<typeof downloadSchema>;
export const downloadResponseSchema = z.object({ download: downloadSchema });
export const downloadsResponseSchema = z.object({ downloads: z.array(downloadSchema) });

// --- Cookies (one cookies.txt per platform, stored encrypted, never sent back) ---
export const cookieStatusSchema = z.object({
  platform: cookiePlatformSchema,
  updatedAt: z.string(),
});
export const cookiesResponseSchema = z.object({ cookies: z.array(cookieStatusSchema) });
export const saveCookiesRequestSchema = z.object({
  /** Content of a cookies.txt in Netscape format. */
  content: z
    .string()
    .min(1)
    .max(512 * 1024),
});

// --- Tools ---
export const downloaderToolsResponseSchema = z.object({
  ytDlp: z.string().nullable(),
  galleryDl: z.string().nullable(),
  /** Only admins may update. */
  canUpdate: z.boolean(),
});
export type DownloaderTools = z.infer<typeof downloaderToolsResponseSchema>;

// --- Downloader subscriptions ("Abos": profiles, channels, threads) ---
const feedOptions = {
  name: z.string().trim().max(80).default(''),
  intervalMinutes: z
    .number()
    .int()
    .refine((m) => (FEED_INTERVALS_MINUTES as readonly number[]).includes(m))
    .default(360),
  paused: z.boolean().default(false),
  quality: z.enum(DOWNLOAD_QUALITIES).default('best'),
  parts: z.array(z.enum(PROFILE_PARTS)).max(PROFILE_PARTS.length).default([]),
  /** Left out when editing: the stored choice stays. */
  pixiv: pixivOptionsSchema.optional(),
  /** Most new items per check. */
  limit: z.number().int().min(1).max(MAX_DOWNLOAD_LIMIT).default(DEFAULT_DOWNLOAD_LIMIT),
  sleepSeconds: z
    .number()
    .min(MIN_SLEEP_SECONDS)
    .max(MAX_SLEEP_SECONDS)
    .default(DEFAULT_SLEEP_SECONDS),
  targetIds: z.array(z.string().uuid()).max(10).default([]),
  toList: z.boolean().default(true),
  /** New files stay in the server archive. */
  keepOnServer: z.boolean().default(false),
  after: afterDownloadSchema,
  notify: z.boolean().default(true),
};

export const createFeedRequestSchema = z
  .object({
    url: urlSchema,
    probeId: z.string().optional(),
    /** Skip what is there already – only load what comes from now on. */
    onlyNew: z.boolean().default(true),
    ...feedOptions,
  })
  .refine((r) => r.toList || r.keepOnServer || r.targetIds.length > 0, {
    message: 'destination',
    path: ['targetIds'],
  });
export type CreateFeedRequest = z.input<typeof createFeedRequestSchema>;

export const updateFeedRequestSchema = z
  .object(feedOptions)
  .refine((r) => r.toList || r.keepOnServer || r.targetIds.length > 0, {
    message: 'destination',
    path: ['targetIds'],
  });
export type UpdateFeedRequest = z.input<typeof updateFeedRequestSchema>;

export const feedSchema = z.object({
  id: z.string(),
  url: z.string(),
  platform: platformSchema,
  kind: z.enum(['single', 'playlist', 'profile']),
  title: z.string().nullable(),
  name: z.string(),
  intervalMinutes: z.number(),
  paused: z.boolean(),
  /** The thread is gone (archived or deleted) – nothing more will come. */
  ended: z.boolean(),
  onlyNew: z.boolean(),
  quality: z.enum(DOWNLOAD_QUALITIES),
  parts: z.array(z.enum(PROFILE_PARTS)),
  pixiv: pixivOptionsSchema.nullable().default(null),
  limit: z.number(),
  sleepSeconds: z.number(),
  targetIds: z.array(z.string()),
  toList: z.boolean(),
  keepOnServer: z.boolean().default(false),
  after: afterDownloadSchema,
  notify: z.boolean(),
  /** A check is running right now. */
  checking: z.boolean(),
  /** A download from the same source is running – the check comes after it. */
  waiting: z.boolean().default(false),
  lastCheckAt: z.string().nullable(),
  nextCheckAt: z.string().nullable(),
  lastNew: z.number(),
  /** Last check that loaded something. */
  lastFoundAt: z.string().nullable().default(null),
  totalLoaded: z.number(),
  lastError: z.string().nullable(),
  createdAt: z.string(),
});
export type FeedDto = z.infer<typeof feedSchema>;
export const feedResponseSchema = z.object({ feed: feedSchema });
export const feedsResponseSchema = z.object({ feeds: z.array(feedSchema) });

// --- Pixiv login (a refresh token, stored encrypted, never sent back) ---
export const pixivLoginStatusSchema = z.object({
  connected: z.boolean(),
  /** The Pixiv account's display name, when known. */
  name: z.string().nullable(),
  updatedAt: z.string().nullable(),
});
export type PixivLoginStatus = z.infer<typeof pixivLoginStatusSchema>;
export const pixivLoginStartResponseSchema = z.object({
  /** Pixiv's own login page – the password is only ever typed in there. */
  url: z.string(),
});
export const pixivLoginCodeRequestSchema = z.object({
  /** The code, or the whole pixiv://…?code=… address it came in. */
  code: z.string().trim().min(1).max(4000),
});
export const pixivTokenRequestSchema = z.object({
  refreshToken: z.string().trim().min(1).max(500),
});

// --- DeviantArt: your own API app (+ login), stored encrypted, never sent back ---
export const deviantartStatusSchema = z.object({
  /** Your own app is set up (client ID + secret). */
  hasApp: z.boolean(),
  /** The app's client ID – no secret, shown so you know which app it is. */
  clientId: z.string().nullable(),
  /** Logged in (refresh token): mature and private works load too. */
  connected: z.boolean(),
  /** The DeviantArt user name, when known. */
  name: z.string().nullable(),
  updatedAt: z.string().nullable(),
});
export type DeviantartStatus = z.infer<typeof deviantartStatusSchema>;
export const deviantartAppRequestSchema = z.object({
  clientId: z.string().trim().min(1).max(20),
  clientSecret: z.string().trim().min(1).max(100),
});
export const deviantartLoginStartResponseSchema = z.object({
  /** DeviantArt's own login page – the password is only ever typed in there. */
  url: z.string(),
});
export const deviantartCodeRequestSchema = z.object({
  /** The address from the address bar (…?code=…&state=…) or just the code. */
  code: z.string().trim().min(1).max(4000),
});
