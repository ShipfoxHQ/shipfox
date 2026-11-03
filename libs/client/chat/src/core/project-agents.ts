export const SHIPPY_AGENT_KEY = 'shippy';

export interface ProjectAgent {
  key: string;
  /** The `name` of the agent file, or null. */
  name: string | null;
  description: string | null;
  /** Why the latest sync rejected the agent file. The agent still runs its last valid version. */
  error: string | null;
}

/** The picker shows an agent's name, or its key when it has none. */
export function agentLabel(agent: Pick<ProjectAgent, 'key' | 'name'>): string {
  return agent.name ?? agent.key;
}

/** The picker appears only when the project has an agent besides the built-in one. */
export function hasCustomAgents(agents: readonly ProjectAgent[]): boolean {
  return agents.some((agent) => agent.key !== SHIPPY_AGENT_KEY);
}

/**
 * A conversation whose custom agent was deleted stays readable and takes no input. Nothing is
 * decided before the agents load, so the composer doesn't flicker off.
 */
export function isAgentUnavailable(params: {
  agentKey: string | undefined;
  agents: readonly ProjectAgent[] | undefined;
}): boolean {
  const {agentKey, agents} = params;
  if (agentKey === undefined || agentKey === SHIPPY_AGENT_KEY || agents === undefined) return false;
  return !agents.some((agent) => agent.key === agentKey);
}
