import {agentGrantsQueryOptions} from '@shipfox/client-agent';
import {useQuery} from '@tanstack/react-query';

export interface WorkspaceAgentGrant {
  clientName: string;
}

export interface WorkspaceAgentGrantState {
  grant: WorkspaceAgentGrant | undefined;
  isPending: boolean;
}

/**
 * The first agent grant the signed-in user holds for this workspace. Grants are
 * per user across workspaces, so the hook keeps only this workspace's, like the
 * agent-access settings page does. Default freshness: the user leaves the page
 * to connect an agent, and the query refetches on remount and on tab focus.
 *
 * `isPending` is reported separately because an absent grant and an unloaded
 * one are the same value, and a caller that conflates them tells a connected
 * user to connect again.
 */
export function useWorkspaceAgentGrant(workspaceId: string): WorkspaceAgentGrantState {
  const grantsQuery = useQuery(agentGrantsQueryOptions());
  return {
    grant: grantsQuery.data?.find((grant) => grant.workspaceId === workspaceId),
    isPending: grantsQuery.isPending,
  };
}
