import { XMLParser } from 'fast-xml-parser';
import {
  normalizeRating,
  normalizeTag,
  postPageUrl,
  splitTags,
  type BooruApi,
  type BooruPost,
  type BooruSiteInfo,
  type TagCategory,
} from '@conbert/core';
import type { TagSuggestion } from '@conbert/schemas';

/**
 * One small adapter per booru API (Danbooru, Gelbooru 0.2, e621, Moebooru):
 * builds the request, reads the answer into the same post shape for all.
 */

export interface BooruAccount {
  username: string;
  apiKey: string;
}

/** Does the request (gate, waiting, errors are handled by the caller). */
export type JsonFetcher = (url: URL, headers?: Record<string, string>) => Promise<unknown>;

export interface ListRequest {
  tags: string[];
  limit: number;
  /** Page number (1 = first). */
  page?: number;
  /** Only posts with a smaller ID (ID navigation). */
  beforeId?: number;
}

export interface BooruAdapter {
  list(req: ListRequest): Promise<BooruPost[]>;
  byIds(ids: number[]): Promise<BooruPost[]>;
  autocomplete(prefix: string): Promise<TagSuggestion[]>;
}

type Json = Record<string, unknown>;

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const obj = (v: unknown): Json =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strings = (v: unknown): string[] => arr(v).filter((x): x is string => typeof x === 'string');

function isoDate(v: unknown): string | null {
  if (typeof v === 'number') return v > 0 ? new Date(v * 1000).toISOString() : null;
  if (typeof v === 'string' && v !== '') {
    const t = Date.parse(v);
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
  }
  // Old Moebooru: { s: seconds }.
  const s = num(obj(v)['s']);
  return s ? new Date(s * 1000).toISOString() : null;
}

function extOf(url: string | null): string | null {
  if (!url) return null;
  const m = /\.([a-z0-9]{2,5})(?:\?|$)/i.exec(url);
  return m?.[1]?.toLowerCase() ?? null;
}

/** "cat_e" → safe text for a prefix search (no wildcards, no spaces). */
function prefixOf(input: string): string {
  return normalizeTag(input)
    .replace(/[*%?\s]/g, '')
    .slice(0, 100);
}

function withParams(
  base: string,
  path: string,
  params: Record<string, string | number | undefined>,
): URL {
  const url = new URL(base + path);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }
  return url;
}

function basicAuth(account: BooruAccount | null): Record<string, string> | undefined {
  if (!account) return undefined;
  const token = Buffer.from(`${account.username}:${account.apiKey}`).toString('base64');
  return { Authorization: `Basic ${token}` };
}

const unique = (list: string[]) => [...new Set(list)];

// --- Danbooru ---

const DANBOORU_CATEGORIES: Record<number, TagCategory> = {
  0: 'general',
  1: 'artist',
  3: 'copyright',
  4: 'character',
  5: 'meta',
};

function danbooruPost(site: BooruSiteInfo, raw: unknown): BooruPost | null {
  const p = obj(raw);
  const id = num(p['id']);
  if (!id) return null;
  const variants = arr(obj(p['media_asset'])['variants']).map(obj);
  const variant = (type: string) => str(variants.find((v) => v['type'] === type)?.['url']);
  const fileUrl = str(p['file_url']) ?? variant('original');
  return {
    id,
    md5: str(p['md5']),
    rating: normalizeRating(p['rating'], 'danbooru'),
    tags: splitTags(str(p['tag_string'])),
    artists: splitTags(str(p['tag_string_artist'])),
    characters: splitTags(str(p['tag_string_character'])),
    copyrights: splitTags(str(p['tag_string_copyright'])),
    score: num(p['score']),
    favorites: num(p['fav_count']),
    width: num(p['image_width']),
    height: num(p['image_height']),
    ext: str(p['file_ext'])?.toLowerCase() ?? extOf(fileUrl),
    size: num(p['file_size']),
    createdAt: isoDate(p['created_at']),
    fileUrl,
    sampleUrl: str(p['large_file_url']) ?? variant('sample'),
    previewUrl: variant('360x360') ?? str(p['preview_file_url']) ?? variant('180x180'),
    source: str(p['source']),
    postUrl: postPageUrl(site, id),
  };
}

function danbooru(
  site: BooruSiteInfo,
  account: BooruAccount | null,
  get: JsonFetcher,
): BooruAdapter {
  const auth = basicAuth(account);
  const posts = async (tags: string[], limit: number, page: string | number | undefined) => {
    const body = await get(
      withParams(site.baseUrl, '/posts.json', { tags: tags.join(' '), limit, page }),
      auth,
    );
    return arr(body)
      .map((p) => danbooruPost(site, p))
      .filter((p): p is BooruPost => p !== null);
  };
  return {
    list: (req) =>
      posts(req.tags, req.limit, req.beforeId !== undefined ? `b${req.beforeId}` : req.page),
    byIds: (ids) => posts([`id:${ids.join(',')}`], ids.length, undefined),
    async autocomplete(input) {
      const prefix = prefixOf(input);
      if (!prefix) return [];
      const body = await get(
        withParams(site.baseUrl, '/tags.json', {
          'search[name_matches]': `${prefix}*`,
          'search[order]': 'count',
          'search[hide_empty]': 'true',
          limit: 10,
        }),
        auth,
      );
      return arr(body)
        .map(obj)
        .flatMap((t) => {
          const name = str(t['name']);
          return name
            ? [
                {
                  name,
                  count: num(t['post_count']) ?? 0,
                  category: DANBOORU_CATEGORIES[num(t['category']) ?? 0] ?? 'general',
                },
              ]
            : [];
        });
    },
  };
}

// --- e621 / e926 ---

const E621_CATEGORIES: Record<number, TagCategory> = {
  0: 'general',
  1: 'artist',
  2: 'artist',
  3: 'copyright',
  4: 'character',
  5: 'species',
  6: 'general',
  7: 'meta',
  8: 'general',
};
/** Not real artists. */
const E621_NOT_ARTISTS = new Set([
  'conditional_dnp',
  'sound_warning',
  'unknown_artist',
  'anonymous_artist',
  'third-party_edit',
  'avoid_posting',
]);

function e621Post(site: BooruSiteInfo, raw: unknown): BooruPost | null {
  const p = obj(raw);
  const id = num(p['id']);
  if (!id) return null;
  const file = obj(p['file']);
  const sample = obj(p['sample']);
  const groups = obj(p['tags']);
  const group = (name: string) => strings(groups[name]).map(normalizeTag);
  const tags = unique(Object.keys(groups).flatMap(group));
  return {
    id,
    md5: str(file['md5']),
    rating: normalizeRating(p['rating'], 'e621'),
    tags,
    artists: group('artist').filter((a) => !E621_NOT_ARTISTS.has(a)),
    characters: group('character'),
    copyrights: group('copyright'),
    score: num(obj(p['score'])['total']),
    favorites: num(p['fav_count']),
    width: num(file['width']),
    height: num(file['height']),
    ext: str(file['ext'])?.toLowerCase() ?? null,
    size: num(file['size']),
    createdAt: isoDate(p['created_at']),
    fileUrl: str(file['url']),
    sampleUrl: sample['has'] ? str(sample['url']) : null,
    previewUrl: str(obj(p['preview'])['url']),
    source: strings(p['sources'])[0] ?? null,
    postUrl: postPageUrl(site, id),
  };
}

function e621(site: BooruSiteInfo, account: BooruAccount | null, get: JsonFetcher): BooruAdapter {
  const auth = basicAuth(account);
  const posts = async (tags: string[], limit: number, page: string | number | undefined) => {
    const body = await get(
      withParams(site.baseUrl, '/posts.json', { tags: tags.join(' '), limit, page }),
      auth,
    );
    return arr(obj(body)['posts'])
      .map((p) => e621Post(site, p))
      .filter((p): p is BooruPost => p !== null);
  };
  return {
    list: (req) =>
      posts(req.tags, req.limit, req.beforeId !== undefined ? `b${req.beforeId}` : req.page),
    byIds: (ids) => posts([`id:${ids.join(',')}`], ids.length, undefined),
    async autocomplete(input) {
      const prefix = prefixOf(input);
      if (!prefix) return [];
      const body = await get(
        withParams(site.baseUrl, '/tags.json', {
          'search[name_matches]': `${prefix}*`,
          'search[order]': 'count',
          limit: 10,
        }),
        auth,
      );
      return arr(body)
        .map(obj)
        .flatMap((t) => {
          const name = str(t['name']);
          const count = num(t['post_count']) ?? 0;
          return name && count > 0
            ? [{ name, count, category: E621_CATEGORIES[num(t['category']) ?? 0] ?? 'general' }]
            : [];
        });
    },
  };
}

// --- Gelbooru 0.2 (Gelbooru, Safebooru and many own instances) ---

const GELBOORU_TYPES: Record<string, TagCategory> = {
  tag: 'general',
  general: 'general',
  artist: 'artist',
  character: 'character',
  copyright: 'copyright',
  metadata: 'meta',
  meta: 'meta',
  '0': 'general',
  '1': 'artist',
  '3': 'copyright',
  '4': 'character',
  '5': 'meta',
};

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });

function gelbooruPost(site: BooruSiteInfo, raw: unknown): BooruPost | null {
  const p = obj(raw);
  const id = num(p['id']);
  if (!id) return null;
  const directory =
    str(p['directory']) ?? (num(p['directory']) !== null ? String(p['directory']) : null);
  const image = str(p['image']);
  const base = image?.replace(/\.[^.]+$/, '') ?? '';
  const built = (folder: string, prefix: string, ext: string) =>
    directory && image ? `${site.baseUrl}/${folder}/${directory}/${prefix}${base}.${ext}` : null;
  const fileUrl =
    str(p['file_url']) ??
    (directory && image ? `${site.baseUrl}/images/${directory}/${image}` : null);
  const hasSample = p['sample'] === true || p['sample'] === 1 || p['sample'] === '1';
  return {
    id,
    md5: str(p['md5']) ?? str(p['hash']),
    rating: normalizeRating(p['rating'], 'gelbooru'),
    tags: splitTags(str(p['tags'])),
    // Gelbooru doesn't say which tag is the artist.
    artists: [],
    characters: [],
    copyrights: [],
    score: num(p['score']),
    favorites: null,
    width: num(p['width']),
    height: num(p['height']),
    ext: extOf(image) ?? extOf(fileUrl),
    size: null,
    createdAt: isoDate(p['created_at']) ?? isoDate(num(p['change'])),
    fileUrl,
    sampleUrl: str(p['sample_url']) ?? (hasSample ? built('samples', 'sample_', 'jpg') : null),
    previewUrl: str(p['preview_url']) ?? built('thumbnails', 'thumbnail_', 'jpg'),
    source: str(p['source']),
    postUrl: postPageUrl(site, id),
  };
}

/** Gelbooru answers with { post: [...] }, Safebooru with [...], old instances with XML. */
function gelbooruList(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  const o = obj(body);
  if (typeof o['xml'] === 'string') {
    const parsed = obj(xml.parse(o['xml']));
    const posts = obj(parsed['posts'])['post'];
    return Array.isArray(posts) ? posts : posts ? [posts] : [];
  }
  const posts = o['post'];
  return Array.isArray(posts) ? posts : posts ? [posts] : [];
}

function gelbooru(
  site: BooruSiteInfo,
  account: BooruAccount | null,
  get: JsonFetcher,
): BooruAdapter {
  const auth = account ? { api_key: account.apiKey, user_id: account.username } : {};
  const posts = async (tags: string[], limit: number, pid: number | undefined, id?: number) => {
    const body = await get(
      withParams(site.baseUrl, '/index.php', {
        page: 'dapi',
        s: 'post',
        q: 'index',
        json: 1,
        tags: tags.join(' '),
        limit,
        pid,
        id,
        ...auth,
      }),
    );
    return gelbooruList(body)
      .map((p) => gelbooruPost(site, p))
      .filter((p): p is BooruPost => p !== null);
  };
  return {
    list: (req) =>
      posts(
        req.beforeId !== undefined ? [...req.tags, `id:<${req.beforeId}`] : req.tags,
        req.limit,
        req.beforeId !== undefined ? undefined : req.page !== undefined ? req.page - 1 : undefined,
      ),
    async byIds(ids) {
      const found: BooruPost[] = [];
      for (const id of ids) found.push(...(await posts([], 1, undefined, id)));
      return found;
    },
    async autocomplete(input) {
      const prefix = prefixOf(input);
      if (!prefix) return [];
      // Gelbooru: autocomplete2 with counts and categories.
      const modern = await get(
        withParams(site.baseUrl, '/index.php', {
          page: 'autocomplete2',
          term: prefix,
          type: 'tag_query',
          limit: 10,
        }),
      ).catch(() => null);
      const rows = arr(modern)
        .map(obj)
        .filter((t) => str(t['value']));
      if (rows.length > 0) {
        return rows.map((t) => ({
          name: str(t['value']) ?? '',
          count: num(t['post_count']) ?? 0,
          category: GELBOORU_TYPES[String(t['category'])] ?? 'general',
        }));
      }
      // Safebooru and older instances: "name (count)" without categories.
      const old = await get(withParams(site.baseUrl, '/autocomplete.php', { q: prefix }));
      return arr(old)
        .map(obj)
        .flatMap((t) => {
          const name = str(t['value']);
          const count = /\((\d+)\)\s*$/.exec(str(t['label']) ?? '')?.[1];
          return name ? [{ name, count: Number(count ?? 0), category: 'general' as const }] : [];
        });
    },
  };
}

// --- Moebooru (Konachan, yande.re) ---

const MOEBOORU_TYPES: Record<number, TagCategory> = {
  0: 'general',
  1: 'artist',
  3: 'copyright',
  4: 'character',
  5: 'meta',
  6: 'meta',
};

function moebooruPost(site: BooruSiteInfo, raw: unknown): BooruPost | null {
  const p = obj(raw);
  const id = num(p['id']);
  if (!id) return null;
  const fileUrl = str(p['file_url']);
  return {
    id,
    md5: str(p['md5']),
    rating: normalizeRating(p['rating'], 'moebooru'),
    tags: splitTags(str(p['tags'])),
    artists: [],
    characters: [],
    copyrights: [],
    score: num(p['score']),
    favorites: null,
    width: num(p['width']),
    height: num(p['height']),
    ext: str(p['file_ext'])?.toLowerCase() ?? extOf(fileUrl),
    size: num(p['file_size']),
    createdAt: isoDate(p['created_at']),
    fileUrl,
    sampleUrl: str(p['sample_url']),
    previewUrl: str(p['preview_url']),
    source: str(p['source']),
    postUrl: postPageUrl(site, id),
  };
}

function moebooru(
  site: BooruSiteInfo,
  _account: BooruAccount | null,
  get: JsonFetcher,
): BooruAdapter {
  const posts = async (tags: string[], limit: number, page: number | undefined) => {
    const body = await get(
      withParams(site.baseUrl, '/post.json', { tags: tags.join(' '), limit, page }),
    );
    return arr(body)
      .map((p) => moebooruPost(site, p))
      .filter((p): p is BooruPost => p !== null);
  };
  return {
    list: (req) =>
      posts(
        req.beforeId !== undefined ? [...req.tags, `id:<${req.beforeId}`] : req.tags,
        req.limit,
        req.beforeId !== undefined ? undefined : req.page,
      ),
    byIds: (ids) => posts([`id:${ids.join(',')}`], ids.length, undefined),
    async autocomplete(input) {
      const prefix = prefixOf(input);
      if (!prefix) return [];
      const body = await get(
        withParams(site.baseUrl, '/tag.json', { name: `${prefix}*`, order: 'count', limit: 10 }),
      );
      return arr(body)
        .map(obj)
        .flatMap((t) => {
          const name = str(t['name']);
          const count = num(t['count']) ?? 0;
          return name && count > 0
            ? [{ name, count, category: MOEBOORU_TYPES[num(t['type']) ?? 0] ?? 'general' }]
            : [];
        });
    },
  };
}

const FACTORIES: Record<
  BooruApi,
  (site: BooruSiteInfo, account: BooruAccount | null, get: JsonFetcher) => BooruAdapter
> = { danbooru, e621, gelbooru, moebooru };

export function createAdapter(
  site: BooruSiteInfo,
  account: BooruAccount | null,
  get: JsonFetcher,
): BooruAdapter {
  return FACTORIES[site.api](site, account, get);
}
