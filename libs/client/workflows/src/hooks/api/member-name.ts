import {listMembersQueryOptions} from '@shipfox/client-workspace-settings';
import {useQuery} from '@tanstack/react-query';

/** A member's display name from the workspace's member list, or null while it loads. */
export function useMemberName(workspaceId: string, userId: string | null): string | null {
  const membersQuery = useQuery({
    ...listMembersQueryOptions(workspaceId),
    enabled: Boolean(userId),
  });
  if (!userId) return null;
  const member = membersQuery.data?.find((candidate) => candidate.userId === userId);
  return member ? (member.name ?? member.email) : null;
}
