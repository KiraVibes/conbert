import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  logPageSchema,
  logSettingsResponseSchema,
  type LogArea,
  type LogLevel,
  type LogSettings,
} from '@conbert/schemas';
import { apiDelete, apiGet, apiPut } from '@/lib/api';

export const LOG_SETTINGS_KEY = ['log-settings'] as const;
const LOG_KEY = ['log'] as const;

export interface LogFilter {
  level: LogLevel;
  area: LogArea | null;
  q: string;
}

export function useLogSettings(enabled: boolean) {
  return useQuery({
    queryKey: LOG_SETTINGS_KEY,
    enabled,
    queryFn: ({ signal }) =>
      apiGet('/api/admin/logs/settings', logSettingsResponseSchema, { signal }),
  });
}

/** The newest entries first; "load older" fetches the next page. */
export function useLog(filter: LogFilter, live: boolean) {
  return useInfiniteQuery({
    queryKey: [...LOG_KEY, filter],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ level: filter.level, limit: '100' });
      if (filter.area) params.set('area', filter.area);
      if (filter.q.trim()) params.set('q', filter.q.trim());
      if (pageParam) params.set('before', pageParam);
      return apiGet(`/api/admin/logs?${params.toString()}`, logPageSchema, { signal });
    },
    getNextPageParam: (page) => page.next,
    // Live: only while just the newest page is shown, so reading older ones stays calm.
    refetchInterval: (query) => (live && (query.state.data?.pages.length ?? 0) <= 1 ? 5000 : false),
  });
}

export function useLogMutations() {
  const queryClient = useQueryClient();
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: LOG_SETTINGS_KEY });
    await queryClient.invalidateQueries({ queryKey: LOG_KEY });
  };
  return {
    save: useMutation({
      mutationFn: (body: LogSettings) =>
        apiPut('/api/admin/logs/settings', body, logSettingsResponseSchema),
      onSuccess: async (data) => {
        queryClient.setQueryData(LOG_SETTINGS_KEY, data);
        await queryClient.invalidateQueries({ queryKey: LOG_KEY });
      },
    }),
    clear: useMutation({ mutationFn: () => apiDelete('/api/admin/logs'), onSuccess: refresh }),
  };
}
