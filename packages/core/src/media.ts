import { BOORU_SITES, RETIRED_SITES } from './booru/sites';
import { PLATFORM_FOLDERS, type Platform } from './downloader';

/**
 * The media on a storage location: which files the swipe game shows, where
 * favourites go, and how a file name leads back to what was downloaded.
 */

export const MEDIA_KINDS = ['image', 'gif', 'video', 'other'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

/** What a browser can show as a card. */
const KIND_BY_EXT: Record<string, MediaKind> = {
  jpg: 'image',
  jpeg: 'image',
  jfif: 'image',
  png: 'image',
  webp: 'image',
  avif: 'image',
  bmp: 'image',
  gif: 'gif',
  mp4: 'video',
  m4v: 'video',
  webm: 'video',
  mov: 'video',
};

export function mediaKind(name: string): MediaKind {
  const dot = name.lastIndexOf('.');
  return (dot > 0 && KIND_BY_EXT[name.slice(dot + 1).toLowerCase()]) || 'other';
}

/** Files that only describe another one (booru sidecars, tool notes). */
export function isSidecar(name: string): boolean {
  return /\.(txt|json|xmp|description|info|nfo|part|tmp|sqlite3)$/i.test(name);
}

export const FAVORITES_FOLDER = 'Favoriten';
export const PREMIUM_FOLDER = 'Premium';

const FAVORITES_PREFIX = `${FAVORITES_FOLDER}/`;
const PREMIUM_PREFIX = `${FAVORITES_FOLDER}/${PREMIUM_FOLDER}/`;

export function isFavoritePath(path: string): boolean {
  return path.startsWith(FAVORITES_PREFIX);
}

export function isPremiumPath(path: string): boolean {
  return path.startsWith(PREMIUM_PREFIX);
}

/** "Instagram/KawaiiQueen/a.jpg" – where a favourite came from. */
export function normalPath(path: string): string {
  if (isPremiumPath(path)) return path.slice(PREMIUM_PREFIX.length);
  if (isFavoritePath(path)) return path.slice(FAVORITES_PREFIX.length);
  return path;
}

/** "Favoriten/Instagram/KawaiiQueen/a.jpg" – the same structure inside the favourites. */
export function favoritePath(path: string): string {
  return FAVORITES_PREFIX + normalPath(path);
}

/** "Favoriten/Premium/Instagram/KawaiiQueen/a.jpg". */
export function premiumPath(path: string): string {
  return PREMIUM_PREFIX + normalPath(path);
}

export function parentFolder(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? '' : path.slice(0, slash);
}

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** The first `depth` folders of a file's normal path: "Gelbooru/ear_blowing". */
export function sourceFolder(path: string, depth: number): string {
  return parentFolder(normalPath(path)).split('/').filter(Boolean).slice(0, depth).join('/');
}

/** Platform ids by their folder name ("Instagram" → "instagram"). */
const PLATFORM_BY_FOLDER = new Map(
  Object.entries(PLATFORM_FOLDERS).map(([id, folder]) => [folder.toLowerCase(), id as Platform]),
);

const BOORU_BY_FOLDER = new Map(
  [...BOORU_SITES, ...RETIRED_SITES].flatMap((s) => [
    [s.name.toLowerCase(), s.id] as const,
    [s.id.toLowerCase(), s.id] as const,
  ]),
);

/** yt-dlp names its downloads "<title> [<id>].<ext>"; these platforms keep that id in the archive. */
const YT_DLP_ARCHIVE_KEYS: Partial<Record<Platform, string>> = {
  youtube: 'youtube',
  soundcloud: 'soundcloud',
  tiktok: 'tiktok',
  vimeo: 'vimeo',
};

export type KnownItem =
  /** A line for yt-dlp's download archive of this platform. */
  | { tool: 'yt-dlp'; platform: Platform; line: string }
  /** A booru post (booru archive). */
  | { tool: 'booru'; siteId: string; postId: number };

/** The top folder of a normal path, as a platform or booru site. */
export function folderPlatform(path: string): { platform?: Platform; booruSite?: string } {
  const top = normalPath(path).split('/')[0]?.toLowerCase() ?? '';
  const platform = PLATFORM_BY_FOLDER.get(top);
  if (platform) return { platform };
  const booruSite = BOORU_BY_FOLDER.get(top);
  return booruSite ? { booruSite } : {};
}

/**
 * Reads back which item a file was: yt-dlp's "[id]" in the name, or a booru
 * name "<site>_<id>…". Unknown names (gallery-dl's) give null – those files
 * are recognised by name and size instead.
 */
export function knownItemOf(path: string): KnownItem | null {
  const name = baseName(path);
  const where = folderPlatform(path);
  if (where.platform) {
    const key = YT_DLP_ARCHIVE_KEYS[where.platform];
    const id = /\[([A-Za-z0-9_-]{4,64})\]\.[a-z0-9]+$/i.exec(name)?.[1];
    if (key && id) return { tool: 'yt-dlp', platform: where.platform, line: `${key} ${id}` };
    return null;
  }
  if (where.booruSite) {
    const m = /^([a-z0-9.-]+)_(\d{1,12})(?:[_.]|$)/i.exec(name);
    const site = m ? (BOORU_BY_FOLDER.get((m[1] ?? '').toLowerCase()) ?? null) : null;
    if (m && site === where.booruSite) {
      return { tool: 'booru', siteId: site, postId: Number(m[2]) };
    }
  }
  return null;
}
