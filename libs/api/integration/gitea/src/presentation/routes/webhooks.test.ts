import {createHmac, randomUUID} from 'node:crypto';
import type {IntegrationConnection} from '@shipfox/api-integration-core-dto';
import {closeApp, createApp} from '@shipfox/node-fastify';
import type {FastifyInstance} from 'fastify';
import {db} from '#db/db.js';
import {giteaConnections} from '#db/schema/connections.js';
import {capturedGiteaPushPayload, giteaConnectionFactory, giteaPushPayload} from '#test/index.js';
import {createGiteaWebhookRoutes} from './webhooks.js';

// Must match GITEA_WEBHOOK_SECRET in test/env.ts.
const WEBHOOK_SECRET = 'test-webhook-secret';

function fakeConnection(overrides: Partial<IntegrationConnection> = {}): IntegrationConnection {
  return {
    id: randomUUID(),
    workspaceId: randomUUID(),
    provider: 'gitea',
    externalAccountId: 'shipfox',
    displayName: 'Gitea shipfox',
    lifecycleStatus: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

interface TestApp {
  app: FastifyInstance;
  publishSourcePush: ReturnType<typeof vi.fn>;
  recordDeliveryOnly: ReturnType<typeof vi.fn>;
  getIntegrationConnectionById: ReturnType<typeof vi.fn>;
}

async function createTestApp(options: {connection?: IntegrationConnection} = {}): Promise<TestApp> {
  const publishSourcePush = vi.fn(() => Promise.resolve({published: true}));
  const recordDeliveryOnly = vi.fn(() => Promise.resolve());
  const getIntegrationConnectionById = vi.fn(() =>
    Promise.resolve(options.connection ?? fakeConnection()),
  );
  const routes = createGiteaWebhookRoutes({
    coreDb: db,
    publishSourcePush,
    recordDeliveryOnly,
    getIntegrationConnectionById,
  });
  const app = await createApp({routes: [routes], swagger: false});
  await app.ready();
  return {app, publishSourcePush, recordDeliveryOnly, getIntegrationConnectionById};
}

async function seedConnection(org: string, connectionId?: string): Promise<void> {
  await giteaConnectionFactory.create({
    org,
    ...(connectionId !== undefined && {connectionId}),
  });
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
    await db().delete(giteaConnections);
  });

  afterEach(async () => {
    await closeApp();
  });

  it('publishes a mapped event for a valid push from a connected org', async () => {
    const connection = fakeConnection();
    await seedConnection('shipfox', connection.id);
    const {app, publishSourcePush, recordDeliveryOnly, getIntegrationConnectionById} =
      await createTestApp({connection});
    const deliveryId = randomUUID();
    const body = JSON.stringify(
      giteaPushPayload({
        owner: 'shipfox',
        repo: 'api',
        ref: 'refs/heads/main',
        defaultBranch: 'main',
        sha: 'abc123',
      }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/gitea',
      headers: signedHeaders(body, 'push', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    expect(recordDeliveryOnly).not.toHaveBeenCalled();
    expect(getIntegrationConnectionById).toHaveBeenCalledTimes(1);
    expect(getIntegrationConnectionById).toHaveBeenCalledWith(
      connection.id,
      expect.objectContaining({tx: expect.anything()}),
    );
    expect(publishSourcePush).toHaveBeenCalledTimes(1);
    const call = publishSourcePush.mock.calls[0]?.[0];
    expect(call.tx).toBeDefined();
    expect(call).toMatchObject({
      provider: 'gitea',
      deliveryId,
      workspaceId: connection.workspaceId,
      connectionId: connection.id,
      push: {
        externalRepositoryId: 'gitea:shipfox/api',
        ref: 'main',
        headCommitSha: 'abc123',
        isDefaultBranch: true,
      },
    });
  });

  it('accepts the captured local Gitea push payload shape', async () => {
    const connection = fakeConnection();
    await seedConnection('shipfox-demo', connection.id);
    const {app, publishSourcePush} = await createTestApp({connection});
    const deliveryId = randomUUID();
    const body = JSON.stringify(capturedGiteaPushPayload);

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/gitea',
      headers: signedHeaders(body, 'push', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    expect(publishSourcePush).toHaveBeenCalledTimes(1);
    expect(publishSourcePush.mock.calls[0]?.[0]).toMatchObject({
      provider: 'gitea',
      deliveryId,
      workspaceId: connection.workspaceId,
      connectionId: connection.id,
      push: {
        externalRepositoryId: 'gitea:shipfox-demo/api',
        ref: 'main',
        headCommitSha: capturedGiteaPushPayload.after,
        defaultBranch: 'main',
        isDefaultBranch: true,
      },
    });
  });

  it('publishes with isDefaultBranch=false when ref is not the default branch', async () => {
    await seedConnection('shipfox');
    const {app, publishSourcePush} = await createTestApp();
    const deliveryId = randomUUID();
    const body = JSON.stringify(
      giteaPushPayload({
        owner: 'shipfox',
        repo: 'api',
        ref: 'refs/heads/feature/x',
        defaultBranch: 'main',
        sha: 'feat1',
      }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/gitea',
      headers: signedHeaders(body, 'push', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    expect(publishSourcePush).toHaveBeenCalledTimes(1);
    expect(publishSourcePush.mock.calls[0]?.[0].push).toMatchObject({
      ref: 'feature/x',
      isDefaultBranch: false,
    });
  });

  it('resolves a mixed-case owner against the lower-cased stored org', async () => {
    const connection = fakeConnection();
    await seedConnection('shipfox', connection.id);
    const {app, publishSourcePush} = await createTestApp({connection});
    const deliveryId = randomUUID();
    const body = JSON.stringify(
      giteaPushPayload({
        owner: 'ShipFox',
        repo: 'API',
        ref: 'refs/heads/main',
        defaultBranch: 'main',
        sha: 'casing',
      }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/gitea',
      headers: signedHeaders(body, 'push', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    expect(publishSourcePush).toHaveBeenCalledTimes(1);
    // Repo id keeps the payload's verbatim casing to match the source-control adapter.
    expect(publishSourcePush.mock.calls[0]?.[0].push.externalRepositoryId).toBe(
      'gitea:ShipFox/API',
    );
  });

  it('ignores a branch deletion (all-zero after SHA) without publishing', async () => {
    const connection = fakeConnection();
    await seedConnection('shipfox', connection.id);
    const {app, publishSourcePush, recordDeliveryOnly} = await createTestApp({connection});
    const deliveryId = randomUUID();
    const body = JSON.stringify(
      giteaPushPayload({
        owner: 'shipfox',
        repo: 'api',
        ref: 'refs/heads/main',
        defaultBranch: 'main',
        sha: '0000000000000000000000000000000000000000',
      }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/gitea',
      headers: signedHeaders(body, 'push', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    expect(publishSourcePush).not.toHaveBeenCalled();
    expect(recordDeliveryOnly).not.toHaveBeenCalled();
  });

  it('records the delivery only for non-push events', async () => {
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

  it('records the delivery only for pushes from an unknown org', async () => {
    const {app, publishSourcePush, recordDeliveryOnly, getIntegrationConnectionById} =
      await createTestApp();
    const deliveryId = randomUUID();
    const body = JSON.stringify(
      giteaPushPayload({
        owner: 'ghost',
        repo: 'api',
        ref: 'refs/heads/main',
        defaultBranch: 'main',
        sha: 'orphan',
      }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/gitea',
      headers: signedHeaders(body, 'push', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    expect(publishSourcePush).not.toHaveBeenCalled();
    expect(getIntegrationConnectionById).not.toHaveBeenCalled();
    expect(recordDeliveryOnly).toHaveBeenCalledTimes(1);
    expect(recordDeliveryOnly.mock.calls[0]?.[0]).toMatchObject({provider: 'gitea', deliveryId});
  });

  it('records the delivery only when the org has no core connection', async () => {
    const {app, publishSourcePush, recordDeliveryOnly, getIntegrationConnectionById} =
      await createTestApp();
    getIntegrationConnectionById.mockResolvedValue(undefined);
    await seedConnection('shipfox');
    const deliveryId = randomUUID();
    const body = JSON.stringify(
      giteaPushPayload({
        owner: 'shipfox',
        repo: 'api',
        ref: 'refs/heads/main',
        defaultBranch: 'main',
        sha: 'dangling',
      }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/gitea',
      headers: signedHeaders(body, 'push', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    expect(getIntegrationConnectionById).toHaveBeenCalledTimes(1);
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
