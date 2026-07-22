import {listInvitationsResponseSchema} from '@shipfox/api-workspaces-dto';
import {checkedApiRequest} from '@shipfox/client-api';
import {queryOptions, useQuery} from '@tanstack/react-query';
import type {Invitation} from '#core/invitation.js';
import {toInvitation} from './invitation-mapper.js';

export const listInvitationsQueryKey = (workspaceId: string) =>
  ['workspaces', workspaceId, 'invitations'] as const;

async function listInvitations(workspaceId: string): Promise<Invitation[]> {
  const response = await checkedApiRequest(
    listInvitationsResponseSchema,
    `/workspaces/${workspaceId}/invitations`,
  );
  return response.invitations.map(toInvitation);
}

export function listInvitationsQueryOptions(workspaceId: string) {
  return queryOptions({
    queryKey: listInvitationsQueryKey(workspaceId),
    queryFn: () => listInvitations(workspaceId),
  });
}

export function useListInvitations(workspaceId: string) {
  return useQuery(listInvitationsQueryOptions(workspaceId));
}
