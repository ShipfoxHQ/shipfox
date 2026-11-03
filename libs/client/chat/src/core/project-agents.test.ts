import {
  agentLabel,
  hasCustomAgents,
  isAgentUnavailable,
  type ProjectAgent,
} from './project-agents.js';

function agent(overrides: Partial<ProjectAgent> & {key: string}): ProjectAgent {
  return {name: null, description: null, error: null, ...overrides};
}

describe('agentLabel', () => {
  test('shows the name, or the key when the agent file sets none', () => {
    expect(agentLabel(agent({key: 'reviewer', name: 'Code reviewer'}))).toBe('Code reviewer');
    expect(agentLabel(agent({key: 'reviewer'}))).toBe('reviewer');
  });
});

describe('hasCustomAgents', () => {
  test('is false for the built-in agent alone, even with a shippy.yaml', () => {
    expect(hasCustomAgents([agent({key: 'shippy', name: 'Shippy'})])).toBe(false);
  });

  test('is true once the project has another agent', () => {
    expect(hasCustomAgents([agent({key: 'shippy'}), agent({key: 'reviewer'})])).toBe(true);
  });
});

describe('isAgentUnavailable', () => {
  const agents = [agent({key: 'shippy'}), agent({key: 'reviewer'})];

  test('is false for the built-in agent and for an agent the project still has', () => {
    expect(isAgentUnavailable({agentKey: 'shippy', agents: [agent({key: 'shippy'})]})).toBe(false);
    expect(isAgentUnavailable({agentKey: 'reviewer', agents})).toBe(false);
  });

  test('is true once the custom agent is gone', () => {
    expect(isAgentUnavailable({agentKey: 'triage', agents})).toBe(true);
  });

  test('decides nothing before the agents load or the conversation does', () => {
    expect(isAgentUnavailable({agentKey: 'triage', agents: undefined})).toBe(false);
    expect(isAgentUnavailable({agentKey: undefined, agents})).toBe(false);
  });
});
