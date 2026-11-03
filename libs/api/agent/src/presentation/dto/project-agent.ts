import type {ProjectAgentDto} from '@shipfox/api-agent-dto';
import type {ProjectAgentSnapshot} from '@shipfox/api-definitions-dto/inter-module';
import {SHIPPY_AGENT_KEY, SHIPPY_AGENT_NAME} from '#core/shippy.js';

function toProjectAgentDto(agent: ProjectAgentSnapshot): ProjectAgentDto {
  return {
    key: agent.key,
    name: agent.name,
    description: agent.description,
    error: agent.lastError ? {message: agent.lastError.message} : null,
  };
}

/**
 * The built-in agent comes first, as its file adds to it and never replaces it, so it is listed
 * even without a file. The agents arrive in key order.
 */
export function toProjectAgentDtos(agents: readonly ProjectAgentSnapshot[]): ProjectAgentDto[] {
  const shippy = agents.find((agent) => agent.key === SHIPPY_AGENT_KEY);
  const custom = agents.filter((agent) => agent.key !== SHIPPY_AGENT_KEY);
  return [
    shippy
      ? {...toProjectAgentDto(shippy), name: shippy.name ?? SHIPPY_AGENT_NAME}
      : {key: SHIPPY_AGENT_KEY, name: SHIPPY_AGENT_NAME, description: null, error: null},
    ...custom.map(toProjectAgentDto),
  ];
}
