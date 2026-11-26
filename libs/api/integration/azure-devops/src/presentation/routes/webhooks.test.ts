import {Buffer} from 'node:buffer';
import {closeApp, createApp} from '@shipfox/node-fastify';
import type {FastifyInstance} from 'fastify';
import {createAzureDevOpsWebhookProcessor} from '#core/webhook-processor.js';
import {azureDevOpsConnection, memorySecrets, pushNotification} from '#test/index.js';
import {createAzureDevOpsWebhookRoutes} from './webhooks.js';

interface HookCredentials {
  username: string;
  password: string;
}

const FIRST: HookCredentials = {
  username: 'shipfox-aaaaaa',
  password: 'first-correct-horse-battery-staple-01',
};
const SECOND: HookCredentials = {
  username: 'shipfox-bbbbbb',
  password: 'second-correct-horse-battery-staple-02',
};

async function createTestApp() {
  const first = azureDevOpsConnection();
  const second = azureDevOpsConnection({externalAccountId: 'fabrikam'});
  const hooks = new Map([
    [first.id, FIRST],
    [second.id, SECOND],
  ]);
  const secrets = memorySecrets();
  for (const connection of [first, second]) {
    await secrets.setSecrets({
      workspaceId: connection.workspaceId,
      namespace: connection.id,
      values: {WEBHOOK_PASSWORD: hooks.get(connection.id)?.password ?? ''},
    });
  }
  const publishSourcePush = vi.fn(() => Promise.resolve({published: true}));
  const getIntegrationConnectionById = vi.fn((id: string) =>
    Promise.resolve([first, second].find((connection) => connection.id === id)),
  );
  const processor = createAzureDevOpsWebhookProcessor({
    coreDb: () => ({transaction: (fn: (tx: unknown) => Promise<unknown>) => fn({})}) as never,
    secrets,
    publishSourcePush,
    publishIntegrationEventReceived: vi.fn(() => Promise.resolve({published: true})),
    recordDeliveryOnly: vi.fn(() => Promise.resolve({claimed: true})),
    getIntegrationConnectionById,
    getAzureDevOpsConnection: (id) => {
      const hook = hooks.get(id);
      return Promise.resolve(
        hook
          ? {
              id: crypto.randomUUID(),
              connectionId: id,
              organization: 'contoso',
              webhookUsername: hook.username,
              createdAt: new Date(),
              updatedAt: new Date(),
            }
          : undefined,
      );
    },
  });
  const app: FastifyInstance = await createApp({
    routes: [createAzureDevOpsWebhookRoutes({processor})],
    swagger: false,
  });
  await app.ready();
  return {app, first, second, publishSourcePush};
}

function basic(credentials: HookCredentials): string {
  return `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}`;
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
    const {app, first, publishSourcePush} = await createTestApp();

    const res = await post(app, first.id, JSON.stringify(pushNotification()), basic(FIRST));

    expect(res.statusCode).toBe(204);
    expect(publishSourcePush).toHaveBeenCalledTimes(1);
  });

  it('rejects a wrong password with 401 and publishes nothing', async () => {
    const {app, first, publishSourcePush} = await createTestApp();

    const res = await post(
      app,
      first.id,
      JSON.stringify(pushNotification()),
      basic({username: FIRST.username, password: 'wrong'}),
    );

    expect(res.statusCode).toBe(401);
    expect(publishSourcePush).not.toHaveBeenCalled();
  });

  it('rejects the right password with a wrong user name', async () => {
    const {app, first, publishSourcePush} = await createTestApp();

    const res = await post(
      app,
      first.id,
      JSON.stringify(pushNotification()),
      basic({username: 'shipfox-zzzzzz', password: FIRST.password}),
    );

    expect(res.statusCode).toBe(401);
    expect(publishSourcePush).not.toHaveBeenCalled();
  });

  it("rejects one connection's credentials sent to another connection", async () => {
    const {app, second, publishSourcePush} = await createTestApp();

    const res = await post(app, second.id, JSON.stringify(pushNotification()), basic(FIRST));

    expect(res.statusCode).toBe(401);
    expect(publishSourcePush).not.toHaveBeenCalled();
  });

  it('rejects an unknown connection id', async () => {
    const {app, publishSourcePush} = await createTestApp();

    const res = await post(
      app,
      crypto.randomUUID(),
      JSON.stringify(pushNotification()),
      basic(FIRST),
    );

    expect(res.statusCode).toBe(401);
    expect(publishSourcePush).not.toHaveBeenCalled();
  });

  it('rejects a request without authorization', async () => {
    const {app, first} = await createTestApp();

    const res = await post(app, first.id, JSON.stringify(pushNotification()));

    expect(res.statusCode).toBe(401);
  });

  it('rejects a body that is not a Service Hook notification with 400', async () => {
    const {app, first, publishSourcePush} = await createTestApp();

    const res = await post(app, first.id, '{"hello":"world"}', basic(FIRST));

    expect(res.statusCode).toBe(400);
    expect(publishSourcePush).not.toHaveBeenCalled();
  });

  it('rejects a connection id that is not a uuid', async () => {
    const {app} = await createTestApp();

    const res = await post(app, 'not-a-uuid', '{}', basic(FIRST));

    expect(res.statusCode).toBe(400);
  });
});
