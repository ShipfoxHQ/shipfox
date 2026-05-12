import {apiRequest} from '@shipfox/client-api';
import {useMutation, useQueryClient} from '@tanstack/react-query';
import {listInvitationsQueryKey} from './list-invitations.js';

async function revokeInvitation(params: {workspaceId: string; invitationId: string}) {
  await apiRequest<void>(`/workspaces/${params.workspaceId}/invitations/${params.invitationId}`, {
    method: 'DELETE',
  });
}

export function useRevokeInvitation(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (invitationId: string) => revokeInvitation({workspaceId, invitationId}),
    onSuccess: async () => {
      await queryClient.invalidateQueries({queryKey: listInvitationsQueryKey(workspaceId)});
    },
  });
}
