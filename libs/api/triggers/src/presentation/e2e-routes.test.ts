import {closeApp, createApp} from '@shipfox/node-fastify';
import {projectJobListenerSubscriptions} from '#db/job-listener-subscriptions.js';
import {triggersE2eRoutes} from './e2e-routes.js';

describe('triggers E2E routes', () => {
  afterEach(async () => {
    await closeApp();
  });

  test('reports a listener without projected subscriptions as not ready', async () => {
    const jobId = crypto.randomUUID();
    const app = await createApp({routes: [triggersE2eRoutes], swagger: false});

    const response = await app.inject({
      method: 'GET',
      url: `/triggers/listeners/${jobId}/readiness`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ready: false});
  });

  test('reports a listener with projected subscriptions as ready', async () => {
    const workspaceId = crypto.randomUUID();
    const workflowRunId = crypto.randomUUID();
    const jobId = crypto.randomUUID();
    await projectJobListenerSubscriptions({
      workspaceId,
      workflowRunId,
      jobId,
      on: [{source: 'listener-source', event: 'received'}],
      until: null,
    });
    const app = await createApp({routes: [triggersE2eRoutes], swagger: false});

    const response = await app.inject({
      method: 'GET',
      url: `/triggers/listeners/${jobId}/readiness`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ready: true});
  });
});
