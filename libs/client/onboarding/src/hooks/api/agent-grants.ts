import {agentGrantsQueryOptions} from '@shipfox/client-agent';
import {useQuery} from '@tanstack/react-query';

export interface WorkspaceAgentGrant {
  clientName: string;
}

/**
 * The first agent grant the signed-in user holds for this workspace, or
 * `undefined` while loading or when none exists. Grants are per user across
 * workspaces, so the hook keeps only this workspace's, like the agent-access
 * settings page does. Default freshness: the user leaves the page to connect
 * an agent, and the query refetches on remount and on tab focus.
 */
export function useWorkspaceAgentGrant(workspaceId: string): WorkspaceAgentGrant | undefined {
  const grantsQuery = useQuery(agentGrantsQueryOptions());
  return grantsQuery.data?.find((grant) => grant.workspaceId === workspaceId);
}
