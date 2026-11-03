import type {
  DefinitionsInterModuleClient,
  ProjectAgentSnapshot,
} from '@shipfox/api-definitions-dto/inter-module';

export function projectAgentSnapshot(
  overrides: Partial<ProjectAgentSnapshot> & {key: string},
): ProjectAgentSnapshot {
  return {
    configPath: `.shipfox/agents/${overrides.key}.yaml`,
    name: null,
    description: null,
    instructions: null,
    document: {},
    contentHash: `hash-${overrides.key}`,
    lastError: null,
    fetchedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Fake definitions client for the conversation routes and turns. They only read the project's
 * agent files, so every other method is missing. Change `agents` to change what the next read sees.
 */
export function createTestDefinitionsClient() {
  const agents = new Map<string, ProjectAgentSnapshot[]>();
  const listProjectAgents = vi.fn(({projectId}: {projectId: string}) =>
    Promise.resolve({agents: agents.get(projectId) ?? []}),
  );
  return {
    agents,
    listProjectAgents,
    client: {listProjectAgents} as unknown as DefinitionsInterModuleClient,
  };
}
