import type {ManagedModelProvider} from '@shipfox/api-agent-dto';
import {closeApp, createApp} from '@shipfox/node-fastify';
import {createE2eResolveAgentConfigRoute} from './resolve-agent-config.js';

const managedProvider: ManagedModelProvider = {
  id: 'shipfox',
  label: 'Shipfox',
  models: [{id: 'managed-model', label: 'Managed model', api: 'openai-completions'}],
  defaultModel: 'managed-model',
  resolveCredentials: vi.fn(),
};

describe('agent e2e resolve-agent-config route', () => {
  afterEach(async () => {
    await closeApp();
  });

  async function resolve(config: Record<string, string>) {
    const app = await createApp({
      routes: [
        {
          prefix: '/agent',
          routes: [
            createE2eResolveAgentConfigRoute({managedProvider, workspaceProviders: 'enabled'}),
          ],
        },
      ],
      swagger: false,
    });
    return await app.inject({
      method: 'POST',
      url: '/agent/resolve-agent-config',
      payload: {workspace_id: crypto.randomUUID(), config},
    });
  }

  it('resolves step settings as run creation does', async () => {
    const res = await resolve({model: 'managed-model', thinking: 'high'});

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      harness: 'pi',
      provider: 'shipfox',
      model: 'managed-model',
      thinking: 'high',
    });
  });

  it('rejects settings the workspace cannot run', async () => {
    const res = await resolve({model: 'missing-model', thinking: 'high'});

    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({code: 'agent-config-invalid'});
  });
});
