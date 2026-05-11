import {apiRequest} from '@shipfox/client-api';
import {useMutation, useQueryClient} from '@tanstack/react-query';
import {listMembersQueryKey} from './list-members.js';

async function removeMember(params: {workspaceId: string; userId: string}) {
  await apiRequest<void>(`/workspaces/${params.workspaceId}/members/${params.userId}`, {
    method: 'DELETE',
  });
}

export function useRemoveMember(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => removeMember({workspaceId, userId}),
    onSuccess: async () => {
      await queryClient.invalidateQueries({queryKey: listMembersQueryKey(workspaceId)});
    },
  });
}
