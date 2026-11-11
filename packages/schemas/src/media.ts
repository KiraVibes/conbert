import { z } from 'zod';

// --- Media index & swipe game ---

export const swipeModeSchema = z.enum(['normal', 'favorites']);
export type SwipeMode = z.infer<typeof swipeModeSchema>;

/** deletePost: every page of the card's Pixiv work (same folder, same number) goes. */
export const swipeActionSchema = z.enum([
  'delete',
  'keep',
  'favorite',
  'unfavorite',
  'premium',
  'deletePost',
]);
export type SwipeAction = z.infer<typeof swipeActionSchema>;

/** Why the swipe game can't use the default location (null = it can). */
export const mediaProblemSchema = z.enum(['no-default', 'not-source', 'not-target']).nullable();

export const mediaStatusSchema = z.object({
  target: z.object({ id: z.string(), name: z.string() }).nullable(),
  problem: mediaProblemSchema,
  /** Files in the index (all kinds). */
  items: z.number().int(),
  /** Pictures, GIFs and videos not sorted yet. */
  unsorted: z.number().int(),
  favorites: z.number().int(),
  lastSyncAt: z.string().nullable(),
  syncing: z.boolean(),
  /** Last sync: files read so far / added. */
  progress: z.object({ seen: z.number().int(), added: z.number().int() }).nullable(),
  syncError: z.string().nullable(),
});
export type MediaStatus = z.infer<typeof mediaStatusSchema>;

export const swipeItemSchema = z.object({
  id: z.string(),
  targetId: z.string(),
  path: z.string(),
  name: z.string(),
  size: z.number().int(),
  kind: z.enum(['image', 'gif', 'video']),
  status: z.enum(['present', 'kept', 'favorite', 'premium']),
});
export type SwipeItem = z.infer<typeof swipeItemSchema>;

export interface SwipeSource {
  /** "Instagram", "Instagram/KawaiiQueen", "Gelbooru/ear_blowing". */
  path: string;
  name: string;
  count: number;
  children: SwipeSource[];
}

export const swipeSourceSchema: z.ZodType<SwipeSource> = z.lazy(() =>
  z.object({
    path: z.string(),
    name: z.string(),
    count: z.number().int(),
    children: z.array(swipeSourceSchema),
  }),
);

/** Folders as JSON list in a query string; empty = everything. */
const foldersQuerySchema = z
  .string()
  .optional()
  .transform((v, ctx) => {
    if (!v) return [] as string[];
    try {
      const list = z.array(z.string().max(500)).max(200).parse(JSON.parse(v));
      return list;
    } catch {
      ctx.addIssue({ code: 'custom', message: 'folders must be a JSON list' });
      return z.NEVER;
    }
  });

export const swipeNextQuerySchema = z.object({
  mode: swipeModeSchema.default('normal'),
  folders: foldersQuerySchema,
  /** Also already sorted items. */
  sorted: z.enum(['0', '1']).default('0'),
  count: z.coerce.number().int().min(1).max(20).default(5),
  /** Items the browser still holds – not sent again. */
  exclude: z.string().optional(),
});

export const swipeActionRequestSchema = z.object({
  itemId: z.string().min(1).max(100),
  action: swipeActionSchema,
});

export const swipeOutcomeSchema = z.object({
  itemId: z.string(),
  name: z.string(),
  action: swipeActionSchema,
  ok: z.boolean(),
  /** API error code when it failed. */
  error: z.string().nullable(),
});
export type SwipeOutcome = z.infer<typeof swipeOutcomeSchema>;

export const swipeStateSchema = z.object({
  /** Actions that can still be undone (at most 5). */
  pending: z.number().int(),
  /** What was carried out just now. */
  done: z.array(swipeOutcomeSchema),
});
export type SwipeState = z.infer<typeof swipeStateSchema>;

// --- Tidying up old folders ---

export const reorganizeMoveSchema = z.object({
  from: z.string(),
  to: z.string(),
  /** Where the assignment comes from: a download, a subscription, a booru folder. */
  reason: z.enum(['download', 'feed', 'booru']),
});
export type ReorganizeMove = z.infer<typeof reorganizeMoveSchema>;

export const reorganizePlanSchema = z.object({
  moves: z.array(reorganizeMoveSchema),
  /** Root folders Conbert can't assign (they stay where they are). */
  unknown: z.array(z.string()),
  /** Stray tool caches (gallery-dl's cache.sqlite3) that can be deleted. */
  leftovers: z.array(z.string()),
  /** Pixiv works with several pages lying loose: they get a folder each ("<folder>/<id>/"). */
  posts: z.array(z.object({ folder: z.string(), id: z.string(), pages: z.number().int() })),
});
export type ReorganizePlan = z.infer<typeof reorganizePlanSchema>;

export const reorganizeRequestSchema = z.object({
  moves: z.array(z.object({ from: z.string().max(500), to: z.string().max(500) })).max(2000),
  leftovers: z.array(z.string().max(1000)).max(5000),
  posts: z
    .array(z.object({ folder: z.string().max(500), id: z.string().regex(/^\d{1,20}$/) }))
    .max(50_000)
    .default([]),
});

export const reorganizeResultSchema = z.object({
  moved: z.number().int(),
  /** Pixiv works that got their own folder. */
  posts: z.number().int().default(0),
  deleted: z.number().int(),
  failed: z.array(z.object({ path: z.string(), error: z.string() })),
});
export type ReorganizeResult = z.infer<typeof reorganizeResultSchema>;

// --- Similar pictures ---
export const similarityLevelSchema = z.enum(['strict', 'normal', 'loose']);

export const similarScanSchema = z.object({
  running: z.boolean(),
  /** Pictures fingerprinted in this run / still to do. */
  done: z.number().int(),
  total: z.number().int(),
  failed: z.number().int(),
  error: z.string().nullable(),
});
export type SimilarScan = z.infer<typeof similarScanSchema>;

export const similarItemSchema = swipeItemSchema.extend({
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  /** Bits that differ from the best picture of the group (0 = looks the same). */
  distance: z.number().int(),
});
export type SimilarItem = z.infer<typeof similarItemSchema>;

export const similarResponseSchema = z.object({
  scan: similarScanSchema,
  /** Pictures in the chosen folders without a fingerprint yet. */
  unhashed: z.number().int(),
  hashed: z.number().int(),
  /** Best picture first in each group. */
  groups: z.array(z.array(similarItemSchema)),
});
export type SimilarResponse = z.infer<typeof similarResponseSchema>;

export const similarQuerySchema = z.object({
  level: similarityLevelSchema.default('normal'),
  folders: foldersQuerySchema,
});

export const similarScanRequestSchema = z.object({
  folders: z.array(z.string().max(500)).max(200).default([]),
});
