/**
 * Booru sites: which API each one speaks and which limits it has. Conbert
 * talks to the sites' own JSON APIs (not gallery-dl), so every single post
 * can be checked before a thumbnail is shown or a file is loaded.
 */

export const BOORU_APIS = ['danbooru', 'gelbooru', 'e621', 'moebooru'] as const;
export type BooruApi = (typeof BOORU_APIS)[number];

/** How the next page is found without page numbers (no page limit, resumable). */
export type IdNavigation =
  /** `page=b<id>` – posts below that ID (Danbooru, e621). Doesn't count as a tag. */
  | 'page-b'
  /** An `id:<N` tag – counts against the tag limit (Gelbooru, Moebooru). */
  | 'id-tag';

export interface BooruSiteInfo {
  /** 'danbooru', 'e621' … or 'custom-<uuid>' for own instances. */
  id: string;
  name: string;
  api: BooruApi;
  /** Without trailing slash. */
  baseUrl: string;
  /** Tags per search without and with an account (metatags count too). */
  tagLimit: { anonymous: number; account: number };
  /** Highest page number that can be opened (null = no known limit). */
  pageLimit: number | null;
  idNavigation: IdNavigation;
  /** The site's own minimum time between two requests – never faster. */
  minIntervalMs: number;
  /** Most posts the API returns per page. */
  maxPerPage: number;
  /** Only general/safe posts on this site (Safebooru, e926). */
  safeOnly: boolean;
  /** Username + API key can be stored for this site. */
  accounts: boolean;
  /** The API knows `date:` (otherwise dates are checked by Conbert). */
  dateSearch: boolean;
  /** Metatags that don't count against the tag limit (Danbooru: rating). */
  freeMetatags: readonly string[];
  /** The API answers only with an account (Gelbooru since 2025). */
  needsAccount: boolean;
  custom: boolean;
}

/** Sensible limits per API type – used for own instances. */
export const API_DEFAULTS: Record<
  BooruApi,
  Omit<BooruSiteInfo, 'id' | 'name' | 'api' | 'baseUrl' | 'safeOnly' | 'custom'>
> = {
  danbooru: {
    tagLimit: { anonymous: 2, account: 2 },
    pageLimit: 1000,
    idNavigation: 'page-b',
    minIntervalMs: 500,
    maxPerPage: 200,
    accounts: true,
    dateSearch: true,
    freeMetatags: ['rating'],
    needsAccount: false,
  },
  gelbooru: {
    tagLimit: { anonymous: 20, account: 20 },
    // pid × limit may not go beyond 20 000 posts.
    pageLimit: 200,
    idNavigation: 'id-tag',
    minIntervalMs: 1000,
    maxPerPage: 100,
    accounts: true,
    dateSearch: false,
    freeMetatags: [],
    needsAccount: false,
  },
  e621: {
    tagLimit: { anonymous: 40, account: 40 },
    pageLimit: 750,
    idNavigation: 'page-b',
    // e621: at most 2 requests per second, 1 per second recommended.
    minIntervalMs: 1000,
    maxPerPage: 320,
    accounts: true,
    dateSearch: true,
    freeMetatags: [],
    needsAccount: false,
  },
  moebooru: {
    tagLimit: { anonymous: 6, account: 6 },
    pageLimit: null,
    idNavigation: 'id-tag',
    minIntervalMs: 1000,
    maxPerPage: 100,
    accounts: false,
    dateSearch: false,
    freeMetatags: [],
    needsAccount: false,
  },
};

function site(
  id: string,
  name: string,
  api: BooruApi,
  baseUrl: string,
  safeOnly = false,
  overrides: Partial<BooruSiteInfo> = {},
): BooruSiteInfo {
  return { id, name, api, baseUrl, safeOnly, custom: false, ...API_DEFAULTS[api], ...overrides };
}

export const BOORU_SITES: readonly BooruSiteInfo[] = [
  site('safebooru', 'Safebooru', 'gelbooru', 'https://safebooru.org', true, { accounts: false }),
  // Answers API requests only with a username + API key (HTTP 401 otherwise).
  site('gelbooru', 'Gelbooru', 'gelbooru', 'https://gelbooru.com', false, { needsAccount: true }),
  site('konachan', 'Konachan', 'moebooru', 'https://konachan.com'),
  site('yandere', 'yande.re', 'moebooru', 'https://yande.re'),
];

/**
 * Taken out of the list because they answer server requests only with a
 * Cloudflare challenge (also with an account, 2026-10). Kept so old jobs and
 * subscriptions still show their site name; nothing new can start there.
 * Their APIs stay available for own instances.
 */
export const RETIRED_SITES: readonly BooruSiteInfo[] = [
  site('danbooru', 'Danbooru', 'danbooru', 'https://danbooru.donmai.us'),
  site('e621', 'e621', 'e621', 'https://e621.net'),
  site('e926', 'e926', 'e621', 'https://e926.net', true),
];

export const BUILTIN_SITE_IDS = BOORU_SITES.map((s) => s.id);

export function builtinSite(id: string): BooruSiteInfo | undefined {
  return BOORU_SITES.find((s) => s.id === id);
}

export function retiredSite(id: string): BooruSiteInfo | undefined {
  return RETIRED_SITES.find((s) => s.id === id);
}

/**
 * Gelbooru shows the access line "&api_key=…&user_id=…" under My Account →
 * Options. People paste it whole – this splits it into key and user ID.
 */
export function parseGelbooruCredentials(text: string): { apiKey: string; userId: string } | null {
  const key = /api_key=([A-Za-z0-9]+)/.exec(text)?.[1];
  const user = /user_id=(\d+)/.exec(text)?.[1];
  return key && user ? { apiKey: key, userId: user } : null;
}

/** Site info for an own instance (limits from its API type). */
export function customSite(
  id: string,
  name: string,
  api: BooruApi,
  baseUrl: string,
): BooruSiteInfo {
  return {
    id,
    name,
    api,
    baseUrl: baseUrl.replace(/\/+$/, ''),
    safeOnly: false,
    custom: true,
    ...API_DEFAULTS[api],
  };
}

/** Link to a post on its site. */
export function postPageUrl(site: Pick<BooruSiteInfo, 'api' | 'baseUrl'>, id: number): string {
  switch (site.api) {
    case 'danbooru':
    case 'e621':
      return `${site.baseUrl}/posts/${id}`;
    case 'gelbooru':
      return `${site.baseUrl}/index.php?page=post&s=view&id=${id}`;
    case 'moebooru':
      return `${site.baseUrl}/post/show/${id}`;
  }
}

/**
 * A link to a single post → which site and post ID (for "einzeln per URL").
 * Only known sites and the given own instances are recognised.
 */
export function parsePostUrl(
  input: string,
  sites: readonly Pick<BooruSiteInfo, 'id' | 'api' | 'baseUrl'>[],
): { siteId: string; postId: number } | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const match = sites.find((s) => {
    try {
      return new URL(s.baseUrl).hostname.toLowerCase().replace(/^www\./, '') === host;
    } catch {
      return false;
    }
  });
  if (!match) return null;
  const id =
    /^\/posts\/(\d+)/.exec(url.pathname)?.[1] ??
    /^\/post\/show\/(\d+)/.exec(url.pathname)?.[1] ??
    (url.searchParams.get('page') === 'post' ? url.searchParams.get('id') : null);
  const postId = id && /^\d{1,12}$/.test(id) ? Number(id) : NaN;
  return Number.isSafeInteger(postId) && postId > 0 ? { siteId: match.id, postId } : null;
}
