import {listProjectAgentsResponseSchema} from '@shipfox/api-agent-dto';
import {checkedApiRequest} from '@shipfox/client-api';
import {queryOptions, useQuery} from '@tanstack/react-query';
import type {ProjectAgent} from '#core/project-agents.js';

export const projectAgentsQueryKey = (projectId: string) => ['project-agents', projectId] as const;

export async function listProjectAgents(params: {
  projectId: string;
  signal?: AbortSignal | undefined;
}): Promise<ProjectAgent[]> {
  const response = await checkedApiRequest(
    listProjectAgentsResponseSchema,
    `/projects/${encodeURIComponent(params.projectId)}/agents`,
    {signal: params.signal},
  );
  return response.agents.map((agent) => ({
    key: agent.key,
    name: agent.name,
    description: agent.description,
    error: agent.error?.message ?? null,
  }));
}

export function projectAgentsQueryOptions(projectId: string) {
  return queryOptions({
    queryKey: projectAgentsQueryKey(projectId),
    queryFn: ({signal}) => listProjectAgents({projectId, signal}),
    // An agent file changes with a sync. The list is read again on focus once it is 30 seconds old.
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

/** The agents of a project: the built-in one first, then the custom ones. */
export function useProjectAgentsQuery(projectId: string) {
  return useQuery(projectAgentsQueryOptions(projectId));
}
