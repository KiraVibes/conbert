import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import {
  mediaStatusSchema,
  reorganizePlanSchema,
  reorganizeResultSchema,
  swipeItemSchema,
  swipeSourceSchema,
  swipeStateSchema,
  type ReorganizePlan,
  type SwipeAction,
  type SwipeItem,
  type SwipeMode,
} from '@conbert/schemas';
import { apiGet, apiPost } from '@/lib/api';

export const MEDIA_STATUS_KEY = ['media-status'] as const;

/** The index's state; asks again every second while a sync runs. */
export function useMediaStatus() {
  return useQuery({
    queryKey: MEDIA_STATUS_KEY,
    queryFn: () => apiGet('/api/media/status', mediaStatusSchema),
    refetchInterval: (query) => (query.state.data?.syncing ? 1000 : false),
  });
}

export const startSync = () => apiPost('/api/media/sync', {}, mediaStatusSchema);

export function useSwipeSources(mode: SwipeMode, sorted: boolean, enabled: boolean) {
  return useQuery({
    queryKey: ['swipe-sources', mode, sorted],
    queryFn: () =>
      apiGet(
        `/api/swipe/sources?mode=${mode}&sorted=${sorted ? '1' : '0'}`,
        z.object({ sources: z.array(swipeSourceSchema) }),
      ),
    enabled,
  });
}

const nextSchema = z.object({
  items: z.array(swipeItemSchema),
  pending: z.number().int(),
  /** Every favourite was seen: they come again, freshly shuffled. */
  newRound: z.boolean().default(false),
});

export function fetchNext(query: {
  mode: SwipeMode;
  folders: string[];
  sorted: boolean;
  exclude: string[];
  count?: number;
}) {
  const params = new URLSearchParams({
    mode: query.mode,
    sorted: query.sorted ? '1' : '0',
    count: String(query.count ?? 6),
  });
  if (query.folders.length > 0) params.set('folders', JSON.stringify(query.folders));
  if (query.exclude.length > 0) params.set('exclude', query.exclude.join(','));
  return apiGet(`/api/swipe/next?${params.toString()}`, nextSchema);
}

export const sendSwipe = (itemId: string, action: SwipeAction) =>
  apiPost('/api/swipe/action', { itemId, action }, swipeStateSchema);

export const undoSwipe = () =>
  apiPost(
    '/api/swipe/undo',
    {},
    z.object({
      item: swipeItemSchema.nullable(),
      action: z.string().nullable(),
      pending: z.number().int(),
    }),
  );

export const flushSwipes = () => apiPost('/api/swipe/flush', {}, swipeStateSchema);

export const planReorganize = () => apiGet('/api/media/reorganize', reorganizePlanSchema);

export const applyReorganize = (body: {
  moves: { from: string; to: string }[];
  leftovers: string[];
}) => apiPost('/api/media/reorganize', body, reorganizeResultSchema);

export type { ReorganizePlan, SwipeItem };

/** The card's file, straight from the storage location (the browser caches it). */
export function cardUrl(item: SwipeItem): string {
  return `/api/targets/${item.targetId}/file?path=${encodeURIComponent(item.path)}`;
}
