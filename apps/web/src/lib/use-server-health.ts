import { useQuery } from '@tanstack/react-query';
import { healthResponseSchema } from '@conbert/schemas';
import { apiGet } from './api';

/** Polls GET /api/health. `isSuccess` = server reachable. */
export function useServerHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: ({ signal }) => apiGet('/api/health', healthResponseSchema, { signal }),
    refetchInterval: 30_000,
    retry: 1,
  });
}
