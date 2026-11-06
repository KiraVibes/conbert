import { BOORU_RATINGS, TAG_CATEGORIES } from './posts';
import { SEARCH_MEDIA, SEARCH_ORDERS } from './query';
import { BOORU_APIS, BUILTIN_SITE_IDS } from './sites';

/** How fast a crawl asks the site. */
export const CRAWL_SPEEDS = ['normal', 'slow', 'very-slow'] as const;
export type CrawlSpeed = (typeof CRAWL_SPEEDS)[number];

/** Time between requests per speed – never below the site's own minimum. */
export const SPEED_INTERVAL_MS: Record<CrawlSpeed, number> = {
  normal: 0,
  slow: 2_000,
  'very-slow': 10_000,
};

export function requestInterval(
  speed: CrawlSpeed,
  siteMinimumMs: number,
  customMs?: number,
): number {
  return Math.max(siteMinimumMs, customMs ?? SPEED_INTERVAL_MS[speed]);
}

export const DEFAULT_POST_LIMIT = 100;
/** From here on the UI asks "are you sure?". */
export const POST_LIMIT_HINT = 1000;
export const MAX_POST_LIMIT = 50_000;
/** Files of one site loaded at the same time. */
export const PARALLEL_DOWNLOADS_PER_SITE = 2;

/** Extra files next to each picture, or keywords right inside it. */
export const SIDECAR_KINDS = ['json', 'txt', 'embed'] as const;
export type SidecarKind = (typeof SIDECAR_KINDS)[number];

/** Optional night window, e.g. 1–7 o'clock (server time). */
export interface TimeWindow {
  fromHour: number;
  toHour: number;
}

export function insideWindow(window: TimeWindow | null | undefined, date: Date): boolean {
  if (!window) return true;
  const h = date.getHours();
  return window.fromHour <= window.toHour
    ? h >= window.fromHour && h < window.toHour
    : h >= window.fromHour || h < window.toHour;
}

/** Milliseconds until the window opens again (0 = open now). */
export function msUntilWindow(window: TimeWindow | null | undefined, date: Date): number {
  if (!window || insideWindow(window, date)) return 0;
  const next = new Date(date);
  next.setMinutes(0, 0, 0);
  next.setHours(window.fromHour);
  if (next <= date) next.setDate(next.getDate() + 1);
  return next.getTime() - date.getTime();
}

/** Subscriptions: how often new posts are looked for. */
export const SUBSCRIPTION_INTERVALS_HOURS = [1, 6, 12, 24, 72, 168] as const;
export const DEFAULT_SUBSCRIPTION_HOURS = 24;

/** All i18n keys the booru downloader builds from these lists – checked by a test. */
export function booruI18nKeys(): string[] {
  return [
    ...BOORU_RATINGS.flatMap((r) => [`booru.ratings.${r}`, `booru.ratings.${r}Help`]),
    ...TAG_CATEGORIES.map((c) => `booru.categories.${c}`),
    ...SEARCH_ORDERS.map((o) => `booru.order.${o}`),
    ...SEARCH_MEDIA.map((m) => `booru.media.${m}`),
    ...CRAWL_SPEEDS.flatMap((s) => [`booru.speed.${s}`, `booru.speed.${s}Help`]),
    ...SIDECAR_KINDS.flatMap((k) => [`booru.sidecar.${k}`, `booru.sidecar.${k}Help`]),
    ...BOORU_APIS.map((a) => `booru.api.${a}`),
    ...BUILTIN_SITE_IDS.map((s) => `booru.siteHelp.${s}`),
    ...SUBSCRIPTION_INTERVALS_HOURS.map((h) => `booru.subs.every.h${h}`),
    ...['queued', 'running', 'waiting', 'paused', 'done', 'error', 'cancelled'].map(
      (s) => `booru.jobs.status.${s}`,
    ),
  ];
}
