import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  authStatusResponseSchema,
  userResponseSchema,
  type Feature,
  type LoginRequest,
  type SetupRequest,
  type UserDto,
} from '@conbert/schemas';
import { apiGet, apiPost, onUnauthorized } from '@/lib/api';

export const AUTH_QUERY_KEY = ['auth', 'status'] as const;

/** Who is signed in, and whether the first-start setup is still open. */
export function useAuthStatus() {
  const queryClient = useQueryClient();
  // A 401 anywhere means the session is gone: refresh the status, which
  // brings the user back to the login page.
  useEffect(
    () =>
      onUnauthorized(() => {
        void queryClient.invalidateQueries({ queryKey: AUTH_QUERY_KEY });
      }),
    [queryClient],
  );
  return useQuery({
    queryKey: AUTH_QUERY_KEY,
    queryFn: ({ signal }) => apiGet('/api/auth/status', authStatusResponseSchema, { signal }),
    staleTime: 60_000,
    retry: 1,
  });
}

/** The signed-in user. Only use below the auth gate. */
export function useCurrentUser(): UserDto | null {
  return useAuthStatus().data?.user ?? null;
}

function useAfterAuthChange() {
  const queryClient = useQueryClient();
  return async () => {
    // Everything cached belonged to the previous user.
    queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'auth' });
    await queryClient.invalidateQueries({ queryKey: AUTH_QUERY_KEY });
  };
}

export function useSetup() {
  const after = useAfterAuthChange();
  return useMutation({
    mutationFn: (body: SetupRequest) => apiPost('/api/auth/setup', body, userResponseSchema),
    onSuccess: after,
  });
}

export function useLogin() {
  const after = useAfterAuthChange();
  return useMutation({
    mutationFn: (body: LoginRequest) => apiPost('/api/auth/login', body, userResponseSchema),
    onSuccess: after,
  });
}

export function useLogout() {
  const after = useAfterAuthChange();
  return useMutation({
    mutationFn: () => apiPost('/api/auth/logout', {}),
    onSettled: after,
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (body: { currentPassword: string; newPassword: string }) =>
      apiPost('/api/auth/password', body),
  });
}

/**
 * May the signed-in user use this function? The admin can block functions
 * for groups and users. Without a user (offline mode) everything local stays.
 */
export function useCan(feature: Feature): boolean {
  // Only reads the status the auth gate loaded; never fetches by itself (the
  // offline page would otherwise retry the unreachable server on every mount).
  const { data } = useQuery({
    queryKey: AUTH_QUERY_KEY,
    queryFn: ({ signal }) => apiGet('/api/auth/status', authStatusResponseSchema, { signal }),
    enabled: false,
  });
  const user = data?.user;
  return user ? user.permissions.includes(feature) : true;
}
