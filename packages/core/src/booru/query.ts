import { mediaOf, normalizeTag, type BooruMedia, type BooruPost, type BooruRating } from './posts';
import type { BooruApi, BooruSiteInfo } from './sites';

/**
 * Search syntax. Conbert uses the common booru syntax (tags, "-tag",
 * "order:score", "score:>=50", "width:>=1920", "date:>=2024-01-01",
 * "type:video") for every site. What a site doesn't understand – or what
 * doesn't fit into its tag limit – is checked by Conbert itself on every post.
 */

export const SEARCH_ORDERS = ['newest', 'oldest', 'score', 'favorites', 'random'] as const;
export type SearchOrder = (typeof SEARCH_ORDERS)[number];
export const SEARCH_MEDIA = ['any', 'image', 'animated', 'video'] as const;
export type SearchMedia = (typeof SEARCH_MEDIA)[number];

/** The beginner form – kept in sync with the text field. */
export interface SearchForm {
  include: string[];
  exclude: string[];
  minScore: number | null;
  minWidth: number | null;
  minHeight: number | null;
  /** YYYY-MM-DD */
  dateFrom: string | null;
  dateTo: string | null;
  order: SearchOrder;
  media: SearchMedia;
  /** Other syntax the form has no field for ("pool:123", "~tag") – kept as typed. */
  extra: string[];
}

export const EMPTY_FORM: SearchForm = {
  include: [],
  exclude: [],
  minScore: null,
  minWidth: null,
  minHeight: null,
  dateFrom: null,
  dateTo: null,
  order: 'newest',
  media: 'any',
  extra: [],
};

export const MAX_QUERY_LENGTH = 1000;
export const MAX_QUERY_TOKENS = 40;

export function tokenize(text: string): string[] {
  return text
    .slice(0, MAX_QUERY_LENGTH)
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t !== '')
    .slice(0, MAX_QUERY_TOKENS);
}

const ORDER_WORDS: Record<string, SearchOrder> = {
  'order:id': 'oldest',
  'order:id_asc': 'oldest',
  'order:id_desc': 'newest',
  'order:score': 'score',
  'order:score_desc': 'score',
  'order:favcount': 'favorites',
  'order:fav': 'favorites',
  'order:random': 'random',
  'sort:id:asc': 'oldest',
  'sort:id:desc': 'newest',
  'sort:score': 'score',
  'sort:score:desc': 'score',
  'sort:random': 'random',
};
const ORDER_TOKEN: Record<SearchOrder, string | null> = {
  newest: null,
  oldest: 'order:id',
  score: 'order:score',
  favorites: 'order:favcount',
  random: 'order:random',
};

const NUM = /^(score|width|height):>=?(-?\d{1,7})$/;
const DATE = /^date:(>=?|<=?)(\d{4}-\d{2}-\d{2})$/;
const DATE_RANGE = /^date:(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/;
const TYPE = /^type:(image|animated|video)$/;

/** Text → form. Anything the form can't show ends up in `extra`. */
export function parseQuery(text: string): SearchForm {
  const form: SearchForm = { ...EMPTY_FORM, include: [], exclude: [], extra: [] };
  for (const raw of tokenize(text)) {
    const token = raw.toLowerCase();
    const order = ORDER_WORDS[token];
    if (order) {
      form.order = order;
      continue;
    }
    const num = NUM.exec(token);
    if (num) {
      const value = Number(num[2]);
      if (num[1] === 'score') form.minScore = value;
      else if (num[1] === 'width') form.minWidth = value;
      else form.minHeight = value;
      continue;
    }
    const date = DATE.exec(token);
    if (date) {
      if (date[1]?.startsWith('>')) form.dateFrom = date[2] ?? null;
      else form.dateTo = date[2] ?? null;
      continue;
    }
    const range = DATE_RANGE.exec(token);
    if (range) {
      form.dateFrom = range[1] ?? null;
      form.dateTo = range[2] ?? null;
      continue;
    }
    const type = TYPE.exec(token);
    if (type) {
      form.media = type[1] as SearchMedia;
      continue;
    }
    if (/^-[^-:*~()]+$/.test(token)) form.exclude.push(normalizeTag(token.slice(1)));
    else if (/^[^-:*~()][^:*~()]*$/.test(token)) form.include.push(normalizeTag(token));
    else form.extra.push(raw);
  }
  return form;
}

/** Form → text (the same order every time, so both views stay in sync). */
export function buildQuery(form: SearchForm): string {
  const parts = [
    ...form.include.map(normalizeTag),
    ...form.exclude.map((t) => `-${normalizeTag(t)}`),
    ...form.extra,
  ];
  if (form.minScore !== null) parts.push(`score:>=${form.minScore}`);
  if (form.minWidth !== null) parts.push(`width:>=${form.minWidth}`);
  if (form.minHeight !== null) parts.push(`height:>=${form.minHeight}`);
  if (form.dateFrom !== null) parts.push(`date:>=${form.dateFrom}`);
  if (form.dateTo !== null) parts.push(`date:<=${form.dateTo}`);
  if (form.media !== 'any') parts.push(`type:${form.media}`);
  const order = ORDER_TOKEN[form.order];
  if (order) parts.push(order);
  return parts.filter((p) => p !== '').join(' ');
}

// --- What goes to the site, what Conbert checks itself ---

/** One condition Conbert can check on a post. */
export type LocalCondition =
  | { kind: 'tag'; tag: string; negate: boolean }
  | { kind: 'glob'; pattern: RegExp; negate: boolean }
  | { kind: 'min'; field: 'score' | 'width' | 'height'; value: number }
  | { kind: 'date'; from: string | null; to: string | null }
  | { kind: 'media'; media: BooruMedia }
  | { kind: 'rating'; ratings: BooruRating[] };

export interface QueryPlan {
  /** Sent to the site (within its tag limit). */
  apiTokens: string[];
  /** Checked by Conbert on every post (everything that wasn't sent). */
  local: LocalCondition[];
  /** Tags/conditions not sent because of the tag limit (for the explanation). */
  localOnly: string[];
  /** Syntax the site must see itself but which doesn't fit (search impossible). */
  overflow: string[];
  order: SearchOrder;
  /** Pages can be followed by post ID (no page limit, resumable). */
  idNavigation: boolean;
}

export interface PlanOptions {
  site: Pick<BooruSiteInfo, 'api' | 'idNavigation' | 'dateSearch' | 'safeOnly' | 'freeMetatags'>;
  /** Tags per search the account allows. */
  tagLimit: number;
  /** Post counts per tag (from the autocomplete) – rarest tags are sent first. */
  counts?: Record<string, number>;
  /** Ratings the user may see – narrowed at the site if a slot is free. */
  ratings: readonly BooruRating[];
}

function globRegex(pattern: string): RegExp {
  const source = pattern
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${source}$`);
}

/** Site syntax for an order (Gelbooru says "sort:"). */
function orderToken(api: BooruApi, order: SearchOrder): string | null {
  if (order === 'newest') return null;
  if (api === 'gelbooru') {
    return {
      oldest: 'sort:id:asc',
      score: 'sort:score:desc',
      favorites: 'sort:score:desc',
      random: 'sort:random',
    }[order];
  }
  if (api === 'moebooru' && order === 'favorites') return 'order:score';
  return ORDER_TOKEN[order];
}

/** Rating narrowing in the site's syntax (only if it fits). */
function ratingToken(api: BooruApi, ratings: readonly BooruRating[]): string | null {
  const all = ratings.length === 4;
  if (all || ratings.length === 0) return null;
  if (api === 'danbooru') return `rating:${ratings.map((r) => r[0]).join(',')}`;
  const onlyGeneral = ratings.length === 1 && ratings[0] === 'general';
  if (api === 'gelbooru') {
    if (onlyGeneral) return 'rating:general';
    return ratings.includes('explicit') ? null : '-rating:explicit';
  }
  // e621 / Moebooru: s(afe), q, e.
  if (onlyGeneral) return 'rating:s';
  return ratings.includes('explicit') ? null : '-rating:e';
}

/**
 * Splits a search into what the site gets and what Conbert checks itself.
 * Order of priority within the tag limit: syntax only the site understands,
 * the sort order, ID navigation, the rarest tags, rating, exclusions, the
 * other conditions.
 */
export function planQuery(text: string, options: PlanOptions): QueryPlan {
  const { site } = options;
  const form = parseQuery(text);
  const limit = Math.max(1, options.tagLimit);
  const api: string[] = [];
  const local: LocalCondition[] = [];
  const localOnly: string[] = [];
  const overflow: string[] = [];
  /** Sent, but not counted against the limit. */
  const free: string[] = [];
  const fits = () => api.length < limit;

  // Syntax only the site knows (pools, favourites of a user, "~a ~b").
  for (const token of form.extra) {
    if (fits()) api.push(token);
    else overflow.push(token);
  }
  const order = orderToken(site.api, form.order);
  if (order) {
    if (fits()) api.push(order);
    else overflow.push(order);
  }
  // Only newest-first can follow post IDs.
  const idNavigation = form.order === 'newest';
  const idSlot = idNavigation && site.idNavigation === 'id-tag' ? 1 : 0;
  const take = (token: string, condition: LocalCondition) => {
    if (api.length + idSlot < limit) api.push(token);
    else {
      local.push(condition);
      localOnly.push(token);
    }
  };

  const counts = options.counts ?? {};
  const include = [...new Set(form.include)].sort(
    (a, b) => (counts[a] ?? Number.MAX_SAFE_INTEGER) - (counts[b] ?? Number.MAX_SAFE_INTEGER),
  );
  for (const tag of include) {
    if (tag.includes('*')) take(tag, { kind: 'glob', pattern: globRegex(tag), negate: false });
    else take(tag, { kind: 'tag', tag, negate: false });
  }
  if (!site.safeOnly) {
    const rating = ratingToken(site.api, options.ratings);
    if (rating && site.freeMetatags.includes('rating')) free.push(rating);
    else if (rating && api.length + idSlot < limit) api.push(rating);
  }
  for (const tag of [...new Set(form.exclude)]) {
    take(`-${tag}`, { kind: 'tag', tag, negate: true });
  }
  if (form.minScore !== null) {
    take(`score:>=${form.minScore}`, { kind: 'min', field: 'score', value: form.minScore });
  }
  if (form.minWidth !== null) {
    take(`width:>=${form.minWidth}`, { kind: 'min', field: 'width', value: form.minWidth });
  }
  if (form.minHeight !== null) {
    take(`height:>=${form.minHeight}`, { kind: 'min', field: 'height', value: form.minHeight });
  }
  if (form.dateFrom !== null || form.dateTo !== null) {
    const condition: LocalCondition = { kind: 'date', from: form.dateFrom, to: form.dateTo };
    if (site.dateSearch) {
      if (form.dateFrom) take(`date:>=${form.dateFrom}`, { ...condition, to: null });
      if (form.dateTo) take(`date:<=${form.dateTo}`, { ...condition, from: null });
    } else {
      local.push(condition);
    }
  }
  if (form.media !== 'any') {
    // Every site has an "animated" or "video" tag; plain images = neither.
    const token =
      form.media === 'image' ? '-animated' : form.media === 'animated' ? 'animated' : 'video';
    if (api.length + idSlot < limit) api.push(token);
    // The tags aren't always set – the file type is checked in any case.
    local.push({ kind: 'media', media: form.media });
  }
  // Ratings are always checked on every post, whatever the site was told.
  local.push({ kind: 'rating', ratings: [...options.ratings] });
  return {
    apiTokens: [...api, ...free],
    local,
    localOnly,
    overflow,
    order: form.order,
    idNavigation,
  };
}

/**
 * Roughly how many posts the site returns for the sent tags (the rarest sent
 * tag; null = unknown or "all posts"). Conbert looks through all of them.
 */
export function estimateScanned(plan: QueryPlan, counts: Record<string, number>): number | null {
  const sent = plan.apiTokens
    .filter((t) => !t.startsWith('-') && !t.includes(':'))
    .map((t) => counts[t])
    .filter((n): n is number => typeof n === 'number');
  return sent.length > 0 ? Math.min(...sent) : null;
}

/** Does a post fulfil everything Conbert checks itself? */
export function matchesLocal(post: BooruPost, conditions: readonly LocalCondition[]): boolean {
  for (const c of conditions) {
    switch (c.kind) {
      case 'tag':
        if (post.tags.includes(c.tag) === c.negate) return false;
        break;
      case 'glob':
        if (post.tags.some((t) => c.pattern.test(t)) === c.negate) return false;
        break;
      case 'min': {
        const value = post[c.field];
        if (value === null || value < c.value) return false;
        break;
      }
      case 'date': {
        const day = post.createdAt?.slice(0, 10) ?? null;
        if (day === null) return false;
        if (c.from && day < c.from) return false;
        if (c.to && day > c.to) return false;
        break;
      }
      case 'media':
        if (mediaOf(post) !== c.media) return false;
        break;
      case 'rating':
        // Unknown rating = treated like explicit.
        if (!c.ratings.includes(post.rating ?? 'explicit')) return false;
        break;
    }
  }
  return true;
}

// --- Own blacklist ---

/** Suggestions the blacklist starts with (each line: tags that must all be present). */
export const DEFAULT_BLACKLIST: readonly string[] = [
  'guro',
  'gore',
  'scat',
  'vomit',
  'bestiality',
  'rape',
  'torture',
];

export const MAX_BLACKLIST_LINES = 500;

/** One blacklist line ("tag1 tag2 -tag3 rating:e") against a post. */
function lineMatches(line: string, post: BooruPost): boolean {
  const tokens = tokenize(line.toLowerCase());
  if (tokens.length === 0) return false;
  return tokens.every((token) => {
    const negate = token.startsWith('-');
    const body = negate ? token.slice(1) : token;
    let hit: boolean;
    const rating = /^rating:(\w+)/.exec(body);
    if (rating) {
      const want = rating[1] ?? '';
      hit = post.rating !== null && (post.rating === want || post.rating[0] === want[0]);
    } else if (body.includes('*')) {
      const regex = globRegex(normalizeTag(body));
      hit = post.tags.some((t) => regex.test(t));
    } else {
      hit = post.tags.includes(normalizeTag(body));
    }
    return negate ? !hit : hit;
  });
}

/** Is the post hidden by the user's own blacklist? */
export function isBlacklisted(post: BooruPost, blacklist: readonly string[]): boolean {
  return blacklist.some((line) => lineMatches(line, post));
}
