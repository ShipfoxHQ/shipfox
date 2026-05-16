import {createHmac, randomUUID} from 'node:crypto';
import {Webhooks} from '@octokit/webhooks';
import {closeApp, createApp} from '@shipfox/node-fastify';
import type {FastifyInstance} from 'fastify';
import {
  db as coreDb,
  getIntegrationConnectionById,
  insertConnection,
  insertGithubInstallation,
  publishIntegrationEventReceived,
  readIntegrationsOutbox,
  readWebhookDeliveries,
  recordDeliveryOnly,
  truncateIntegrationsState,
} from '#test/core-fixtures.js';
import {createGithubWebhookRoutes} from './webhooks.js';

const WEBHOOK_SECRET = 'test-webhook-secret';

async function createTestApp(): Promise<FastifyInstance> {
  const routes = createGithubWebhookRoutes({
    coreDb,
    publishIntegrationEventReceived,
    recordDeliveryOnly,
    getIntegrationConnectionById,
  });
  const app = await createApp({routes: [routes], swagger: false});
  await app.ready();
  return app;
}

async function seedInstallationConnection(installationId: number): Promise<void> {
  const connection = await insertConnection({externalAccountId: String(installationId)});
  await insertGithubInstallation({connectionId: connection.id, installationId});
}

function pushPayload(opts: {
  installationId: number;
  repositoryId: number;
  ref: string;
  defaultBranch: string;
  sha: string;
}) {
  return {
    ref: opts.ref,
    after: opts.sha,
    repository: {id: opts.repositoryId, default_branch: opts.defaultBranch},
    installation: {id: opts.installationId},
  };
}

function signedHeaders(rawBody: string, event: string, deliveryId: string) {
  const signature = `sha256=${createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex')}`;
  return {
    'content-type': 'application/json',
    'x-hub-signature-256': signature,
    'x-github-event': event,
    'x-github-delivery': deliveryId,
  };
}

describe('GitHub webhook route', () => {
  beforeEach(async () => {
    await closeApp();
    await truncateIntegrationsState();
  });

  afterEach(async () => {
    await closeApp();
  });

  it('matches the @octokit/webhooks signature helper with raw HMAC', async () => {
    const body = JSON.stringify({hello: 'world'});

    const hooks = new Webhooks({secret: WEBHOOK_SECRET});
    const expected = await hooks.sign(body);
    const result = `sha256=${createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex')}`;

    expect(result).toBe(expected);
  });

  it('accepts a valid push and writes outbox + delivery rows atomically', async () => {
    const installationId = 7777;
    await seedInstallationConnection(installationId);
    const app = await createTestApp();
    const deliveryId = randomUUID();
    const body = JSON.stringify(
      pushPayload({
        installationId,
        repositoryId: 42,
        ref: 'refs/heads/main',
        defaultBranch: 'main',
        sha: 'abc123',
      }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/github',
      headers: signedHeaders(body, 'push', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    const outboxRows = await readIntegrationsOutbox();
    const deliveryRows = await readWebhookDeliveries();
    expect(deliveryRows).toHaveLength(1);
    expect(deliveryRows[0]?.deliveryId).toBe(deliveryId);
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0]?.eventType).toBe('integrations.event.received');
    expect(outboxRows[0]?.payload).toMatchObject({
      source: 'github',
      event: 'push',
      deliveryId,
      payload: {
        externalRepositoryId: 'github:42',
        ref: 'main',
        headCommitSha: 'abc123',
        isDefaultBranch: true,
      },
    });
  });

  it('short-circuits duplicate deliveries on the same X-GitHub-Delivery', async () => {
    const installationId = 7778;
    await seedInstallationConnection(installationId);
    const app = await createTestApp();
    const deliveryId = randomUUID();
    const body = JSON.stringify(
      pushPayload({
        installationId,
        repositoryId: 99,
        ref: 'refs/heads/main',
        defaultBranch: 'main',
        sha: 'def456',
      }),
    );
    const headers = signedHeaders(body, 'push', deliveryId);

    const first = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/github',
      headers,
      payload: body,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/github',
      headers,
      payload: body,
    });

    expect(first.statusCode).toBe(204);
    expect(second.statusCode).toBe(204);
    const outboxRows = await readIntegrationsOutbox();
    const deliveryRows = await readWebhookDeliveries();
    expect(outboxRows).toHaveLength(1);
    expect(deliveryRows).toHaveLength(1);
  });

  it('rejects an invalid signature with 401 and writes no rows', async () => {
    const installationId = 7779;
    await seedInstallationConnection(installationId);
    const app = await createTestApp();
    const body = JSON.stringify(
      pushPayload({
        installationId,
        repositoryId: 100,
        ref: 'refs/heads/main',
        defaultBranch: 'main',
        sha: 'zzz',
      }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/github',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': 'sha256=deadbeef',
        'x-github-event': 'push',
        'x-github-delivery': randomUUID(),
      },
      payload: body,
    });

    expect(res.statusCode).toBe(401);
    const outboxRows = await readIntegrationsOutbox();
    const deliveryRows = await readWebhookDeliveries();
    expect(outboxRows).toHaveLength(0);
    expect(deliveryRows).toHaveLength(0);
  });

  it('publishes with isDefaultBranch=false when ref is not the default branch', async () => {
    const installationId = 7780;
    await seedInstallationConnection(installationId);
    const app = await createTestApp();
    const deliveryId = randomUUID();
    const body = JSON.stringify(
      pushPayload({
        installationId,
        repositoryId: 200,
        ref: 'refs/heads/feature/x',
        defaultBranch: 'main',
        sha: 'feat1',
      }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/github',
      headers: signedHeaders(body, 'push', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    const outboxRows = await readIntegrationsOutbox();
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0]?.payload).toMatchObject({
      source: 'github',
      event: 'push',
      payload: {
        ref: 'feature/x',
        isDefaultBranch: false,
      },
    });
  });

  it('drops non-push events with a delivery row but no outbox row', async () => {
    const installationId = 7781;
    await seedInstallationConnection(installationId);
    const app = await createTestApp();
    const deliveryId = randomUUID();
    const body = JSON.stringify({zen: 'Practicality beats purity.'});

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/github',
      headers: signedHeaders(body, 'ping', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    const outboxRows = await readIntegrationsOutbox();
    const deliveryRows = await readWebhookDeliveries();
    expect(outboxRows).toHaveLength(0);
    expect(deliveryRows).toHaveLength(1);
  });

  it('drops pushes from unknown installations (dedup recorded, no outbox row)', async () => {
    const app = await createTestApp();
    const deliveryId = randomUUID();
    const body = JSON.stringify(
      pushPayload({
        installationId: 999999,
        repositoryId: 300,
        ref: 'refs/heads/main',
        defaultBranch: 'main',
        sha: 'orphan',
      }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/github',
      headers: signedHeaders(body, 'push', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    const outboxRows = await readIntegrationsOutbox();
    const deliveryRows = await readWebhookDeliveries();
    expect(outboxRows).toHaveLength(0);
    expect(deliveryRows).toHaveLength(1);
  });

  it('drops pushes whose payload has no installation id (no outbox or delivery row)', async () => {
    const app = await createTestApp();
    const deliveryId = randomUUID();
    const body = JSON.stringify({
      ref: 'refs/heads/main',
      after: 'abc',
      repository: {id: 42, default_branch: 'main'},
    });

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/github',
      headers: signedHeaders(body, 'push', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    const outboxRows = await readIntegrationsOutbox();
    const deliveryRows = await readWebhookDeliveries();
    expect(outboxRows).toHaveLength(0);
    expect(deliveryRows).toHaveLength(0);
  });

  it('rejects malformed signature headers (verify throws) with 401 and writes no rows', async () => {
    const installationId = 7782;
    await seedInstallationConnection(installationId);
    const app = await createTestApp();
    const body = JSON.stringify(
      pushPayload({
        installationId,
        repositoryId: 101,
        ref: 'refs/heads/main',
        defaultBranch: 'main',
        sha: 'aaa',
      }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/github',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': 'not-a-real-signature-format',
        'x-github-event': 'push',
        'x-github-delivery': randomUUID(),
      },
      payload: body,
    });

    expect(res.statusCode).toBe(401);
    expect(await readIntegrationsOutbox()).toHaveLength(0);
    expect(await readWebhookDeliveries()).toHaveLength(0);
  });

  it('rejects malformed JSON after a valid signature with 400 and writes no rows', async () => {
    const app = await createTestApp();
    const body = '{not valid json';

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/github',
      headers: signedHeaders(body, 'push', randomUUID()),
      payload: body,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({error: 'malformed JSON'});
    expect(await readIntegrationsOutbox()).toHaveLength(0);
    expect(await readWebhookDeliveries()).toHaveLength(0);
  });

  it('rejects push payloads that fail schema validation with 400 and writes no rows', async () => {
    const app = await createTestApp();
    const body = JSON.stringify({ref: 'refs/heads/main'});

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/github',
      headers: signedHeaders(body, 'push', randomUUID()),
      payload: body,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({error: 'malformed push payload'});
    expect(await readIntegrationsOutbox()).toHaveLength(0);
    expect(await readWebhookDeliveries()).toHaveLength(0);
  });
});
