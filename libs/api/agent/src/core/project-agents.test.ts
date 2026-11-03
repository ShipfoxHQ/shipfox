import {
  createTestDefinitionsClient,
  projectAgentSnapshot,
} from '#test/fixtures/definitions-client.js';
import {ProjectAgentNotFoundError} from './errors.js';
import {resolveProjectAgent} from './project-agents.js';

describe('resolveProjectAgent', () => {
  const workspaceId = crypto.randomUUID();
  const projectId = crypto.randomUUID();

  it('resolves shippy without a row to the built-in agent', async () => {
    const {client} = createTestDefinitionsClient();

    const agent = await resolveProjectAgent({
      definitions: client,
      workspaceId,
      projectId,
      key: 'shippy',
    });

    expect(agent).toEqual({kind: 'built-in'});
  });

  it('resolves shippy with a row to that row', async () => {
    const {client, agents} = createTestDefinitionsClient();
    const row = projectAgentSnapshot({key: 'shippy', instructions: 'Use pnpm.'});
    agents.set(projectId, [row]);

    const agent = await resolveProjectAgent({
      definitions: client,
      workspaceId,
      projectId,
      key: 'shippy',
    });

    expect(agent).toEqual({kind: 'configured', agent: row});
  });

  it('resolves a custom agent to its row, even when its latest sync failed', async () => {
    const {client, agents} = createTestDefinitionsClient();
    const row = projectAgentSnapshot({
      key: 'reviewer',
      instructions: 'Review pull requests.',
      lastError: {message: 'Bad file', diagnostics: []},
    });
    agents.set(projectId, [row]);

    const agent = await resolveProjectAgent({
      definitions: client,
      workspaceId,
      projectId,
      key: 'reviewer',
    });

    expect(agent).toEqual({kind: 'configured', agent: row});
  });

  it('rejects a custom agent without a row', async () => {
    const {client} = createTestDefinitionsClient();

    await expect(
      resolveProjectAgent({definitions: client, workspaceId, projectId, key: 'reviewer'}),
    ).rejects.toBeInstanceOf(ProjectAgentNotFoundError);
  });

  it('knows only the built-in agent without a definitions client', async () => {
    await expect(
      resolveProjectAgent({definitions: undefined, workspaceId, projectId, key: 'shippy'}),
    ).resolves.toEqual({kind: 'built-in'});
    await expect(
      resolveProjectAgent({definitions: undefined, workspaceId, projectId, key: 'reviewer'}),
    ).rejects.toBeInstanceOf(ProjectAgentNotFoundError);
  });
});
