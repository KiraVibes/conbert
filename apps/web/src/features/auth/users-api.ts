import { useQuery } from '@tanstack/react-query';
import { usersResponseSchema } from '@conbert/schemas';
import { apiGet } from '@/lib/api';

export const USERS_KEY = ['users'] as const;

/** All accounts (administrators only). */
export function useUsers() {
  return useQuery({
    queryKey: USERS_KEY,
    queryFn: ({ signal }) => apiGet('/api/users', usersResponseSchema, { signal }),
  });
}
