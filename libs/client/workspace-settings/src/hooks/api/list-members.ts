import type {ListMembersResponseDto} from '@shipfox/api-workspaces-dto';
import {apiRequest} from '@shipfox/client-api';
import {useQuery} from '@tanstack/react-query';

export const listMembersQueryKey = (workspaceId: string) =>
  ['workspaces', workspaceId, 'members'] as const;

async function listMembers(workspaceId: string): Promise<ListMembersResponseDto> {
  return await apiRequest<ListMembersResponseDto>(`/workspaces/${workspaceId}/members`);
}

export function useListMembers(workspaceId: string) {
  return useQuery({
    queryKey: listMembersQueryKey(workspaceId),
    queryFn: () => listMembers(workspaceId),
  });
}
