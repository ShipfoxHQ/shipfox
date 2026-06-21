import {createHmac, randomUUID} from 'node:crypto';
import {closeApp, createApp} from '@shipfox/node-fastify';
import type {FastifyInstance} from 'fastify';
import {giteaPushPayload} from '#test/index.js';
import {createGiteaWebhookRoutes} from './webhooks.js';

// Must match GITEA_WEBHOOK_SECRET in test/env.ts.
const WEBHOOK_SECRET = 'test-webhook-secret';

interface TestApp {
  app: FastifyInstance;
  publishSourcePush: ReturnType<typeof vi.fn>;
  recordDeliveryOnly: ReturnType<typeof vi.fn>;
  getIntegrationConnectionById: ReturnType<typeof vi.fn>;
}

async function createTestApp(): Promise<TestApp> {
  const publishSourcePush = vi.fn(() => Promise.resolve({published: true}));
  const recordDeliveryOnly = vi.fn(() => Promise.resolve());
  const getIntegrationConnectionById = vi.fn();
  const routes = createGiteaWebhookRoutes({
    coreDb: () =>
      ({
        transaction: (fn: (tx: unknown) => Promise<unknown>) => fn({}),
      }) as never,
    publishSourcePush,
    recordDeliveryOnly,
    getIntegrationConnectionById,
  });
  const app = await createApp({routes: [routes], swagger: false});
  await app.ready();
  return {app, publishSourcePush, recordDeliveryOnly, getIntegrationConnectionById};
}

function signedHeaders(rawBody: string, event: string, deliveryId: string) {
  const signature = createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');
  return {
    'content-type': 'application/json',
    'x-gitea-signature': signature,
    'x-gitea-event': event,
    'x-gitea-delivery': deliveryId,
  };
}

describe('Gitea webhook route', () => {
  beforeEach(async () => {
    await closeApp();
  });

  afterEach(async () => {
    await closeApp();
  });

  it('accepts a signed non-push event and records the delivery', async () => {
    const {app, publishSourcePush, recordDeliveryOnly} = await createTestApp();
    const deliveryId = randomUUID();
    const body = JSON.stringify({hello: 'world'});

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/gitea',
      headers: signedHeaders(body, 'create', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    expect(publishSourcePush).not.toHaveBeenCalled();
    expect(recordDeliveryOnly).toHaveBeenCalledTimes(1);
    expect(recordDeliveryOnly.mock.calls[0]?.[0]).toMatchObject({provider: 'gitea', deliveryId});
  });

  it('rejects an invalid signature with 401 and persists nothing', async () => {
    const {app, publishSourcePush, recordDeliveryOnly} = await createTestApp();
    const body = JSON.stringify(
      giteaPushPayload({
        owner: 'shipfox',
        repo: 'api',
        ref: 'refs/heads/main',
        defaultBranch: 'main',
        sha: 'zzz',
      }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/gitea',
      headers: {
        'content-type': 'application/json',
        'x-gitea-signature': 'deadbeef',
        'x-gitea-event': 'push',
        'x-gitea-delivery': randomUUID(),
      },
      payload: body,
    });

    expect(res.statusCode).toBe(401);
    expect(publishSourcePush).not.toHaveBeenCalled();
    expect(recordDeliveryOnly).not.toHaveBeenCalled();
  });

  it('rejects a request missing the delivery header with 400', async () => {
    const {app} = await createTestApp();
    const body = JSON.stringify({hello: 'world'});

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/gitea',
      headers: {
        'content-type': 'application/json',
        'x-gitea-signature': createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex'),
        'x-gitea-event': 'push',
      },
      payload: body,
    });

    expect(res.statusCode).toBe(400);
  });

  it('rejects a request missing the signature header with 401', async () => {
    const {app} = await createTestApp();
    const body = JSON.stringify({hello: 'world'});

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/gitea',
      headers: {
        'content-type': 'application/json',
        'x-gitea-event': 'push',
        'x-gitea-delivery': randomUUID(),
      },
      payload: body,
    });

    expect(res.statusCode).toBe(401);
  });

  it('rejects a request missing the event header with 400', async () => {
    const {app} = await createTestApp();
    const body = JSON.stringify({hello: 'world'});

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/gitea',
      headers: {
        'content-type': 'application/json',
        'x-gitea-signature': createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex'),
        'x-gitea-delivery': randomUUID(),
      },
      payload: body,
    });

    expect(res.statusCode).toBe(400);
  });

  it('rejects malformed JSON after a valid signature with 400', async () => {
    const {app, publishSourcePush, recordDeliveryOnly} = await createTestApp();
    const body = '{not valid json';

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/gitea',
      headers: signedHeaders(body, 'push', randomUUID()),
      payload: body,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({error: 'malformed JSON'});
    expect(publishSourcePush).not.toHaveBeenCalled();
    expect(recordDeliveryOnly).not.toHaveBeenCalled();
  });

  it('rejects push payloads that fail schema validation with 400', async () => {
    const {app, publishSourcePush, recordDeliveryOnly} = await createTestApp();
    const body = JSON.stringify({ref: 'refs/heads/main'});

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/gitea',
      headers: signedHeaders(body, 'push', randomUUID()),
      payload: body,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({error: 'malformed push payload'});
    expect(publishSourcePush).not.toHaveBeenCalled();
    expect(recordDeliveryOnly).not.toHaveBeenCalled();
  });
});
