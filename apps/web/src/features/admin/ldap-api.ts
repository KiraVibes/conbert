import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  groupsResponseSchema,
  ldapGroupsResponseSchema,
  ldapSettingsResponseSchema,
  ldapSyncResponseSchema,
  ldapTestResponseSchema,
  type LdapConfig,
  type LdapSettingsRequest,
  type LdapTestRequest,
} from '@conbert/schemas';
import { apiGet, apiPost, apiPut } from '@/lib/api';
import { USERS_KEY } from '@/features/auth/users-api';
import { GROUPS_KEY } from './groups-api';

export const LDAP_KEY = ['ldap-settings'] as const;

export function useLdapSettings(enabled = true) {
  return useQuery({
    queryKey: LDAP_KEY,
    enabled,
    queryFn: ({ signal }) => apiGet('/api/admin/ldap', ldapSettingsResponseSchema, { signal }),
    select: (data) => data.settings,
  });
}

export function useLdapMutations() {
  const queryClient = useQueryClient();
  const refreshAll = async () => {
    await queryClient.invalidateQueries({ queryKey: LDAP_KEY });
    await queryClient.invalidateQueries({ queryKey: GROUPS_KEY });
    await queryClient.invalidateQueries({ queryKey: USERS_KEY });
  };
  return {
    save: useMutation({
      mutationFn: (body: LdapSettingsRequest) =>
        apiPut('/api/admin/ldap', body, ldapSettingsResponseSchema),
      onSuccess: (data) => queryClient.setQueryData(LDAP_KEY, data),
    }),
    test: useMutation({
      mutationFn: (body: LdapTestRequest) =>
        apiPost('/api/admin/ldap/test', body, ldapTestResponseSchema),
    }),
    sync: useMutation({
      mutationFn: () => apiPost('/api/admin/ldap/sync', {}, ldapSyncResponseSchema),
      onSettled: refreshAll,
    }),
    importGroups: useMutation({
      mutationFn: (dns: string[]) =>
        apiPost('/api/admin/ldap/import', { dns }, groupsResponseSchema),
      onSuccess: refreshAll,
    }),
  };
}

export function useLdapGroups(query: string, enabled: boolean) {
  return useQuery({
    queryKey: ['ldap-groups', query],
    enabled,
    queryFn: ({ signal }) =>
      apiGet(`/api/admin/ldap/groups?q=${encodeURIComponent(query)}`, ldapGroupsResponseSchema, {
        signal,
      }),
    staleTime: 30_000,
  });
}

/** Ready-made settings for the two most common directories. */
export const LDAP_PRESETS: Record<'openldap' | 'activeDirectory', Partial<LdapConfig>> = {
  openldap: {
    userFilter: '(&(objectClass=person)(uid={{username}}))',
    usernameAttr: 'uid',
    displayNameAttr: 'cn',
    groupFilter: '(|(objectClass=groupOfNames)(objectClass=groupOfUniqueNames))',
    groupNameAttr: 'cn',
    memberAttr: 'member',
  },
  activeDirectory: {
    userFilter: '(&(objectCategory=person)(objectClass=user)(sAMAccountName={{username}}))',
    usernameAttr: 'sAMAccountName',
    displayNameAttr: 'displayName',
    groupFilter: '(objectClass=group)',
    groupNameAttr: 'cn',
    memberAttr: 'member',
  },
};
