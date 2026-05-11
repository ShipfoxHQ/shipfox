import type {ListInvitationsResponseDto} from '@shipfox/api-workspaces-dto';
import {apiRequest} from '@shipfox/client-api';
import {useQuery} from '@tanstack/react-query';

export const listInvitationsQueryKey = (workspaceId: string) =>
  ['workspaces', workspaceId, 'invitations'] as const;

async function listInvitations(workspaceId: string): Promise<ListInvitationsResponseDto> {
  return await apiRequest<ListInvitationsResponseDto>(`/workspaces/${workspaceId}/invitations`);
}

export function useListInvitations(workspaceId: string) {
  return useQuery({
    queryKey: listInvitationsQueryKey(workspaceId),
    queryFn: () => listInvitations(workspaceId),
  });
}
