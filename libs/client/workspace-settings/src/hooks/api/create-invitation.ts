import {invitationDtoSchema} from '@shipfox/api-workspaces-dto';
import {checkedApiRequest} from '@shipfox/client-api';
import {useMutation, useQueryClient} from '@tanstack/react-query';
import type {CreateInvitationCommand, Invitation} from '#core/invitation.js';
import {toInvitation} from './invitation-mapper.js';
import {listInvitationsQueryOptions} from './list-invitations.js';

async function createInvitation(params: {
  workspaceId: string;
  command: CreateInvitationCommand;
}): Promise<Invitation> {
  const response = await checkedApiRequest(
    invitationDtoSchema,
    `/workspaces/${params.workspaceId}/invitations`,
    {
      method: 'POST',
      body: {email: params.command.email},
    },
  );
  return toInvitation(response);
}

export function useCreateInvitation(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (command: CreateInvitationCommand) => createInvitation({workspaceId, command}),
    onSuccess: async () => {
      await queryClient.invalidateQueries(listInvitationsQueryOptions(workspaceId));
    },
  });
}
