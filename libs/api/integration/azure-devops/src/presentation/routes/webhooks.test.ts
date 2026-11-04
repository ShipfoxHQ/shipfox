import {Buffer} from 'node:buffer';
import {closeApp, createApp} from '@shipfox/node-fastify';
import type {FastifyInstance} from 'fastify';
import {createAzureDevOpsWebhookProcessor} from '#core/webhook-processor.js';
import {azureDevOpsConnection, memorySecrets, pushNotification} from '#test/index.js';
import {createAzureDevOpsWebhookRoutes} from './webhooks.js';

const USERNAME = 'shipfox-abc123';
const PASSWORD = 'correct-horse-battery-staple-0123456789';

async function createTestApp() {
  const connection = azureDevOpsConnection();
  const secrets = memorySecrets();
  await secrets.setSecrets({
    workspaceId: connection.workspaceId,
    namespace: connection.id,
    values: {webhook_password: PASSWORD},
  });
  const publishSourcePush = vi.fn(() => Promise.resolve({published: true}));
  const publishIntegrationEventReceived = vi.fn(() => Promise.resolve({published: true}));
  const recordDeliveryOnly = vi.fn(() => Promise.resolve({claimed: true}));
  const getIntegrationConnectionById = vi.fn((id: string) =>
    Promise.resolve(id === connection.id ? connection : undefined),
  );
  const processor = createAzureDevOpsWebhookProcessor({
    coreDb: () => ({transaction: (fn: (tx: unknown) => Promise<unknown>) => fn({})}) as never,
    secrets,
    publishSourcePush,
    publishIntegrationEventReceived,
    recordDeliveryOnly,
    getIntegrationConnectionById,
    getAzureDevOpsConnection: (id) =>
      Promise.resolve(
        id === connection.id
          ? {
              id: crypto.randomUUID(),
              connectionId: connection.id,
              organization: 'contoso',
              webhookUsername: USERNAME,
              createdAt: new Date(),
              updatedAt: new Date(),
            }
          : undefined,
      ),
  });
  const app: FastifyInstance = await createApp({
    routes: [createAzureDevOpsWebhookRoutes({processor})],
    swagger: false,
  });
  await app.ready();
  return {app, connection, publishSourcePush};
}

function basic(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}

describe('Azure DevOps webhook route', () => {
  beforeEach(async () => {
    await closeApp();
  });

  afterEach(async () => {
    await closeApp();
  });

  function post(app: FastifyInstance, connectionId: string, body: string, authorization?: string) {
    return app.inject({
      method: 'POST',
      url: `/webhooks/integrations/azure-devops/${connectionId}`,
      headers: {
        'content-type': 'application/json',
        ...(authorization ? {authorization} : {}),
      },
      payload: body,
    });
  }

  it('accepts a notification with the connection hook credentials and publishes the push', async () => {
    const {app, connection, publishSourcePush} = await createTestApp();

    const res = await post(
      app,
      connection.id,
      JSON.stringify(pushNotification()),
      basic(USERNAME, PASSWORD),
    );

    expect(res.statusCode).toBe(204);
    expect(publishSourcePush).toHaveBeenCalledTimes(1);
  });

  it('rejects a wrong password with 401 and publishes nothing', async () => {
    const {app, connection, publishSourcePush} = await createTestApp();

    const res = await post(
      app,
      connection.id,
      JSON.stringify(pushNotification()),
      basic(USERNAME, 'wrong'),
    );

    expect(res.statusCode).toBe(401);
    expect(publishSourcePush).not.toHaveBeenCalled();
  });

  it('rejects the right credentials sent to another connection id', async () => {
    const {app, publishSourcePush} = await createTestApp();

    const res = await post(
      app,
      crypto.randomUUID(),
      JSON.stringify(pushNotification()),
      basic(USERNAME, PASSWORD),
    );

    expect(res.statusCode).toBe(401);
    expect(publishSourcePush).not.toHaveBeenCalled();
  });

  it('rejects a request without authorization', async () => {
    const {app, connection} = await createTestApp();

    const res = await post(app, connection.id, JSON.stringify(pushNotification()));

    expect(res.statusCode).toBe(401);
  });

  it('rejects a body that is not a Service Hook notification with 400', async () => {
    const {app, connection, publishSourcePush} = await createTestApp();

    const res = await post(app, connection.id, '{"hello":"world"}', basic(USERNAME, PASSWORD));

    expect(res.statusCode).toBe(400);
    expect(publishSourcePush).not.toHaveBeenCalled();
  });

  it('rejects a connection id that is not a uuid', async () => {
    const {app} = await createTestApp();

    const res = await post(app, 'not-a-uuid', '{}', basic(USERNAME, PASSWORD));

    expect(res.statusCode).toBe(400);
  });
});
