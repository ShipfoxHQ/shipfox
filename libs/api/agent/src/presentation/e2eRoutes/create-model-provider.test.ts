import {closeApp, createApp} from '@shipfox/node-fastify';
import {agentE2eRoutes} from './index.js';

describe('agent e2e routes', () => {
  afterEach(async () => {
    await closeApp();
  });

  it('rejects malformed workspace ids through route validation', async () => {
    const app = await createApp({routes: [agentE2eRoutes], swagger: false});

    const res = await app.inject({
      method: 'POST',
      url: '/agent/model-provider',
      payload: {
        workspace_id: 'not-a-uuid',
        provider_id: 'anthropic',
        api_key: 'sk-e2e-placeholder',
        default_model: 'claude-opus-4-8',
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({code: 'validation-error'});
  });

  it('rejects default models outside the Anthropic catalog', async () => {
    const app = await createApp({routes: [agentE2eRoutes], swagger: false});

    const res = await app.inject({
      method: 'POST',
      url: '/agent/model-provider',
      payload: {
        workspace_id: crypto.randomUUID(),
        provider_id: 'anthropic',
        api_key: 'sk-e2e-placeholder',
        default_model: 'missing-model',
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      code: 'unsupported-model',
      details: {default_model: 'missing-model'},
    });
  });
});
