import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  feedResponseSchema,
  feedSchema,
  feedsResponseSchema,
  type CreateFeedRequest,
  type FeedDto,
  type UpdateFeedRequest,
} from '@conbert/schemas';
import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/api';
import { subscribeToDownloads } from '@/lib/job-socket';
import { useCan } from '@/features/auth/use-auth';

export const FEEDS_KEY = ['downloader-feeds'] as const;

/** Profiles, channels and threads the server checks regularly. */
export function useFeeds() {
  const queryClient = useQueryClient();
  const allowed = useCan('downloader');
  const query = useQuery({
    queryKey: FEEDS_KEY,
    enabled: allowed,
    queryFn: ({ signal }) => apiGet('/api/downloader/feeds', feedsResponseSchema, { signal }),
    select: (data) => data.feeds,
    // Times ("next check in …") move on; a running check ends some time.
    refetchInterval: (q) => (q.state.data?.feeds.some((f) => f.checking) ? 5_000 : 60_000),
  });
  // A check that ends changes the numbers right away.
  useEffect(
    () =>
      subscribeToDownloads((download) => {
        if (download.feedId && download.status !== 'queued' && download.status !== 'running') {
          void queryClient.invalidateQueries({ queryKey: FEEDS_KEY });
        }
      }),
    [queryClient],
  );
  return query;
}

export const createFeed = (body: CreateFeedRequest) =>
  apiPost('/api/downloader/feeds', body, feedResponseSchema).then((r) => r.feed);

export const updateFeed = (id: string, body: UpdateFeedRequest) =>
  apiPut(`/api/downloader/feeds/${id}`, body, feedResponseSchema).then((r) => r.feed);

export const deleteFeed = (id: string) => apiDelete(`/api/downloader/feeds/${id}`);

export const checkFeed = (id: string) =>
  apiPost(
    `/api/downloader/feeds/${id}/check`,
    {},
    z.object({ started: z.boolean(), waiting: z.boolean().default(false), feed: feedSchema }),
  );

/** As the API wants it again (for changes). */
export function feedBody(feed: FeedDto, patch: Partial<FeedDto> = {}): UpdateFeedRequest {
  const f = { ...feed, ...patch };
  return {
    name: f.name,
    intervalMinutes: f.intervalMinutes,
    paused: f.paused,
    quality: f.quality,
    parts: f.parts,
    ...(f.pixiv && { pixiv: f.pixiv }),
    limit: f.limit,
    sleepSeconds: f.sleepSeconds,
    targetIds: f.targetIds,
    toList: f.toList,
    keepOnServer: f.keepOnServer,
    after: f.after,
    notify: f.notify,
  };
}
