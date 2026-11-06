import { safeName } from '../storage';
import type { BooruPost } from './posts';

/**
 * File and folder names for downloaded posts, e.g. "{site}_{id}_{artist}.{ext}"
 * or "{site}/{search_tags}/". Every value is cleaned, so a tag can never
 * leave the chosen folder.
 */

export const NAME_PLACEHOLDERS = [
  'site',
  'id',
  'md5',
  'artist',
  'character',
  'copyright',
  'rating',
  'width',
  'height',
  'score',
  'search_tags',
  'date',
  'ext',
] as const;
export type NamePlaceholder = (typeof NAME_PLACEHOLDERS)[number];

export const DEFAULT_FILE_PATTERN = '{site}_{id}_{artist}.{ext}';
export const DEFAULT_FOLDER_PATTERN = '{site}/{search_tags}';
export const FILE_PATTERN_PRESETS = [
  '{site}_{id}_{artist}.{ext}',
  '{md5}.{ext}',
  '{site}_{id}.{ext}',
  '{artist}/{id}.{ext}',
] as const;
export const FOLDER_PATTERN_PRESETS = ['{site}/{search_tags}', '{artist}', '{site}', ''] as const;
export const MAX_PATTERN_LENGTH = 200;

export interface NameContext {
  site: string;
  /** {site} in folders: the site's display name ("Gelbooru"); file names keep `site`. */
  siteFolder?: string;
  /** The search, e.g. "blue_eyes cat_ears". */
  searchTags: string;
}

function firstFew(list: readonly string[], max = 2): string {
  return list.slice(0, max).join('+');
}

function values(post: BooruPost, ctx: NameContext): Record<NamePlaceholder, string> {
  return {
    site: ctx.site,
    id: String(post.id),
    md5: post.md5 ?? String(post.id),
    artist: firstFew(post.artists),
    character: firstFew(post.characters),
    copyright: firstFew(post.copyrights),
    rating: post.rating ?? '',
    width: post.width === null ? '' : String(post.width),
    height: post.height === null ? '' : String(post.height),
    score: post.score === null ? '' : String(post.score),
    search_tags:
      ctx.searchTags
        .split(/\s+/)
        .filter((t) => t !== '' && !t.includes(':'))
        .slice(0, 4)
        .join(' ') || 'all',
    date: post.createdAt?.slice(0, 10) ?? '',
    ext: post.ext ?? 'bin',
  };
}

function fill(pattern: string, map: Record<string, string>): string {
  return pattern.replace(/\{(\w+)\}/g, (_m, key: string) =>
    // Values never contain path separators.
    (map[key] ?? '').replace(/[/\\]/g, '_'),
  );
}

/** Removes leftovers of empty values: "danbooru_123_.jpg" → "danbooru_123.jpg". */
function tidy(part: string): string {
  return part
    .replace(/([_\-\s])[_\-\s]+/g, '$1')
    .replace(/[_\-\s]+(\.[^.]+)$/, '$1')
    .replace(/^[_\-\s]+/, '');
}

/** Folder (may be empty) and file name for a post. */
export function renderPostName(
  filePattern: string,
  folderPattern: string,
  post: BooruPost,
  ctx: NameContext,
): { folder: string; name: string } {
  const map = values(post, ctx);
  const ext = map.ext;
  // A file pattern may contain folders ("{artist}/{id}.{ext}").
  const file = fill(filePattern.slice(0, MAX_PATTERN_LENGTH) || DEFAULT_FILE_PATTERN, map)
    .replace(/\\/g, '/')
    .split('/');
  const fileName = file.pop() ?? '';
  const folders = [
    ...fill(
      folderPattern.slice(0, MAX_PATTERN_LENGTH),
      ctx.siteFolder ? { ...map, site: ctx.siteFolder } : map,
    )
      .replace(/\\/g, '/')
      .split('/'),
    ...file,
  ]
    .map((p) => tidy(p.trim()))
    .filter((p) => p !== '' && p !== '.' && p !== '..')
    .map(safeName);
  let name = tidy(fileName.trim());
  if (!name.toLowerCase().endsWith(`.${ext}`)) name = `${name || post.id}.${ext}`;
  if (name === `.${ext}`) name = `${post.id}.${ext}`;
  return { folder: folders.join('/'), name: safeName(name) };
}
