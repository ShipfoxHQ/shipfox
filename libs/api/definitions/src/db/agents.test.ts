import {applyVcsAgentsBatch, listProjectAgents} from './agents.js';

function valid(key: string, contentHash = `hash-${key}`) {
  return {
    key,
    configPath: `.shipfox/agents/${key}.yaml`,
    name: null,
    description: `Agent ${key}`,
    instructions: `Instructions for ${key}`,
    document: {description: `Agent ${key}`, instructions: `Instructions for ${key}`},
    contentHash,
  };
}

describe('applyVcsAgentsBatch', () => {
  let projectId: string;

  beforeEach(() => {
    projectId = crypto.randomUUID();
  });

  it('stores valid agents and deletes the ones that are gone', async () => {
    await applyVcsAgentsBatch({projectId, valid: [valid('a'), valid('b')], invalid: []});

    const result = await applyVcsAgentsBatch({
      projectId,
      valid: [valid('b', 'hash-b2')],
      invalid: [],
    });

    expect(result).toEqual({appliedCount: 1, deletedCount: 1});
    const agents = await listProjectAgents(projectId);
    expect(agents.map((agent) => [agent.key, agent.contentHash, agent.lastError])).toEqual([
      ['b', 'hash-b2', null],
    ]);
  });

  it('keeps the last valid version of an invalid file and records the error', async () => {
    await applyVcsAgentsBatch({projectId, valid: [valid('a')], invalid: []});
    const error = {message: 'A custom agent requires "description".', diagnostics: []};

    await applyVcsAgentsBatch({
      projectId,
      valid: [],
      invalid: [{key: 'a', configPath: '.shipfox/agents/a.yml', error}],
    });

    const [agent] = await listProjectAgents(projectId);
    expect(agent).toMatchObject({
      key: 'a',
      configPath: '.shipfox/agents/a.yml',
      name: null,
      description: 'Agent a',
      instructions: 'Instructions for a',
      document: {description: 'Agent a', instructions: 'Instructions for a'},
      contentHash: 'hash-a',
      lastError: error,
    });
  });

  it('creates no row for an invalid file that was never valid', async () => {
    await applyVcsAgentsBatch({
      projectId,
      valid: [],
      invalid: [
        {key: 'a', configPath: '.shipfox/agents/a.yaml', error: {message: 'x', diagnostics: []}},
      ],
    });

    expect(await listProjectAgents(projectId)).toEqual([]);
  });

  it('clears the error once the file is valid again', async () => {
    await applyVcsAgentsBatch({projectId, valid: [valid('a')], invalid: []});
    await applyVcsAgentsBatch({
      projectId,
      valid: [],
      invalid: [
        {key: 'a', configPath: '.shipfox/agents/a.yaml', error: {message: 'x', diagnostics: []}},
      ],
    });

    await applyVcsAgentsBatch({projectId, valid: [valid('a', 'hash-a2')], invalid: []});

    const [agent] = await listProjectAgents(projectId);
    expect(agent).toMatchObject({contentHash: 'hash-a2', lastError: null});
  });
});
