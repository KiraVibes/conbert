/**
 * Social-media downloader: which platform a link belongs to, which tool
 * handles it and what can be chosen. Runs only on the server (CORS, logins,
 * native tools); this module only holds the shared rules.
 */

export const PLATFORMS = [
  'youtube',
  'tiktok',
  'instagram',
  'x',
  'reddit',
  'vimeo',
  'facebook',
  'twitch',
  'soundcloud',
  'pinterest',
  'tumblr',
  '4chan',
  'pixiv',
  'deviantart',
  'other',
] as const;
export type Platform = (typeof PLATFORMS)[number];

/**
 * Platforms whose login cookies can be stored (4chan needs none, "other" is
 * unknown, Pixiv logs in with its own key instead, see the Pixiv part below).
 * DeviantArt: gallery-dl loads galleries and favourites through DeviantArt's
 * API, where cookies change nothing (adult works need an API login there).
 */
export const COOKIE_PLATFORMS = PLATFORMS.filter(
  (p) => p !== 'other' && p !== '4chan' && p !== 'pixiv' && p !== 'deviantart',
);

const HOSTS: [Platform, RegExp][] = [
  ['youtube', /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/],
  ['tiktok', /(^|\.)tiktok\.com$/],
  ['instagram', /(^|\.)instagram\.com$/],
  ['x', /(^|\.)(x\.com|twitter\.com)$/],
  ['reddit', /(^|\.)(reddit\.com|redd\.it)$/],
  ['vimeo', /(^|\.)vimeo\.com$/],
  ['facebook', /(^|\.)(facebook\.com|fb\.watch)$/],
  ['twitch', /(^|\.)twitch\.tv$/],
  ['soundcloud', /(^|\.)soundcloud\.com$/],
  ['pinterest', /(^|\.)pinterest\.[a-z.]+$|(^|\.)pin\.it$/],
  ['tumblr', /(^|\.)tumblr\.com$/],
  // Threads with all their pictures and videos (boards.4chan.org/<board>/thread/<id>).
  ['4chan', /(^|\.)(4chan\.org|4channel\.org|4cdn\.org)$/],
  // Artworks, artist profiles, tag searches and bookmarks (pixiv.me = short profile link).
  ['pixiv', /(^|\.)(pixiv\.net|pixiv\.me)$/],
  // Deviations, galleries, favourites (fav.me / sta.sh = DeviantArt's short links).
  ['deviantart', /(^|\.)(deviantart\.com|fav\.me|sta\.sh)$/],
];

export const MAX_URL_LENGTH = 2000;

/**
 * Only normal web links (http/https) to public hosts. Links to this machine
 * or the home network are refused, so the downloader can't be used to reach
 * devices behind the firewall.
 */
export function parseDownloadUrl(input: string): URL | null {
  const text = input.trim();
  if (text.length === 0 || text.length > MAX_URL_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password) return null;
  if (isPrivateHost(url.hostname)) return null;
  return url;
}

/**
 * Names and addresses that lead to this machine or the home network. Also
 * used for the addresses a name resolves to (DNS check on the server).
 */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (!host.includes('.') && !host.includes(':')) return true; // "nas", "router"
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const [a, b, c] = [Number(v4[1]), Number(v4[2]), Number(v4[3])];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224 // multicast, reserved, broadcast
    );
  }
  if (host.includes(':')) {
    // IPv4 inside IPv6 (::ffff:127.0.0.1, or as the URL parser writes it: ::ffff:7f00:1).
    const mapped =
      /^(?:::ffff:|::|64:ff9b::)(?:(\d{1,3}(?:\.\d{1,3}){3})|([\da-f]{1,4}):([\da-f]{1,4}))$/.exec(
        host,
      );
    if (mapped) {
      if (mapped[1]) return isPrivateHost(mapped[1]);
      const hi = parseInt(mapped[2] ?? '0', 16);
      const lo = parseInt(mapped[3] ?? '0', 16);
      return isPrivateHost(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    return host === '::1' || host === '::' || /^(fc|fd|fe[89ab]|ff)/.test(host);
  }
  return false;
}

export function detectPlatform(url: URL): Platform {
  const host = url.hostname.toLowerCase();
  return HOSTS.find(([, pattern]) => pattern.test(host))?.[0] ?? 'other';
}

export type DownloadTool = 'yt-dlp' | 'gallery-dl';

/** Pictures, galleries and profiles: gallery-dl is the better first try there. */
const GALLERY_FIRST: readonly Platform[] = ['instagram', 'pinterest', 'tumblr', '4chan'];

/** The tools to try for a platform, best first. */
export function toolsFor(platform: Platform): DownloadTool[] {
  // yt-dlp doesn't know Pixiv or DeviantArt at all.
  if (platform === 'pixiv' || platform === 'deviantart') return ['gallery-dl'];
  return GALLERY_FIRST.includes(platform) ? ['gallery-dl', 'yt-dlp'] : ['yt-dlp', 'gallery-dl'];
}

/** What a link points to. */
export type DownloadKind = 'single' | 'playlist' | 'profile';

/** Parts of a profile that can be chosen (Instagram and similar). */
export const PROFILE_PARTS = ['posts', 'reels', 'stories', 'highlights'] as const;
export type ProfilePart = (typeof PROFILE_PARTS)[number];

/** Which platforms offer these parts. */
export function profilePartsFor(platform: Platform): readonly ProfilePart[] {
  return platform === 'instagram' ? PROFILE_PARTS : [];
}

export const DOWNLOAD_QUALITIES = ['best', '1080', '720', '480', 'audio'] as const;
export type DownloadQuality = (typeof DOWNLOAD_QUALITIES)[number];

/** Up to this many items without a hint; more needs a deliberate choice. */
export const DEFAULT_DOWNLOAD_LIMIT = 50;
export const MAX_DOWNLOAD_LIMIT = 1000;

/** Pause between requests (seconds): protects your accounts from being blocked. */
export const DEFAULT_SLEEP_SECONDS = 2;
export const MIN_SLEEP_SECONDS = 1;
export const MAX_SLEEP_SECONDS = 60;

/** "2026-10-27" → "20261027" (yt-dlp --dateafter/--datebefore). */
export function compactDate(isoDate: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  return m ? `${m[1]}${m[2]}${m[3]}` : null;
}

/**
 * Downloader subscriptions ("Abos"): a profile, channel or thread is checked
 * regularly and only what's new is loaded (the tools' download archive
 * remembers what was there already).
 */
export const FEED_INTERVALS_MINUTES = [10, 30, 60, 180, 360, 720, 1440] as const;
export type FeedInterval = (typeof FEED_INTERVALS_MINUTES)[number];

/** Threads change fast; profiles and channels slowly (and accounts can get blocked). */
export function defaultFeedInterval(platform: Platform): FeedInterval {
  return platform === '4chan' ? 10 : 360;
}

/**
 * Instagram and Pixiv block accounts that look too often, DeviantArt's API is
 * shared by every gallery-dl user and often busy – at most once an hour.
 */
export function minFeedInterval(platform: Platform): FeedInterval {
  return platform === 'instagram' || platform === 'pixiv' || platform === 'deviantart' ? 60 : 10;
}

/** A link can be subscribed when there is more to come: profiles, channels, playlists, threads. */
export function canSubscribe(platform: Platform, kind: DownloadKind): boolean {
  return kind !== 'single' || platform === '4chan';
}

/** Threads come oldest first – there the tools must not stop at the first known item. */
export function feedNewestFirst(platform: Platform): boolean {
  return platform !== '4chan';
}

/**
 * The name of the folder a download goes into: the channel or profile, the
 * thread's title, or the playlist's name.
 */
/** Paths on instagram.com that are no account name. */
const INSTAGRAM_PATHS = new Set([
  'p',
  'reel',
  'reels',
  'tv',
  'explore',
  'accounts',
  'direct',
  'stories',
]);

/**
 * The account a link on instagram.com belongs to ("instagram.com/vinne.art/" →
 * "vinne.art", also for its reels and stories) – null for single posts.
 * The account in the link counts, not the owner of the newest post (a joint
 * post can belong to someone else).
 */
export function instagramAccount(url: string): string | null {
  let parts: string[];
  try {
    parts = new URL(url).pathname.split('/').filter(Boolean);
  } catch {
    return null;
  }
  const [first, second] = parts;
  if (first === 'stories' && second && second !== 'highlights') return second;
  if (!first || INSTAGRAM_PATHS.has(first)) return null;
  return /^[A-Za-z0-9._]{1,30}$/.test(first) ? first : null;
}

export function downloadSourceName(info: {
  platform: Platform;
  kind: DownloadKind;
  title: string | null;
  uploader: string | null;
  url: string;
}): string | null {
  const clean = (s: string | null) => {
    const t = s?.replace(/\s+/g, ' ').trim();
    return t ? t.slice(0, 80) : null;
  };
  if (info.platform === 'instagram') {
    const account = instagramAccount(info.url);
    if (account) return account;
  }
  if (info.platform === 'pixiv') {
    const tag = pixivLink(info.url)?.tag;
    if (tag) return clean(`Tag ${tag}`);
  }
  if (info.platform === '4chan') {
    const thread = /\/thread\/(\d+)/.exec(info.url)?.[1];
    return clean(info.title) ?? (thread ? `Thread ${thread}` : null);
  }
  // A playlist is named after itself, everything else after its channel or account.
  if (info.kind === 'playlist') return clean(info.title) ?? clean(info.uploader);
  // A single video without a known channel gets no folder of its own.
  if (info.kind === 'single') return clean(info.uploader);
  return clean(info.uploader) ?? clean(info.title);
}

// --- Pixiv ---

/**
 * Ugoira are Pixiv's animated pictures: single frames plus their timing.
 * They are turned into a normal video or GIF (ffmpeg) – or kept as frames (zip).
 */
export const UGOIRA_FORMATS = ['mp4', 'gif', 'webm', 'zip'] as const;
export type UgoiraFormat = (typeof UGOIRA_FORMATS)[number];

export interface PixivOptions {
  ugoira: UgoiraFormat;
  /** Also works marked R-18/R-18G (the Pixiv account must allow them, too). */
  adult: boolean;
}
export const DEFAULT_PIXIV_OPTIONS: PixivOptions = { ugoira: 'mp4', adult: false };

export interface PixivLink {
  kind: DownloadKind;
  /** The searched tag (pixiv.net/tags/<tag>). */
  tag: string | null;
}

/** What a pixiv.net link points to – null for pages gallery-dl doesn't load. */
export function pixivLink(url: string): PixivLink | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const parts = u.pathname.split('/').filter(Boolean);
  if (u.hostname.toLowerCase().endsWith('pixiv.me')) {
    return parts.length === 1 ? { kind: 'profile', tag: null } : null;
  }
  // Language prefix: pixiv.net/en/artworks/123
  if (parts[0] && /^[a-z]{2}(-[a-z]{2,4})?$/i.test(parts[0])) parts.shift();
  const [first, second, third] = parts;
  if (first === 'artworks' && second && /^\d+$/.test(second)) return { kind: 'single', tag: null };
  if (first === 'member_illust.php' && u.searchParams.has('illust_id')) {
    return { kind: 'single', tag: null };
  }
  if (first === 'users' && second && /^\d+$/.test(second)) {
    if (third === 'bookmarks') return { kind: 'playlist', tag: null };
    if (!third || ['artworks', 'illustrations', 'manga'].includes(third)) {
      return { kind: 'profile', tag: null };
    }
    return null;
  }
  if (first === 'tags' && second) {
    let tag = second;
    try {
      tag = decodeURIComponent(second);
    } catch {
      // keep it as it is
    }
    return { kind: 'playlist', tag: tag.trim().slice(0, 80) || null };
  }
  if (first === 'bookmark_new_illust.php' || first === 'ranking.php') {
    return { kind: 'playlist', tag: null };
  }
  return null;
}

/** The top folder per platform on a storage location: Instagram/<account>, YouTube/<channel> … */
export const PLATFORM_FOLDERS: Record<Platform, string> = {
  youtube: 'YouTube',
  tiktok: 'TikTok',
  instagram: 'Instagram',
  x: 'X',
  reddit: 'Reddit',
  vimeo: 'Vimeo',
  facebook: 'Facebook',
  twitch: 'Twitch',
  soundcloud: 'SoundCloud',
  pinterest: 'Pinterest',
  tumblr: 'Tumblr',
  '4chan': '4chan',
  pixiv: 'Pixiv',
  deviantart: 'DeviantArt',
  other: 'Web',
};

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return '';
  }
}

/** The board of a 4chan link: boards.4chan.org/<board>/thread/<id> → "<board>". */
export function fourChanBoard(url: string): string | null {
  return /^\/([a-z0-9]{1,10})\/thread\//i.exec(pathOf(url))?.[1] ?? null;
}

/** Where a platform's downloads go: "Instagram", or "4chan/<board>" for threads. */
export function platformFolder(platform: string, url: string): string {
  const top = (PLATFORMS as readonly string[]).includes(platform)
    ? PLATFORM_FOLDERS[platform as Platform]
    : PLATFORM_FOLDERS.other;
  const board = platform === '4chan' ? fourChanBoard(url) : null;
  return board ? `${top}/${board}` : top;
}

/** All i18n keys the downloader needs – checked by a test. */
export function downloaderI18nKeys(): string[] {
  return [
    ...PLATFORMS.map((p) => `downloader.platforms.${p}`),
    ...PROFILE_PARTS.map((p) => `downloader.parts.${p}`),
    ...DOWNLOAD_QUALITIES.flatMap((q) => [
      `downloader.quality.${q}`,
      `downloader.quality.${q}Help`,
    ]),
    'downloader.kind.single',
    'downloader.kind.playlist',
    'downloader.kind.profile',
    ...UGOIRA_FORMATS.map((f) => `downloader.pixiv.ugoira.${f}`),
    ...FEED_INTERVALS_MINUTES.map((m) => `feeds.intervals.${m}`),
  ];
}
