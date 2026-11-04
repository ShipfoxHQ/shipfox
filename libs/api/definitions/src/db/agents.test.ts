import {DEFINITION_AGENT_RULES_RESOLVED} from '@shipfox/api-definitions-dto';
import {asc, sql} from 'drizzle-orm';
import {applyVcsAgentsBatch as apply, listProjectAgents} from './agents.js';
import {db} from './db.js';
import {definitionsOutbox} from './schema/outbox.js';

function valid(key: string, contentHash = `hash-${key}`, on?: {source: string; filter?: string}[]) {
  return {
    key,
    configPath: `.shipfox/agents/${key}.yaml`,
    name: null,
    description: `Agent ${key}`,
    instructions: `Instructions for ${key}`,
    document: {
      description: `Agent ${key}`,
      instructions: `Instructions for ${key}`,
      ...(on === undefined ? {} : {on}),
    },
    contentHash,
  };
}

async function listRulesEvents(projectId: string) {
  const rows = await db()
    .select()
    .from(definitionsOutbox)
    .where(sql`${definitionsOutbox.payload}->>'projectId' = ${projectId}`)
    .orderBy(asc(definitionsOutbox.createdAt), asc(definitionsOutbox.id));
  return rows
    .filter((row) => row.eventType === DEFINITION_AGENT_RULES_RESOLVED)
    .map((row) => row.payload as {workspaceId: string; agents: unknown[]});
}

describe('applyVcsAgentsBatch', () => {
  let workspaceId: string;
  let projectId: string;

  const applyVcsAgentsBatch = (params: Omit<Parameters<typeof apply>[0], 'workspaceId'>) =>
    apply({workspaceId, ...params});

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
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

  describe('agent rules event', () => {
    it('lists the rules of every agent that declares one', async () => {
      const rule = {source: 'slack', filter: 'request.channel_id == "C1"'};

      await applyVcsAgentsBatch({
        projectId,
        valid: [valid('a', 'hash-a', [rule]), valid('b')],
        invalid: [],
      });

      expect(await listRulesEvents(projectId)).toEqual([
        {workspaceId, projectId, agents: [{key: 'a', rules: [rule]}]},
      ]);
    });

    it('keeps the rules of an agent whose file turned invalid', async () => {
      await applyVcsAgentsBatch({
        projectId,
        valid: [valid('a', 'hash-a', [{source: 'slack'}])],
        invalid: [],
      });

      await applyVcsAgentsBatch({
        projectId,
        valid: [],
        invalid: [
          {key: 'a', configPath: '.shipfox/agents/a.yaml', error: {message: 'x', diagnostics: []}},
        ],
      });

      const events = await listRulesEvents(projectId);
      expect(events.at(-1)?.agents).toEqual([{key: 'a', rules: [{source: 'slack'}]}]);
    });

    it('drops the rules of a deleted agent and of a rule removed from its file', async () => {
      await applyVcsAgentsBatch({
        projectId,
        valid: [
          valid('a', 'hash-a', [{source: 'slack'}]),
          valid('b', 'hash-b', [{source: 'linear'}]),
        ],
        invalid: [],
      });

      await applyVcsAgentsBatch({projectId, valid: [valid('a', 'hash-a2')], invalid: []});

      const events = await listRulesEvents(projectId);
      expect(events.at(-1)?.agents).toEqual([]);
    });
  });
});
