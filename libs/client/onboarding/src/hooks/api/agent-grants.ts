import {agentGrantsQueryOptions} from '@shipfox/client-agent';
import {useQuery} from '@tanstack/react-query';

const GRANTS_STALE_TIME_MS = 5 * 60 * 1000;

/**
 * The first agent grant the signed-in user holds for this workspace, or
 * `undefined` while loading or when none exists. Grants are per user across
 * workspaces, so the hook keeps only this workspace's, like the agent-access
 * settings page does.
 */
export function useWorkspaceAgentGrant(workspaceId: string) {
  const grantsQuery = useQuery({
    ...agentGrantsQueryOptions(),
    staleTime: GRANTS_STALE_TIME_MS,
    retry: false,
    refetchOnWindowFocus: false,
  });
  return grantsQuery.data?.find((grant) => grant.workspaceId === workspaceId);
}
