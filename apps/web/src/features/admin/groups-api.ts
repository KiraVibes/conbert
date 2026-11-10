import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  groupResponseSchema,
  groupsResponseSchema,
  type CreateGroupRequest,
  type GroupDto,
  type UpdateGroupRequest,
} from '@conbert/schemas';
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from '@/lib/api';
// The user list shows groups and permissions – refresh it too.
import { USERS_KEY } from '@/features/auth/users-api';

export const GROUPS_KEY = ['groups'] as const;

/** Display name of a group ("everyone" is translated). */
export function groupName(t: (key: string) => string, group: Pick<GroupDto, 'builtin' | 'name'>) {
  return group.builtin === 'everyone' ? t('groups.everyone') : group.name;
}

export function useGroups(enabled = true) {
  return useQuery({
    queryKey: GROUPS_KEY,
    enabled,
    queryFn: ({ signal }) => apiGet('/api/groups', groupsResponseSchema, { signal }),
    select: (data) => data.groups,
  });
}

export function useGroupMutations() {
  const queryClient = useQueryClient();
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: GROUPS_KEY });
    await queryClient.invalidateQueries({ queryKey: USERS_KEY });
  };
  return {
    create: useMutation({
      mutationFn: (body: CreateGroupRequest) => apiPost('/api/groups', body, groupResponseSchema),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: ({ id, body }: { id: string; body: UpdateGroupRequest }) =>
        apiPatch(`/api/groups/${id}`, body, groupResponseSchema),
      onSuccess: refresh,
    }),
    setMembers: useMutation({
      mutationFn: ({ id, userIds }: { id: string; userIds: string[] }) =>
        apiPut(`/api/groups/${id}/members`, { userIds }, groupResponseSchema),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (id: string) => apiDelete(`/api/groups/${id}`),
      onSuccess: refresh,
    }),
  };
}
