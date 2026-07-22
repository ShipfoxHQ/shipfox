import {apiRequest} from '@shipfox/client-api';
import {useMutation, useQueryClient} from '@tanstack/react-query';
import type {RevokeInvitationCommand} from '#core/membership.js';
import {listInvitationsQueryOptions} from './list-invitations.js';

async function revokeInvitation(params: {workspaceId: string; command: RevokeInvitationCommand}) {
  await apiRequest<void>(
    `/workspaces/${params.workspaceId}/invitations/${params.command.invitationId}`,
    {
      method: 'DELETE',
    },
  );
}

export function useRevokeInvitation(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (command: RevokeInvitationCommand) => revokeInvitation({workspaceId, command}),
    onSuccess: async () => {
      await queryClient.invalidateQueries(listInvitationsQueryOptions(workspaceId));
    },
  });
}
