import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import {
  BOORU_SITES,
  DEFAULT_BLACKLIST,
  builtinSite,
  parseGelbooruCredentials,
  retiredSite,
  checkPostProtection,
  checkQueryProtection,
  customSite,
  estimateScanned,
  isBlacklisted,
  isSuggestionAllowed,
  matchesLocal,
  parseQuery,
  planQuery,
  tokenize,
  type BooruPost,
  type BooruRating,
  type BooruSiteInfo,
  type LocalCondition,
  type QueryPlan,
} from '@conbert/core';
import {
  DEFAULT_BOORU_SETTINGS,
  booruSettingsSchema,
  type BooruSearchResponse,
  type BooruSettings,
  type BooruSite,
  type HiddenCounts,
  type TagSuggestion,
  type updateBooruSettingsRequestSchema,
} from '@conbert/schemas';
import type { z } from 'zod';
import { hashPassword, verifyPassword } from '../auth/password';
import type { AppContext } from '../context';
import {
  booruAccounts,
  booruArchive,
  booruInstances,
  booruSettings as booruSettingsTable,
} from '../db/schema';
import { HttpError, type ApiErrorCode } from '../lib/http-error';
import { createAdapter, type BooruAdapter, type BooruAccount } from './adapters';
import {
  BooruError,
  booruJson,
  booruRequest,
  checkedUrl,
  fileSlots,
  readLimited,
  userAgent,
} from './http';

// --- Sites, own instances, accounts ---

const accountContext = (userId: string, siteId: string) => `booru-account:${userId}:${siteId}`;

function instanceSite(row: typeof booruInstances.$inferSelect): BooruSiteInfo {
  return customSite(`custom-${row.id}`, row.name, row.api, row.baseUrl);
}

/**
 * A built-in site or one of the user's own instances. `allowRetired` only
 * for showing old jobs and subscriptions – removed sites can't be used.
 */
export function siteFor(
  ctx: AppContext,
  userId: string,
  siteId: string,
  { allowRetired = false } = {},
): BooruSiteInfo {
  const builtin = builtinSite(siteId) ?? (allowRetired ? retiredSite(siteId) : undefined);
  if (builtin) return builtin;
  const m = /^custom-([0-9a-f-]{36})$/.exec(siteId);
  const row = m
    ? ctx.db
        .select()
        .from(booruInstances)
        .where(and(eq(booruInstances.id, m[1] ?? ''), eq(booruInstances.userId, userId)))
        .get()
    : undefined;
  if (!row) throw new HttpError(404, 'BOORU_SITE_UNKNOWN');
  return instanceSite(row);
}

export function userSites(ctx: AppContext, userId: string): BooruSiteInfo[] {
  const own = ctx.db
    .select()
    .from(booruInstances)
    .where(eq(booruInstances.userId, userId))
    .all()
    .map(instanceSite);
  return [...BOORU_SITES, ...own];
}

interface AccountRow {
  username: string;
  tagLimit: number | null;
}

function accountRows(ctx: AppContext, userId: string): Map<string, AccountRow> {
  const rows = ctx.db
    .select({
      siteId: booruAccounts.siteId,
      username: booruAccounts.username,
      tagLimit: booruAccounts.tagLimit,
    })
    .from(booruAccounts)
    .where(eq(booruAccounts.userId, userId))
    .all();
  return new Map(rows.map((r) => [r.siteId, { username: r.username, tagLimit: r.tagLimit }]));
}

/** The stored account with its key (only for requests to the site, never sent to the browser). */
export function accountFor(
  ctx: AppContext,
  userId: string,
  siteId: string,
): (BooruAccount & { tagLimit: number | null }) | null {
  const row = ctx.db
    .select()
    .from(booruAccounts)
    .where(and(eq(booruAccounts.userId, userId), eq(booruAccounts.siteId, siteId)))
    .get();
  if (!row) return null;
  try {
    const apiKey = ctx.secrets.decrypt(row.apiKey, accountContext(userId, siteId));
    return { username: row.username, apiKey, tagLimit: row.tagLimit };
  } catch {
    // Key changed: as if there were no account (the settings ask to enter it again).
    return null;
  }
}

/** Tag limits the sites told us about ("You cannot search for more than 2 tags"). */
const learnedLimits = new Map<string, number>();

export function tagLimitFor(
  site: BooruSiteInfo,
  account: { tagLimit: number | null } | null,
): number {
  const own = account?.tagLimit ?? (account ? site.tagLimit.account : site.tagLimit.anonymous);
  const learned = learnedLimits.get(`${site.baseUrl}:${account ? 'account' : 'anonymous'}`);
  return learned !== undefined ? Math.min(own, learned) : own;
}

function learnLimit(site: BooruSiteInfo, hasAccount: boolean, error: BooruError): boolean {
  const n = Number(/(\d+) tags/.exec(error.details ?? '')?.[1]);
  if (!Number.isInteger(n) || n < 1) return false;
  learnedLimits.set(`${site.baseUrl}:${hasAccount ? 'account' : 'anonymous'}`, n);
  return true;
}

export function listSites(ctx: AppContext, userId: string): BooruSite[] {
  const accounts = accountRows(ctx, userId);
  return userSites(ctx, userId).map((site) => {
    const account = accounts.get(site.id) ?? null;
    return {
      id: site.id,
      name: site.name,
      api: site.api,
      baseUrl: site.baseUrl,
      safeOnly: site.safeOnly,
      custom: site.custom,
      tagLimit: tagLimitFor(site, account),
      pageLimit: site.pageLimit,
      idNavigation: site.idNavigation,
      accounts: site.accounts,
      needsAccount: site.needsAccount,
      account: account ? { username: account.username, tagLimit: account.tagLimit } : null,
    };
  });
}

/** Own instance: only a normal web address (home network only if the admin allows it). */
export function createInstance(
  ctx: AppContext,
  userId: string,
  input: { name: string; api: BooruSiteInfo['api']; baseUrl: string },
): BooruSiteInfo {
  const url = checkedUrl(input.baseUrl, ctx.config.booruAllowPrivate);
  if (!url || url.username || url.password) throw new HttpError(422, 'BOORU_INSTANCE_INVALID');
  const baseUrl = `${url.origin}${url.pathname}`.replace(/\/+$/, '');
  const id = randomUUID();
  ctx.db
    .insert(booruInstances)
    .values({ id, userId, name: input.name, api: input.api, baseUrl })
    .run();
  return siteFor(ctx, userId, `custom-${id}`);
}

export function deleteInstance(ctx: AppContext, userId: string, siteId: string): void {
  const site = siteFor(ctx, userId, siteId);
  if (!site.custom) throw new HttpError(404, 'BOORU_SITE_UNKNOWN');
  const id = siteId.slice('custom-'.length);
  ctx.db
    .delete(booruAccounts)
    .where(and(eq(booruAccounts.userId, userId), eq(booruAccounts.siteId, siteId)))
    .run();
  ctx.db
    .delete(booruInstances)
    .where(and(eq(booruInstances.id, id), eq(booruInstances.userId, userId)))
    .run();
}

export function saveAccount(
  ctx: AppContext,
  userId: string,
  siteId: string,
  input: { username: string; apiKey: string; tagLimit: number | null },
): void {
  const site = siteFor(ctx, userId, siteId);
  if (!site.accounts) throw new HttpError(422, 'BOORU_ACCOUNTS_UNSUPPORTED');
  let username = input.username;
  let typedKey = input.apiKey;
  if (site.api === 'gelbooru') {
    // Gelbooru wants the numeric user ID, not the name.
    const pasted = parseGelbooruCredentials(typedKey);
    if (pasted) ({ apiKey: typedKey, userId: username } = pasted);
    if (!/^\d+$/.test(username)) throw new HttpError(422, 'BOORU_USER_ID_INVALID');
  }
  const existing = accountFor(ctx, userId, siteId);
  const apiKey = typedKey || existing?.apiKey;
  if (!apiKey) throw new HttpError(400, 'BAD_REQUEST', 'apiKey');
  const values = {
    username,
    apiKey: ctx.secrets.encrypt(apiKey, accountContext(userId, siteId)),
    tagLimit: input.tagLimit,
    updatedAt: new Date(),
  };
  ctx.db
    .insert(booruAccounts)
    .values({ userId, siteId, ...values })
    .onConflictDoUpdate({ target: [booruAccounts.userId, booruAccounts.siteId], set: values })
    .run();
}

export function deleteAccount(ctx: AppContext, userId: string, siteId: string): void {
  ctx.db
    .delete(booruAccounts)
    .where(and(eq(booruAccounts.userId, userId), eq(booruAccounts.siteId, siteId)))
    .run();
}

// --- Settings (ratings, blacklist, names) ---

export function readSettings(ctx: AppContext, userId: string): BooruSettings {
  const row = ctx.db
    .select()
    .from(booruSettingsTable)
    .where(eq(booruSettingsTable.userId, userId))
    .get();
  if (!row) return { ...DEFAULT_BOORU_SETTINGS, blacklist: [...DEFAULT_BLACKLIST] };
  const parsed = booruSettingsSchema.safeParse({
    ...DEFAULT_BOORU_SETTINGS,
    ...(row.data as object),
    locked: row.lockHash !== null,
  });
  const settings = parsed.success
    ? parsed.data
    : { ...DEFAULT_BOORU_SETTINGS, blacklist: [...DEFAULT_BLACKLIST] };
  // Without the age confirmation only general content, whatever is stored.
  if (!settings.ageConfirmed) settings.ratings = ['general'];
  return settings;
}

function lockHashOf(ctx: AppContext, userId: string): string | null {
  return (
    ctx.db
      .select({ lockHash: booruSettingsTable.lockHash })
      .from(booruSettingsTable)
      .where(eq(booruSettingsTable.userId, userId))
      .get()?.lockHash ?? null
  );
}

function writeSettings(
  ctx: AppContext,
  userId: string,
  settings: BooruSettings,
  lockHash?: string | null,
) {
  const { locked: _locked, ...data } = settings;
  const now = new Date();
  ctx.db
    .insert(booruSettingsTable)
    .values({ userId, data, lockHash: lockHash ?? null, updatedAt: now })
    .onConflictDoUpdate({
      target: booruSettingsTable.userId,
      set: { data, updatedAt: now, ...(lockHash !== undefined && { lockHash }) },
    })
    .run();
}

const sameRatings = (a: readonly BooruRating[], b: readonly BooruRating[]) =>
  a.length === b.length && a.every((r) => b.includes(r));

export async function updateSettings(
  ctx: AppContext,
  userId: string,
  body: z.infer<typeof updateBooruSettingsRequestSchema>,
): Promise<BooruSettings> {
  const current = readSettings(ctx, userId);
  const lockHash = lockHashOf(ctx, userId);
  const next: BooruSettings = { ...current };
  const ageConfirmed = body.ageConfirmed ?? current.ageConfirmed;
  const ratings = body.ratings ? [...new Set(body.ratings)] : current.ratings;
  const ratingsChange =
    ageConfirmed !== current.ageConfirmed || !sameRatings(ratings, current.ratings);
  if (ratingsChange && lockHash) {
    if (!body.pin || !(await verifyPassword(body.pin, lockHash))) {
      throw new HttpError(403, 'BOORU_PIN_WRONG');
    }
  }
  if (!ageConfirmed && ratings.some((r) => r !== 'general')) {
    throw new HttpError(422, 'BOORU_AGE_REQUIRED');
  }
  next.ageConfirmed = ageConfirmed;
  next.ratings = ageConfirmed ? ratings : ['general'];
  if (body.blacklist) next.blacklist = body.blacklist.map((l) => l.trim()).filter((l) => l !== '');
  if (body.filePattern !== undefined) next.filePattern = body.filePattern;
  if (body.folderPattern !== undefined) next.folderPattern = body.folderPattern;
  if (body.sidecars) next.sidecars = [...new Set(body.sidecars)];
  if (body.sample !== undefined) next.sample = body.sample;
  writeSettings(ctx, userId, next);
  return readSettings(ctx, userId);
}

export async function setLock(
  ctx: AppContext,
  userId: string,
  pin: string,
): Promise<BooruSettings> {
  if (lockHashOf(ctx, userId)) throw new HttpError(409, 'BOORU_PIN_WRONG');
  writeSettings(ctx, userId, readSettings(ctx, userId), await hashPassword(pin));
  return readSettings(ctx, userId);
}

export async function removeLock(
  ctx: AppContext,
  userId: string,
  pin: string,
): Promise<BooruSettings> {
  const hash = lockHashOf(ctx, userId);
  if (hash && !(await verifyPassword(pin, hash))) throw new HttpError(403, 'BOORU_PIN_WRONG');
  writeSettings(ctx, userId, readSettings(ctx, userId), null);
  return readSettings(ctx, userId);
}

// --- Talking to a site ---

export interface ClientOptions {
  intervalMs?: number;
  signal?: AbortSignal;
  retries?: number;
  maxWaitMs?: number;
}

export interface SiteClient {
  site: BooruSiteInfo;
  adapter: BooruAdapter;
  hasAccount: boolean;
  tagLimit: number;
  /** Shared by all requests to this site. */
  siteKey: string;
  allowPrivate: boolean;
  headers: Record<string, string>;
}

export function clientFor(
  ctx: AppContext,
  userId: string,
  site: BooruSiteInfo,
  options: ClientOptions = {},
): SiteClient {
  const account = accountFor(ctx, userId, site.id);
  if (site.needsAccount && !account) throw new HttpError(422, 'BOORU_NEEDS_ACCOUNT');
  const allowPrivate = site.custom && ctx.config.booruAllowPrivate;
  const siteKey = new URL(site.baseUrl).host;
  const headers = {
    'User-Agent': userAgent(account?.username, site.name),
    // Says where the request comes from. Gelbooru's image servers answer
    // with an HTML page instead of the picture without it (hotlink guard).
    Referer: `${site.baseUrl}/`,
  };
  const adapter = createAdapter(site, account, (url, extra) =>
    booruJson(url, {
      siteKey,
      intervalMs: Math.max(site.minIntervalMs, options.intervalMs ?? 0),
      headers: { ...headers, ...extra },
      allowPrivate,
      ...(options.signal && { signal: options.signal }),
      retries: options.retries ?? 1,
      maxWaitMs: options.maxWaitMs ?? 15_000,
    }),
  );
  return {
    site,
    adapter,
    hasAccount: account !== null,
    tagLimit: tagLimitFor(site, account),
    siteKey,
    allowPrivate,
    headers,
  };
}

/** Booru problems become API errors with a three-part explanation. */
export function asHttpError(error: unknown): unknown {
  if (!(error instanceof BooruError)) return error;
  const status: Record<string, number> = {
    BOORU_TAG_LIMIT: 422,
    BOORU_PAGE_LIMIT: 422,
    BOORU_AUTH: 422,
    BOORU_NEEDS_ACCOUNT: 422,
    BOORU_RATE_LIMITED: 503,
  };
  return new HttpError(status[error.code] ?? 502, error.code as ApiErrorCode, error.details);
}

// --- Tag counts (from the autocomplete, so the rarest tags go to the site first) ---

const countCache = new Map<string, { count: number; at: number }>();
const COUNT_TTL_MS = 24 * 60 * 60_000;

function rememberCounts(siteKey: string, tags: TagSuggestion[]) {
  if (countCache.size > 50_000) countCache.clear();
  for (const t of tags) countCache.set(`${siteKey}:${t.name}`, { count: t.count, at: Date.now() });
}

export async function autocomplete(client: SiteClient, prefix: string): Promise<TagSuggestion[]> {
  const tags = (await client.adapter.autocomplete(prefix)).filter((t) =>
    isSuggestionAllowed(t.name),
  );
  rememberCounts(client.siteKey, tags);
  return tags;
}

/** Counts for tags; looks up missing ones only when they decide what is sent. */
export async function tagCounts(
  client: SiteClient,
  tags: string[],
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const tag of tags) {
    const hit = countCache.get(`${client.siteKey}:${tag}`);
    if (hit && Date.now() - hit.at < COUNT_TTL_MS) counts[tag] = hit.count;
  }
  if (tags.length <= client.tagLimit) return counts;
  for (const tag of tags.filter((t) => counts[t] === undefined && !t.includes('*')).slice(0, 6)) {
    const found = await autocomplete(client, tag).catch(() => []);
    const exact = found.find((t) => t.name === tag);
    // Unknown tag: no post has it.
    counts[tag] = exact?.count ?? 0;
  }
  return counts;
}

// --- Checking posts ---

export type Verdict = 'ok' | keyof HiddenCounts;

export function emptyHidden(): HiddenCounts {
  return { protected: 0, blacklist: 0, rating: 0, filter: 0, unavailable: 0 };
}

/** The order matters: the mandatory protection always comes first. */
export function screenPost(
  post: BooruPost,
  settings: Pick<BooruSettings, 'ratings' | 'blacklist'>,
  local: readonly LocalCondition[],
): Verdict {
  if (!checkPostProtection(post).ok) return 'protected';
  if (!settings.ratings.includes(post.rating ?? 'explicit')) return 'rating';
  if (!post.fileUrl) return 'unavailable';
  if (isBlacklisted(post, settings.blacklist)) return 'blacklist';
  if (!matchesLocal(post, local)) return 'filter';
  return 'ok';
}

export interface PreparedQuery {
  plan: QueryPlan;
  counts: Record<string, number>;
}

/** Mandatory check of the search, then the split into "site" and "Conbert checks". */
export async function prepareQuery(
  client: SiteClient,
  query: string,
  settings: BooruSettings,
): Promise<PreparedQuery> {
  const tokens = tokenize(query);
  if (!checkQueryProtection(tokens, client.site.api).ok) {
    throw new HttpError(422, 'BOORU_QUERY_REFUSED');
  }
  const counts = await tagCounts(client, parseQuery(query).include);
  const plan = planQuery(query, {
    site: client.site,
    tagLimit: client.tagLimit,
    counts,
    ratings: settings.ratings,
  });
  if (plan.overflow.length > 0) {
    throw new HttpError(422, 'BOORU_TAG_LIMIT', plan.overflow.join(' '));
  }
  return { plan, counts };
}

/** Lists one page, learning a smaller tag limit once if the site refuses. */
export async function listPage(
  ctx: AppContext,
  userId: string,
  client: SiteClient,
  prepared: PreparedQuery,
  query: string,
  settings: BooruSettings,
  page: { limit: number; page?: number; beforeId?: number },
): Promise<{ posts: BooruPost[]; client: SiteClient; prepared: PreparedQuery }> {
  try {
    const posts = await client.adapter.list({ tags: prepared.plan.apiTokens, ...page });
    return { posts, client, prepared };
  } catch (error) {
    if (error instanceof BooruError && error.code === 'BOORU_TAG_LIMIT') {
      if (learnLimit(client.site, client.hasAccount, error)) {
        const again = clientFor(ctx, userId, client.site);
        if (again.tagLimit < client.tagLimit) {
          const replanned = await prepareQuery(again, query, settings);
          const posts = await again.adapter.list({ tags: replanned.plan.apiTokens, ...page });
          return { posts, client: again, prepared: replanned };
        }
      }
    }
    throw error;
  }
}

/** Posts of this user that were loaded before (by site + ID or by MD5). */
export function knownPosts(
  ctx: AppContext,
  userId: string,
  siteId: string,
  posts: readonly BooruPost[],
): Set<number> {
  if (posts.length === 0) return new Set();
  const ids = posts.map((p) => p.id);
  const md5s = posts.map((p) => p.md5).filter((m): m is string => m !== null);
  const byId = ctx.db
    .select({ postId: booruArchive.postId })
    .from(booruArchive)
    .where(
      and(
        eq(booruArchive.userId, userId),
        eq(booruArchive.siteId, siteId),
        inArray(booruArchive.postId, ids),
      ),
    )
    .all()
    .map((r) => r.postId);
  const known = new Set(byId);
  if (md5s.length > 0) {
    const byMd5 = new Set(
      ctx.db
        .select({ md5: booruArchive.md5 })
        .from(booruArchive)
        .where(and(eq(booruArchive.userId, userId), inArray(booruArchive.md5, md5s)))
        .all()
        .map((r) => r.md5),
    );
    for (const p of posts) if (p.md5 && byMd5.has(p.md5)) known.add(p.id);
  }
  return known;
}

// --- Thumbnails: only for posts that passed every check ---

interface Thumb {
  userId: string;
  url: string;
  siteKey: string;
  allowPrivate: boolean;
  headers: Record<string, string>;
  expires: number;
}

const THUMB_TTL_MS = 6 * 60 * 60_000;
const THUMB_MAX_BYTES = 3 * 1024 * 1024;
const thumbs = new Map<string, Thumb>();

export function thumbToken(client: SiteClient, userId: string, url: string | null): string | null {
  if (!url || !checkedUrl(url, client.allowPrivate)) return null;
  if (thumbs.size > 20_000) {
    const now = Date.now();
    for (const [k, t] of thumbs) if (t.expires < now) thumbs.delete(k);
    if (thumbs.size > 20_000) thumbs.clear();
  }
  const token = randomUUID();
  thumbs.set(token, {
    userId,
    url,
    siteKey: client.siteKey,
    allowPrivate: client.allowPrivate,
    headers: client.headers,
    expires: Date.now() + THUMB_TTL_MS,
  });
  return token;
}

export async function fetchThumb(
  userId: string,
  token: string,
): Promise<{ type: string; bytes: Buffer } | null> {
  const thumb = thumbs.get(token);
  if (!thumb || thumb.userId !== userId || thumb.expires < Date.now()) return null;
  const release = await fileSlots(`${thumb.siteKey}:thumbs`, 4).take();
  try {
    const url = checkedUrl(thumb.url, thumb.allowPrivate);
    if (!url) return null;
    const res = await booruRequest(url, {
      siteKey: `${thumb.siteKey}:thumbs`,
      intervalMs: 0,
      headers: { ...thumb.headers, Accept: 'image/*' },
      allowPrivate: thumb.allowPrivate,
      retries: 0,
      timeoutMs: 15_000,
    }).catch(() => null);
    const type = res?.headers.get('content-type') ?? '';
    if (!res || !/^image\/(jpeg|png|webp|gif|avif)/.test(type)) {
      await res?.body?.cancel();
      return null;
    }
    const bytes = await readLimited(res, THUMB_MAX_BYTES);
    return bytes ? { type, bytes } : null;
  } finally {
    release();
  }
}

// --- Search (preview grid) ---

export async function searchPosts(
  ctx: AppContext,
  userId: string,
  siteId: string,
  body: {
    query: string;
    ids?: number[] | undefined;
    before?: number | undefined;
    page?: number | undefined;
    limit: number;
  },
): Promise<BooruSearchResponse> {
  const site = siteFor(ctx, userId, siteId);
  const settings = readSettings(ctx, userId);
  let client = clientFor(ctx, userId, site);
  const hidden = emptyHidden();
  let raw: BooruPost[];
  let plan: QueryPlan;
  let counts: Record<string, number> = {};
  const perPage = Math.min(site.maxPerPage, Math.max(body.limit, 20));
  try {
    if (body.ids && body.ids.length > 0) {
      plan = planQuery('', { site, tagLimit: client.tagLimit, ratings: settings.ratings });
      raw = await client.adapter.byIds(body.ids);
    } else {
      const prepared = await prepareQuery(client, body.query, settings);
      const result = await listPage(ctx, userId, client, prepared, body.query, settings, {
        limit: perPage,
        ...(prepared.plan.idNavigation && body.before !== undefined
          ? { beforeId: body.before }
          : body.page !== undefined
            ? { page: body.page }
            : {}),
      });
      raw = result.posts;
      client = result.client;
      plan = result.prepared.plan;
      counts = result.prepared.counts;
    }
  } catch (error) {
    throw asHttpError(error);
  }
  const known = knownPosts(ctx, userId, site.id, raw);
  const posts: BooruSearchResponse['posts'] = [];
  for (const post of raw) {
    const verdict = screenPost(post, settings, plan.local);
    if (verdict !== 'ok') {
      hidden[verdict] += 1;
      continue;
    }
    posts.push({
      id: post.id,
      thumb: thumbToken(client, userId, post.previewUrl),
      rating: post.rating,
      width: post.width,
      height: post.height,
      ext: post.ext,
      size: post.size,
      score: post.score,
      artists: post.artists,
      tags: post.tags.slice(0, 40),
      postUrl: post.postUrl,
      md5: post.md5,
      known: known.has(post.id),
    });
  }
  const page = body.page ?? 1;
  const lowest = raw.reduce((min, p) => Math.min(min, p.id), Number.MAX_SAFE_INTEGER);
  const end = raw.length === 0 || (body.ids !== undefined && body.ids.length > 0);
  const pageLimitReached =
    !plan.idNavigation && site.pageLimit !== null && page >= site.pageLimit && !end;
  return {
    posts,
    scanned: raw.length,
    hidden,
    next:
      end || pageLimitReached ? null : plan.idNavigation ? { before: lowest } : { page: page + 1 },
    plan: {
      tagLimit: client.tagLimit,
      apiTokens: plan.apiTokens,
      localOnly: plan.localOnly,
      overflow: plan.overflow,
      estimate: estimateScanned(plan, counts),
      idNavigation: plan.idNavigation,
    },
    pageLimitReached,
  };
}
