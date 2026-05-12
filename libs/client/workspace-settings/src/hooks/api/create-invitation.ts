import type {CreateInvitationBodyDto, InvitationDto} from '@shipfox/api-workspaces-dto';
import {apiRequest} from '@shipfox/client-api';
import {useMutation, useQueryClient} from '@tanstack/react-query';
import {listInvitationsQueryKey} from './list-invitations.js';

async function createInvitation(params: {workspaceId: string; body: CreateInvitationBodyDto}) {
  return await apiRequest<InvitationDto>(`/workspaces/${params.workspaceId}/invitations`, {
    method: 'POST',
    body: params.body,
  });
}

export function useCreateInvitation(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateInvitationBodyDto) => createInvitation({workspaceId, body}),
    onSuccess: async () => {
      await queryClient.invalidateQueries({queryKey: listInvitationsQueryKey(workspaceId)});
    },
  });
}
