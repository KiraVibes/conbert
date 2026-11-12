import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  autocompleteResponseSchema,
  booruJobResponseSchema,
  booruJobsResponseSchema,
  booruSearchResponseSchema,
  booruSettingsSchema,
  booruSiteSchema,
  booruSitesResponseSchema,
  resolveUrlResponseSchema,
  subscriptionSchema,
  subscriptionsResponseSchema,
  type BooruJobDto,
  type BooruSettings,
  type CreateBooruJobRequest,
  type SubscriptionRequest,
} from '@conbert/schemas';
import { ApiRequestError, apiDelete, apiGet, apiPost, apiPut } from '@/lib/api';
import { subscribeToBooru } from '@/lib/job-socket';
import { markTaken, takenFiles } from '@/features/downloader/downloader-api';
import { useCan } from '@/features/auth/use-auth';

export const BOORU_SITES_KEY = ['booru-sites'] as const;
export const BOORU_SETTINGS_KEY = ['booru-settings'] as const;
export const BOORU_JOBS_KEY = ['booru-jobs'] as const;
/** Removes every finished crawl from the list (running, waiting and paused ones stay). */
export const clearFinishedBooruJobs = () => apiDelete('/api/booru/jobs');

const settingsResponse = z.object({ settings: booruSettingsSchema });

export function useBooruSites() {
  const allowed = useCan('booru');
  return useQuery({
    queryKey: BOORU_SITES_KEY,
    enabled: allowed,
    queryFn: ({ signal }) => apiGet('/api/booru/sites', booruSitesResponseSchema, { signal }),
    select: (data) => data.sites,
  });
}

export function useBooruSettings() {
  const allowed = useCan('booru');
  return useQuery({
    queryKey: BOORU_SETTINGS_KEY,
    enabled: allowed,
    queryFn: ({ signal }) => apiGet('/api/booru/settings', settingsResponse, { signal }),
    select: (data) => data.settings,
  });
}

export type SettingsChange = Partial<Omit<BooruSettings, 'locked'>> & { pin?: string };

export const saveBooruSettings = (change: SettingsChange) =>
  apiPut('/api/booru/settings', change, settingsResponse).then((r) => r.settings);
export const lockBooru = (pin: string) =>
  apiPost('/api/booru/settings/lock', { pin }, settingsResponse).then((r) => r.settings);
export const unlockBooru = (pin: string) => apiDelete('/api/booru/settings/lock', { pin });

export const saveAccount = (
  siteId: string,
  body: { username: string; apiKey: string; tagLimit: number | null },
) => apiPut(`/api/booru/accounts/${siteId}`, body);
export const deleteAccount = (siteId: string) => apiDelete(`/api/booru/accounts/${siteId}`);
export const addInstance = (body: { name: string; api: string; baseUrl: string }) =>
  apiPost('/api/booru/instances', body, z.object({ site: booruSiteSchema }));
export const removeInstance = (siteId: string) => apiDelete(`/api/booru/instances/${siteId}`);

export const autocomplete = (siteId: string, q: string, signal?: AbortSignal) =>
  apiGet(
    `/api/booru/${siteId}/autocomplete?q=${encodeURIComponent(q)}`,
    autocompleteResponseSchema,
    signal ? { signal } : undefined,
  ).then((r) => r.tags);

export const searchBooru = (
  siteId: string,
  body: { query?: string; ids?: number[]; before?: number; page?: number; limit?: number },
) => apiPost(`/api/booru/${siteId}/search`, body, booruSearchResponseSchema);

export const resolvePostUrl = (url: string) =>
  apiPost('/api/booru/resolve', { url }, resolveUrlResponseSchema);

export const startBooruJob = (siteId: string, body: CreateBooruJobRequest) =>
  apiPost(`/api/booru/${siteId}/jobs`, body, booruJobResponseSchema).then((r) => r.job);
export const pauseBooruJob = (id: string) =>
  apiPost(`/api/booru/jobs/${id}/pause`, {}, booruJobResponseSchema);
export const resumeBooruJob = (id: string) =>
  apiPost(`/api/booru/jobs/${id}/resume`, {}, booruJobResponseSchema);
export const removeBooruJob = (id: string) => apiDelete(`/api/booru/jobs/${id}`);

/** The own crawls, kept live over the WebSocket (polling as a fallback). */
export function useBooruJobs(onUpdate?: (job: BooruJobDto) => void) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: BOORU_JOBS_KEY,
    queryFn: ({ signal }) => apiGet('/api/booru/jobs', booruJobsResponseSchema, { signal }),
    select: (data) => data.jobs,
    refetchInterval: (q) =>
      q.state.data?.jobs.some((j) => j.status === 'queued' || j.status === 'running')
        ? 5_000
        : false,
  });
  useEffect(
    () =>
      subscribeToBooru((job) => {
        queryClient.setQueryData<{ jobs: BooruJobDto[] }>(BOORU_JOBS_KEY, (old) => {
          const list = old?.jobs ?? [];
          return {
            jobs: list.some((j) => j.id === job.id)
              ? list.map((j) => (j.id === job.id ? job : j))
              : [job, ...list],
          };
        });
        onUpdate?.(job);
      }),
    [queryClient, onUpdate],
  );
  return query;
}

const jobFilesSchema = z.object({
  files: z.array(
    z.object({
      postId: z.number(),
      name: z.string(),
      fileId: z.string().nullable(),
      size: z.number(),
    }),
  ),
});

/** Loads the files of a crawl into the browser – each file only once. */
export async function takeBooruFiles(jobId: string): Promise<File[]> {
  const { files } = await apiGet(`/api/booru/jobs/${jobId}/files`, jobFilesSchema);
  const taken = takenFiles();
  const fresh = files.filter((f) => f.fileId && !taken.has(f.fileId));
  fresh.forEach((f) => markTaken(f.fileId ?? ''));
  return Promise.all(
    fresh.map(async (f) => {
      const response = await fetch(`/api/files/${f.fileId}/content`, {
        credentials: 'same-origin',
      });
      if (!response.ok) throw new ApiRequestError(response.status, 'errors.resultGone');
      const blob = await response.blob();
      void apiDelete(`/api/files/${f.fileId}`).catch(() => undefined);
      return new File([blob], f.name, { type: blob.type });
    }),
  );
}

export const SUBSCRIPTIONS_KEY = ['booru-subscriptions'] as const;

export function useSubscriptions() {
  const allowed = useCan('booru');
  return useQuery({
    queryKey: SUBSCRIPTIONS_KEY,
    enabled: allowed,
    queryFn: ({ signal }) => apiGet('/api/subscriptions', subscriptionsResponseSchema, { signal }),
    select: (data) => data.subscriptions,
    refetchInterval: 60_000,
  });
}

const subscriptionResponse = z.object({ subscription: subscriptionSchema });

export const createSubscription = (body: SubscriptionRequest) =>
  apiPost('/api/subscriptions', body, subscriptionResponse).then((r) => r.subscription);
export const updateSubscription = (id: string, body: SubscriptionRequest) =>
  apiPut(`/api/subscriptions/${id}`, body, subscriptionResponse).then((r) => r.subscription);
export const deleteSubscription = (id: string) => apiDelete(`/api/subscriptions/${id}`);
export const checkSubscription = (id: string) =>
  apiPost(
    `/api/subscriptions/${id}/check`,
    {},
    z.object({ started: z.boolean(), subscription: subscriptionSchema }),
  );
