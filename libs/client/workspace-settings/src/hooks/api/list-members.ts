import {listMembersResponseSchema} from '@shipfox/api-workspaces-dto';
import {checkedApiRequest} from '@shipfox/client-api';
import {queryOptions, useQuery} from '@tanstack/react-query';
import type {WorkspaceMember} from '#core/membership.js';
import {toWorkspaceMember} from './membership-mapper.js';

export const listMembersQueryKey = (workspaceId: string) =>
  ['workspaces', workspaceId, 'members'] as const;

async function listMembers(workspaceId: string): Promise<WorkspaceMember[]> {
  const response = await checkedApiRequest(
    listMembersResponseSchema,
    `/workspaces/${workspaceId}/members`,
  );
  return response.members.map(toWorkspaceMember);
}

export function listMembersQueryOptions(workspaceId: string) {
  return queryOptions({
    queryKey: listMembersQueryKey(workspaceId),
    queryFn: () => listMembers(workspaceId),
  });
}

export function useListMembers(workspaceId: string) {
  return useQuery(listMembersQueryOptions(workspaceId));
}
