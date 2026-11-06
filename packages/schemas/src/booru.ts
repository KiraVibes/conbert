import { z } from 'zod';
import { afterDownloadSchema } from './workflows';
import {
  BOORU_APIS,
  BOORU_RATINGS,
  CRAWL_SPEEDS,
  DEFAULT_FILE_PATTERN,
  DEFAULT_FOLDER_PATTERN,
  DEFAULT_POST_LIMIT,
  MAX_BLACKLIST_LINES,
  MAX_PATTERN_LENGTH,
  MAX_POST_LIMIT,
  MAX_QUERY_LENGTH,
  SIDECAR_KINDS,
  SUBSCRIPTION_INTERVALS_HOURS,
  TAG_CATEGORIES,
} from '@conbert/core';

export const booruApiSchema = z.enum(BOORU_APIS);
export const booruRatingSchema = z.enum(BOORU_RATINGS);
export const siteIdSchema = z.string().regex(/^(?:[a-z0-9]{2,20}|custom-[0-9a-f-]{36})$/);

// --- Sites, own instances, accounts ---

export const booruSiteSchema = z.object({
  id: z.string(),
  name: z.string(),
  api: booruApiSchema,
  baseUrl: z.string(),
  safeOnly: z.boolean(),
  custom: z.boolean(),
  /** Tags per search with the stored account (or without one). */
  tagLimit: z.number(),
  pageLimit: z.number().nullable(),
  /** "page-b": no page limit; "id-tag": no page limit, but the ID counts as a tag. */
  idNavigation: z.enum(['page-b', 'id-tag']),
  /** Username + API key can be stored. */
  accounts: z.boolean(),
  /** The site only answers with an account (Gelbooru). */
  needsAccount: z.boolean(),
  /** A username + API key is stored (the key itself never comes back). */
  account: z.object({ username: z.string(), tagLimit: z.number().nullable() }).nullable(),
});
export type BooruSite = z.infer<typeof booruSiteSchema>;
export const booruSitesResponseSchema = z.object({ sites: z.array(booruSiteSchema) });

export const createInstanceRequestSchema = z.object({
  name: z.string().trim().min(1).max(60),
  api: booruApiSchema,
  baseUrl: z.string().trim().url().max(300),
});

export const saveAccountRequestSchema = z.object({
  username: z.string().trim().min(1).max(100),
  /** Empty = keep the stored key (only the username or the limit changes). */
  apiKey: z.string().trim().max(300).default(''),
  /** Own tag limit (a paid account allows more) – null = the site's default. */
  tagLimit: z.number().int().min(1).max(100).nullable().default(null),
});

// --- Settings (enforced on the server) ---

export const booruSettingsSchema = z.object({
  /** Ratings that are shown and loaded; more than "general" needs the age confirmation. */
  ratings: z.array(booruRatingSchema).min(1),
  ageConfirmed: z.boolean(),
  /** A PIN protects the rating choice. */
  locked: z.boolean(),
  /** Own blacklist, one rule per line (all tags of a line must be present). */
  blacklist: z.array(z.string().max(200)).max(MAX_BLACKLIST_LINES),
  filePattern: z.string().max(MAX_PATTERN_LENGTH),
  folderPattern: z.string().max(MAX_PATTERN_LENGTH),
  sidecars: z.array(z.enum(SIDECAR_KINDS)),
  /** Smaller "sample" version instead of the original. */
  sample: z.boolean(),
});
export type BooruSettings = z.infer<typeof booruSettingsSchema>;
export const DEFAULT_BOORU_SETTINGS: BooruSettings = {
  ratings: ['general'],
  ageConfirmed: false,
  locked: false,
  blacklist: [],
  filePattern: DEFAULT_FILE_PATTERN,
  folderPattern: DEFAULT_FOLDER_PATTERN,
  sidecars: [],
  sample: false,
};

export const updateBooruSettingsRequestSchema = z.object({
  ratings: z.array(booruRatingSchema).min(1).optional(),
  /** "I am of age" – required for anything beyond "general". */
  ageConfirmed: z.boolean().optional(),
  blacklist: z.array(z.string().trim().max(200)).max(MAX_BLACKLIST_LINES).optional(),
  filePattern: z.string().trim().max(MAX_PATTERN_LENGTH).optional(),
  folderPattern: z.string().trim().max(MAX_PATTERN_LENGTH).optional(),
  sidecars: z.array(z.enum(SIDECAR_KINDS)).max(SIDECAR_KINDS.length).optional(),
  sample: z.boolean().optional(),
  /** Needed when a PIN is set and the ratings change. */
  pin: z.string().max(100).optional(),
});

export const resolveUrlRequestSchema = z.object({ url: z.string().trim().min(1).max(2000) });
export const resolveUrlResponseSchema = z.object({ siteId: z.string(), postId: z.number() });

export const pinRequestSchema = z.object({ pin: z.string().min(4).max(100) });

// --- Autocomplete & search ---

export const tagSuggestionSchema = z.object({
  name: z.string(),
  count: z.number(),
  category: z.enum(TAG_CATEGORIES),
});
export type TagSuggestion = z.infer<typeof tagSuggestionSchema>;
export const autocompleteResponseSchema = z.object({ tags: z.array(tagSuggestionSchema) });

const querySchema = z.string().trim().max(MAX_QUERY_LENGTH);

export const booruSearchRequestSchema = z.object({
  query: querySchema.default(''),
  /** Single posts by ID (from a link) instead of a search. */
  ids: z.array(z.number().int().positive()).max(100).optional(),
  /** Next page: posts below this ID, or a page number. */
  before: z.number().int().positive().optional(),
  page: z.number().int().min(1).max(100_000).optional(),
  limit: z.number().int().min(1).max(200).default(60),
});

export const booruPostSchema = z.object({
  id: z.number(),
  /** For the thumbnail: GET /api/booru/thumbs/:thumb (null = none). */
  thumb: z.string().nullable(),
  rating: booruRatingSchema.nullable(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  ext: z.string().nullable(),
  size: z.number().nullable(),
  score: z.number().nullable(),
  artists: z.array(z.string()),
  tags: z.array(z.string()),
  postUrl: z.string(),
  md5: z.string().nullable(),
  /** Already loaded before (download archive). */
  known: z.boolean(),
});
export type BooruPostDto = z.infer<typeof booruPostSchema>;

export const hiddenCountsSchema = z.object({
  /** Mandatory protection (never shown, no details). */
  protected: z.number(),
  blacklist: z.number(),
  rating: z.number(),
  /** Conditions Conbert checked itself (tag limit, dates …). */
  filter: z.number(),
  /** No file (deleted, or only for logged-in users). */
  unavailable: z.number(),
});
export type HiddenCounts = z.infer<typeof hiddenCountsSchema>;

export const queryPlanSchema = z.object({
  tagLimit: z.number(),
  apiTokens: z.array(z.string()),
  localOnly: z.array(z.string()),
  overflow: z.array(z.string()),
  /** Rough number of posts to look through (null = unknown). */
  estimate: z.number().nullable(),
  idNavigation: z.boolean(),
});
export type QueryPlanDto = z.infer<typeof queryPlanSchema>;

export const booruSearchResponseSchema = z.object({
  posts: z.array(booruPostSchema),
  /** Posts the site returned on this page (before filtering). */
  scanned: z.number(),
  hidden: hiddenCountsSchema,
  next: z.object({ before: z.number().optional(), page: z.number().optional() }).nullable(),
  plan: queryPlanSchema,
  /** The page limit was reached – an account or the slow mode helps. */
  pageLimitReached: z.boolean(),
});
export type BooruSearchResponse = z.infer<typeof booruSearchResponseSchema>;

// --- Crawl jobs ---

const timeWindowSchema = z
  .object({ fromHour: z.number().int().min(0).max(23), toHour: z.number().int().min(0).max(23) })
  .refine((w) => w.fromHour !== w.toHour, { message: 'window' });

export const createBooruJobRequestSchema = z
  .object({
    query: querySchema.default(''),
    /** Chosen posts from the preview grid (instead of the whole search). */
    postIds: z.array(z.number().int().positive()).max(5000).optional(),
    limit: z.number().int().min(1).max(MAX_POST_LIMIT).default(DEFAULT_POST_LIMIT),
    speed: z.enum(CRAWL_SPEEDS).default('normal'),
    window: timeWindowSchema.nullable().default(null),
    filePattern: z.string().trim().max(MAX_PATTERN_LENGTH).optional(),
    folderPattern: z.string().trim().max(MAX_PATTERN_LENGTH).optional(),
    sidecars: z.array(z.enum(SIDECAR_KINDS)).max(SIDECAR_KINDS.length).optional(),
    sample: z.boolean().optional(),
    targetIds: z.array(z.string().uuid()).max(10).default([]),
    toList: z.boolean().default(false),
    workflowId: z.string().uuid().nullable().default(null),
    /** "Danach automatisch …": a saved workflow or a quick action. */
    after: afterDownloadSchema,
  })
  .refine((r) => r.toList || r.targetIds.length > 0, {
    message: 'destination',
    path: ['targetIds'],
  });
export type CreateBooruJobRequest = z.input<typeof createBooruJobRequestSchema>;

export const BOORU_JOB_STATUSES = [
  'queued',
  'running',
  /** Waiting for the night window or after "too many requests". */
  'waiting',
  'paused',
  'done',
  'error',
  'cancelled',
] as const;

export const booruJobFileSchema = z.object({
  postId: z.number(),
  name: z.string(),
  ext: z.string(),
  size: z.number(),
  /** Still in the server's upload store (for the conversion list). */
  fileId: z.string().nullable(),
  thumb: z.string().nullable(),
});

export const booruJobSchema = z.object({
  id: z.string(),
  siteId: z.string(),
  siteName: z.string(),
  query: z.string(),
  status: z.enum(BOORU_JOB_STATUSES),
  speed: z.enum(CRAWL_SPEEDS),
  limit: z.number(),
  /** Posts looked at, matching, loaded, skipped as already known. */
  scanned: z.number(),
  matched: z.number(),
  downloaded: z.number(),
  duplicates: z.number(),
  failed: z.number(),
  hidden: hiddenCountsSchema,
  /** Seconds left (rough), while running. */
  etaSeconds: z.number().nullable(),
  /** When a waiting crawl goes on. */
  resumeAt: z.string().nullable(),
  /** The newest loaded files (for the preview grid during the crawl). */
  recent: z.array(booruJobFileSchema),
  toList: z.boolean(),
  savedTo: z.array(z.string()),
  subscriptionId: z.string().nullable(),
  error: z.object({ messageKey: z.string(), details: z.string().optional() }).nullable(),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
});
export type BooruJobDto = z.infer<typeof booruJobSchema>;
export const booruJobResponseSchema = z.object({ job: booruJobSchema });
export const booruJobsResponseSchema = z.object({ jobs: z.array(booruJobSchema) });

// --- Subscriptions ---

export const subscriptionRequestSchema = z.object({
  siteId: siteIdSchema,
  query: querySchema.min(1),
  name: z.string().trim().max(80).default(''),
  intervalHours: z
    .number()
    .int()
    .refine((h) => (SUBSCRIPTION_INTERVALS_HOURS as readonly number[]).includes(h))
    .default(24),
  paused: z.boolean().default(false),
  /** Most new posts per check. */
  limit: z.number().int().min(1).max(MAX_POST_LIMIT).default(DEFAULT_POST_LIMIT),
  targetIds: z.array(z.string().uuid()).max(10).default([]),
  workflowId: z.string().uuid().nullable().default(null),
  notify: z.boolean().default(true),
});
export type SubscriptionRequest = z.input<typeof subscriptionRequestSchema>;

export const subscriptionSchema = z.object({
  id: z.string(),
  siteId: z.string(),
  siteName: z.string(),
  query: z.string(),
  name: z.string(),
  intervalHours: z.number(),
  paused: z.boolean(),
  limit: z.number(),
  targetIds: z.array(z.string()),
  workflowId: z.string().nullable(),
  notify: z.boolean(),
  lastCheckAt: z.string().nullable(),
  nextCheckAt: z.string().nullable(),
  /** New posts found by the last check. */
  lastNew: z.number(),
  totalLoaded: z.number(),
  lastError: z.string().nullable(),
  createdAt: z.string(),
});
export type SubscriptionDto = z.infer<typeof subscriptionSchema>;
export const subscriptionsResponseSchema = z.object({
  subscriptions: z.array(subscriptionSchema),
});
