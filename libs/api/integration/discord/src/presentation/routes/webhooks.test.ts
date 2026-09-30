import {WEBHOOK_MAX_RAW_BODY_BYTES} from '@shipfox/api-integration-spi';
import {closeApp, createApp} from '@shipfox/node-fastify';
import {DISCORD_ACK_WORKING} from '#core/interactions.js';
import {db} from '#db/db.js';
import {upsertDiscordInstallation} from '#db/installations.js';
import {discordInstallations} from '#db/schema/installations.js';
import {
  createDiscordSigner,
  fakeConnection,
  GUILD_ID,
  nowSeconds,
  pingInteraction,
  slashInteraction,
} from '#test/index.js';
import {createDiscordWebhookRoutes} from './webhooks.js';

const signer = createDiscordSigner();
const url = '/webhooks/integrations/discord/interactions';

async function createTestApp() {
  const connection = fakeConnection();
  await upsertDiscordInstallation({
    connectionId: connection.id,
    guildId: GUILD_ID,
    guildName: 'Acme',
    permissions: '0',
    status: 'installed',
  });
  const publishIntegrationEventReceived = vi.fn(() => Promise.resolve({published: true}));
  const app = await createApp({
    routes: [
      createDiscordWebhookRoutes({
        coreDb: db,
        publicKey: signer.publicKey,
        publishIntegrationEventReceived,
        recordDeliveryOnly: vi.fn(() => Promise.resolve()),
        getIntegrationConnectionById: vi.fn(() => Promise.resolve(connection)),
      }),
    ],
    swagger: false,
  });
  await app.ready();
  return {app, publishIntegrationEventReceived};
}

function signedHeaders(rawBody: string, timestamp = nowSeconds()) {
  return {
    'content-type': 'application/json',
    'x-signature-ed25519': signer.signBody({rawBody, timestamp}),
    'x-signature-timestamp': timestamp,
  };
}

describe('Discord interactions route', () => {
  let app: Awaited<ReturnType<typeof createTestApp>>['app'] | undefined;

  beforeEach(async () => {
    await db().delete(discordInstallations);
  });

  afterEach(async () => {
    if (app) await closeApp();
    app = undefined;
  });

  it('answers a signed PING with a PONG', async () => {
    ({app} = await createTestApp());
    const payload = JSON.stringify(pingInteraction());

    const response = await app.inject({
      method: 'POST',
      url,
      headers: signedHeaders(payload),
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({type: 1});
  });

  it('answers a signed slash command with the ephemeral acknowledgement', async () => {
    const test = await createTestApp();
    ({app} = test);
    const payload = JSON.stringify(slashInteraction());

    const response = await app.inject({
      method: 'POST',
      url,
      headers: signedHeaders(payload),
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({type: 4, data: {content: DISCORD_ACK_WORKING, flags: 64}});
    expect(test.publishIntegrationEventReceived).toHaveBeenCalledTimes(1);
  });

  it('rejects a request without signature headers with 401', async () => {
    ({app} = await createTestApp());

    const response = await app.inject({
      method: 'POST',
      url,
      headers: {'content-type': 'application/json'},
      payload: JSON.stringify(pingInteraction()),
    });

    expect(response.statusCode).toBe(401);
  });

  it('rejects an invalid signature with 401', async () => {
    const test = await createTestApp();
    ({app} = test);
    const payload = JSON.stringify(slashInteraction());

    const response = await app.inject({
      method: 'POST',
      url,
      headers: {...signedHeaders(payload), 'x-signature-ed25519': 'ab'.repeat(64)},
      payload,
    });

    expect(response.statusCode).toBe(401);
    expect(test.publishIntegrationEventReceived).not.toHaveBeenCalled();
  });

  it('rejects a validly signed request outside the freshness window with 401', async () => {
    const test = await createTestApp();
    ({app} = test);
    const payload = JSON.stringify(slashInteraction());

    const response = await app.inject({
      method: 'POST',
      url,
      headers: signedHeaders(payload, nowSeconds(-301)),
      payload,
    });

    expect(response.statusCode).toBe(401);
    expect(test.publishIntegrationEventReceived).not.toHaveBeenCalled();
  });

  it('rejects a signed body that is not valid JSON with 400', async () => {
    ({app} = await createTestApp());
    const payload = 'not json';

    const response = await app.inject({
      method: 'POST',
      url,
      headers: signedHeaders(payload),
      payload,
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects a body over the webhook size limit with 413', async () => {
    ({app} = await createTestApp());
    const payload = 'x'.repeat(WEBHOOK_MAX_RAW_BODY_BYTES + 1);

    const response = await app.inject({
      method: 'POST',
      url,
      headers: signedHeaders(payload),
      payload,
    });

    expect(response.statusCode).toBe(413);
  });
});
