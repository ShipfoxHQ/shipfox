import {checkedApiRequest, emptyResponseSchema} from '@shipfox/client-api';
import {useMutation, useQueryClient} from '@tanstack/react-query';
import type {RemoveWorkspaceMemberCommand} from '#core/membership.js';
import {listMembersQueryOptions} from './list-members.js';

async function removeMember(params: {workspaceId: string; command: RemoveWorkspaceMemberCommand}) {
  await checkedApiRequest(
    emptyResponseSchema,
    `/workspaces/${params.workspaceId}/members/${params.command.userId}`,
    {method: 'DELETE'},
  );
}

export function useRemoveMember(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (command: RemoveWorkspaceMemberCommand) => removeMember({workspaceId, command}),
    onSuccess: async () => {
      await queryClient.invalidateQueries(listMembersQueryOptions(workspaceId));
    },
  });
}
