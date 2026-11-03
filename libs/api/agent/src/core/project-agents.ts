import type {
  DefinitionsInterModuleClient,
  ProjectAgentSnapshot,
} from '@shipfox/api-definitions-dto/inter-module';
import {ProjectAgentNotFoundError} from './errors.js';
import {SHIPPY_AGENT_KEY} from './shippy.js';

/** What a conversation's agent is. The built-in agent has a row only when the project has a `shippy.yaml`. */
export type ResolvedProjectAgent =
  | {kind: 'built-in'}
  | {kind: 'configured'; agent: ProjectAgentSnapshot};

/**
 * Finds the agent a key names in a project. `shippy` without a valid row is the built-in agent,
 * and a valid row applies its fields. Any other key needs a valid row. A row that failed its
 * latest sync still holds its last valid version, so it still resolves.
 */
export async function resolveProjectAgent(params: {
  definitions: DefinitionsInterModuleClient | undefined;
  workspaceId: string;
  projectId: string;
  key: string;
}): Promise<ResolvedProjectAgent> {
  const {definitions, workspaceId, projectId, key} = params;
  const agents = await listProjectAgents({definitions, workspaceId, projectId});
  const agent = agents.find((candidate) => candidate.key === key);
  if (agent) return {kind: 'configured', agent};
  if (key === SHIPPY_AGENT_KEY) return {kind: 'built-in'};
  throw new ProjectAgentNotFoundError(projectId, key);
}

export async function listProjectAgents(params: {
  definitions: DefinitionsInterModuleClient | undefined;
  workspaceId: string;
  projectId: string;
}): Promise<ProjectAgentSnapshot[]> {
  if (params.definitions === undefined) return [];
  const {agents} = await params.definitions.listProjectAgents({
    workspaceId: params.workspaceId,
    projectId: params.projectId,
  });
  return agents;
}
