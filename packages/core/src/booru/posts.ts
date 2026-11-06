import type { BooruApi } from './sites';

/**
 * Ratings, unified across sites. Danbooru and Gelbooru rate in four steps,
 * e621 and Moebooru in three ("safe" counts as general here).
 */
export const BOORU_RATINGS = ['general', 'sensitive', 'questionable', 'explicit'] as const;
export type BooruRating = (typeof BOORU_RATINGS)[number];

/** Only general (all-ages) content until the user unlocks more in the settings. */
export const DEFAULT_RATINGS: readonly BooruRating[] = ['general'];

export function normalizeRating(raw: unknown, api: BooruApi): BooruRating | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim().toLowerCase();
  switch (value) {
    case 'general':
    case 'safe':
    case 'g':
      return 'general';
    case 'sensitive':
      return 'sensitive';
    // Danbooru: s = sensitive; e621 and Moebooru: s = safe.
    case 's':
      return api === 'danbooru' ? 'sensitive' : 'general';
    case 'questionable':
    case 'q':
      return 'questionable';
    case 'explicit':
    case 'e':
      return 'explicit';
    default:
      return null;
  }
}

export const TAG_CATEGORIES = [
  'general',
  'artist',
  'copyright',
  'character',
  'species',
  'meta',
] as const;
export type TagCategory = (typeof TAG_CATEGORIES)[number];

/** One post, the same shape for every site. */
export interface BooruPost {
  id: number;
  md5: string | null;
  /** null = the site didn't say (treated like explicit). */
  rating: BooruRating | null;
  /** All tags, normalised (lowercase, underscores). */
  tags: string[];
  artists: string[];
  characters: string[];
  copyrights: string[];
  score: number | null;
  favorites: number | null;
  width: number | null;
  height: number | null;
  /** File extension without dot, lowercase. */
  ext: string | null;
  size: number | null;
  /** ISO date. */
  createdAt: string | null;
  fileUrl: string | null;
  sampleUrl: string | null;
  previewUrl: string | null;
  /** Where the artist published it. */
  source: string | null;
  /** The post on the booru. */
  postUrl: string;
}

/** "Blue Eyes" → "blue_eyes". */
export function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase().replace(/\s+/g, '_');
}

/** Space-separated tag string → tags. */
export function splitTags(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .split(/\s+/)
    .map(normalizeTag)
    .filter((t) => t.length > 0);
}

const ANIMATED_EXTS = new Set(['gif', 'apng']);
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mkv', 'mov', 'm4v', 'swf', 'zip']);

export type BooruMedia = 'image' | 'animated' | 'video';

/** Kind of file a post has (animated GIFs and ugoira count as animated). */
export function mediaOf(post: Pick<BooruPost, 'ext' | 'tags'>): BooruMedia {
  const ext = post.ext ?? '';
  if (VIDEO_EXTS.has(ext)) return ext === 'zip' ? 'animated' : 'video';
  if (ANIMATED_EXTS.has(ext) || post.tags.includes('animated')) return 'animated';
  return 'image';
}
