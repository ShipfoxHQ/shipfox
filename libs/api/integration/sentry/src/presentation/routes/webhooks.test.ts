import {createHmac, randomUUID} from 'node:crypto';
import {sentryIssueActionSchema} from '@shipfox/api-integration-sentry-dto';
import {closeApp, createApp} from '@shipfox/node-fastify';
import type {FastifyInstance} from 'fastify';
import {
  db as coreDb,
  getIntegrationConnectionById,
  insertConnection,
  insertSentryInstallation,
  publishIntegrationEventReceived,
  readIntegrationsOutbox,
  readSentryInstallations,
  readWebhookDeliveries,
  recordDeliveryOnly,
  truncateIntegrationsState,
  updateConnectionLifecycleStatus,
} from '#test/fixtures/core-fixtures.js';
import {type CreateSentryWebhookRoutesOptions, createSentryWebhookRoutes} from './webhooks.js';

const CLIENT_SECRET = 'test-client-secret';
const URL = '/webhooks/integrations/sentry';

async function createTestApp(
  overrides: Partial<CreateSentryWebhookRoutesOptions> = {},
): Promise<FastifyInstance> {
  const routes = createSentryWebhookRoutes({
    coreDb,
    publishIntegrationEventReceived,
    recordDeliveryOnly,
    getIntegrationConnectionById,
    updateConnectionLifecycleStatus,
    ...overrides,
  });
  const app = await createApp({routes: [routes], swagger: false});
  await app.ready();
  return app;
}

async function seedInstallationConnection(
  installationUuid: string,
): Promise<{workspaceId: string}> {
  const connection = await insertConnection({externalAccountId: installationUuid});
  await insertSentryInstallation({connectionId: connection.id, installationUuid});
  return {workspaceId: connection.workspaceId};
}

function issueBody(opts: {
  action: string;
  installationUuid: string;
  issue?: Record<string, unknown>;
}) {
  return {
    action: opts.action,
    installation: {uuid: opts.installationUuid},
    data: {
      issue: {
        id: 'issue-123',
        shortId: 'PROJ-1',
        title: 'TypeError: boom',
        culprit: 'app/main',
        level: 'error',
        status: 'unresolved',
        platform: 'javascript',
        web_url: 'https://sentry.io/organizations/acme/issues/123/',
        url: 'https://sentry.io/api/0/issues/123/',
        project_url: 'https://sentry.io/api/0/projects/acme/web/',
        firstSeen: '2026-06-01T00:00:00Z',
        lastSeen: '2026-06-10T00:00:00Z',
        ...opts.issue,
      },
    },
  };
}

function sign(rawBody: string): string {
  return createHmac('sha256', CLIENT_SECRET).update(rawBody).digest('hex');
}

function signedHeaders(
  rawBody: string,
  resource: string,
  deliveryId: string,
  opts: {legacy?: boolean} = {},
) {
  const signatureHeader = opts.legacy ? 'sentry-app-signature' : 'sentry-hook-signature';
  return {
    'content-type': 'application/json',
    'request-id': deliveryId,
    'sentry-hook-resource': resource,
    [signatureHeader]: sign(rawBody),
  };
}

describe('Sentry webhook route', () => {
  beforeEach(async () => {
    await closeApp();
    await truncateIntegrationsState();
  });

  afterEach(async () => {
    await closeApp();
  });

  test('accepts a valid signed issue/created and writes outbox + delivery atomically', async () => {
    const installationUuid = 'install-created';
    const {workspaceId} = await seedInstallationConnection(installationUuid);
    const app = await createTestApp();
    const deliveryId = randomUUID();
    const body = JSON.stringify(issueBody({action: 'created', installationUuid}));

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: signedHeaders(body, 'issue', deliveryId),
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
      source: 'sentry',
      event: 'issue.created',
      workspaceId,
      deliveryId,
      payload: {
        action: 'created',
        issueId: 'issue-123',
        title: 'TypeError: boom',
        webUrl: 'https://sentry.io/organizations/acme/issues/123/',
        issueUrl: 'https://sentry.io/api/0/issues/123/',
        projectUrl: 'https://sentry.io/api/0/projects/acme/web/',
      },
    });
  });

  describe.each(sentryIssueActionSchema.options)('action "%s"', (action) => {
    test(`publishes event issue.${action}`, async () => {
      const installationUuid = `install-${action}`;
      await seedInstallationConnection(installationUuid);
      const app = await createTestApp();
      const deliveryId = randomUUID();
      const body = JSON.stringify(issueBody({action, installationUuid}));

      const res = await app.inject({
        method: 'POST',
        url: URL,
        headers: signedHeaders(body, 'issue', deliveryId),
        payload: body,
      });

      expect(res.statusCode).toBe(204);
      const outboxRows = await readIntegrationsOutbox();
      expect(outboxRows).toHaveLength(1);
      expect(outboxRows[0]?.payload).toMatchObject({event: `issue.${action}`});
    });
  });

  test('normalizes a raw "ignored" action to issue.archived', async () => {
    const installationUuid = 'install-ignored';
    await seedInstallationConnection(installationUuid);
    const app = await createTestApp();
    const deliveryId = randomUUID();
    const body = JSON.stringify(issueBody({action: 'ignored', installationUuid}));

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: signedHeaders(body, 'issue', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    const outboxRows = await readIntegrationsOutbox();
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0]?.payload).toMatchObject({
      event: 'issue.archived',
      payload: {action: 'archived'},
    });
  });

  test('falls back the title to "Sentry issue" and maps nullable fields to null', async () => {
    const installationUuid = 'install-minimal';
    await seedInstallationConnection(installationUuid);
    const app = await createTestApp();
    const deliveryId = randomUUID();
    const body = JSON.stringify({
      action: 'created',
      installation: {uuid: installationUuid},
      data: {issue: {id: 'issue-bare'}},
    });

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: signedHeaders(body, 'issue', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    const outboxRows = await readIntegrationsOutbox();
    expect(outboxRows[0]?.payload).toMatchObject({
      payload: {
        issueId: 'issue-bare',
        title: 'Sentry issue',
        shortId: null,
        culprit: null,
        webUrl: null,
        issueUrl: null,
        projectUrl: null,
        firstSeenAt: null,
        lastSeenAt: null,
      },
    });
  });

  test('rejects an invalid signature with 401 and writes no rows', async () => {
    const installationUuid = 'install-badsig';
    await seedInstallationConnection(installationUuid);
    const app = await createTestApp();
    const deliveryId = randomUUID();
    const body = JSON.stringify(issueBody({action: 'created', installationUuid}));

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: {
        'content-type': 'application/json',
        'request-id': deliveryId,
        'sentry-hook-resource': 'issue',
        'sentry-hook-signature': sign(`${body}tampered`),
      },
      payload: body,
    });

    expect(res.statusCode).toBe(401);
    expect(await readIntegrationsOutbox()).toHaveLength(0);
    expect(await readWebhookDeliveries()).toHaveLength(0);
  });

  test('rejects a garbage/short signature with 401 (not 500) and writes no rows', async () => {
    const app = await createTestApp();
    const body = JSON.stringify(issueBody({action: 'created', installationUuid: 'x'}));

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: {
        'content-type': 'application/json',
        'request-id': randomUUID(),
        'sentry-hook-resource': 'issue',
        'sentry-hook-signature': 'deadbeef',
      },
      payload: body,
    });

    expect(res.statusCode).toBe(401);
    expect(await readWebhookDeliveries()).toHaveLength(0);
  });

  test('returns 400 when Request-ID header is missing', async () => {
    const app = await createTestApp();
    const body = JSON.stringify(issueBody({action: 'created', installationUuid: 'x'}));

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: {
        'content-type': 'application/json',
        'sentry-hook-resource': 'issue',
        'sentry-hook-signature': sign(body),
      },
      payload: body,
    });

    expect(res.statusCode).toBe(400);
  });

  test('returns 400 when Sentry-Hook-Resource header is missing', async () => {
    const app = await createTestApp();
    const body = JSON.stringify(issueBody({action: 'created', installationUuid: 'x'}));

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: {
        'content-type': 'application/json',
        'request-id': randomUUID(),
        'sentry-hook-signature': sign(body),
      },
      payload: body,
    });

    expect(res.statusCode).toBe(400);
  });

  test('returns 401 when both signature headers are missing', async () => {
    const app = await createTestApp();
    const body = JSON.stringify(issueBody({action: 'created', installationUuid: 'x'}));

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: {
        'content-type': 'application/json',
        'request-id': randomUUID(),
        'sentry-hook-resource': 'issue',
      },
      payload: body,
    });

    expect(res.statusCode).toBe(401);
  });

  test('accepts a valid signature supplied via the legacy sentry-app-signature header', async () => {
    const installationUuid = 'install-legacy';
    await seedInstallationConnection(installationUuid);
    const app = await createTestApp();
    const deliveryId = randomUUID();
    const body = JSON.stringify(issueBody({action: 'created', installationUuid}));

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: signedHeaders(body, 'issue', deliveryId, {legacy: true}),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    expect(await readIntegrationsOutbox()).toHaveLength(1);
  });

  test('short-circuits duplicate deliveries on the same Request-ID', async () => {
    const installationUuid = 'install-dup';
    await seedInstallationConnection(installationUuid);
    const app = await createTestApp();
    const deliveryId = randomUUID();
    const body = JSON.stringify(issueBody({action: 'created', installationUuid}));
    const headers = signedHeaders(body, 'issue', deliveryId);

    const first = await app.inject({method: 'POST', url: URL, headers, payload: body});
    const second = await app.inject({method: 'POST', url: URL, headers, payload: body});

    expect(first.statusCode).toBe(204);
    expect(second.statusCode).toBe(204);
    expect(await readIntegrationsOutbox()).toHaveLength(1);
    expect(await readWebhookDeliveries()).toHaveLength(1);
  });

  test('drops issues from unknown installations (delivery recorded, no outbox row)', async () => {
    const app = await createTestApp();
    const deliveryId = randomUUID();
    const body = JSON.stringify(issueBody({action: 'created', installationUuid: 'unknown-uuid'}));

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: signedHeaders(body, 'issue', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    expect(await readIntegrationsOutbox()).toHaveLength(0);
    expect(await readWebhookDeliveries()).toHaveLength(1);
  });

  test('drops issues for a deleted installation (delivery recorded, no outbox row)', async () => {
    const installationUuid = 'install-deleted';
    const connection = await insertConnection({externalAccountId: installationUuid});
    await insertSentryInstallation({
      connectionId: connection.id,
      installationUuid,
      status: 'deleted',
    });
    const app = await createTestApp();
    const deliveryId = randomUUID();
    const body = JSON.stringify(issueBody({action: 'created', installationUuid}));

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: signedHeaders(body, 'issue', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    expect(await readIntegrationsOutbox()).toHaveLength(0);
    expect(await readWebhookDeliveries()).toHaveLength(1);
  });

  test('drops issues when the installation has no connection (injected undefined)', async () => {
    const installationUuid = 'install-noconn';
    await seedInstallationConnection(installationUuid);
    const app = await createTestApp({getIntegrationConnectionById: async () => undefined});
    const deliveryId = randomUUID();
    const body = JSON.stringify(issueBody({action: 'created', installationUuid}));

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: signedHeaders(body, 'issue', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    expect(await readIntegrationsOutbox()).toHaveLength(0);
    expect(await readWebhookDeliveries()).toHaveLength(1);
  });

  test('records-and-drops a non-issue, non-installation resource (event_alert)', async () => {
    const app = await createTestApp();
    const deliveryId = randomUUID();
    const body = JSON.stringify({hello: 'world'});

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: signedHeaders(body, 'event_alert', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    expect(await readIntegrationsOutbox()).toHaveLength(0);
    expect(await readWebhookDeliveries()).toHaveLength(1);
  });

  test('records-and-drops an unknown issue action', async () => {
    const installationUuid = 'install-unknown-action';
    await seedInstallationConnection(installationUuid);
    const app = await createTestApp();
    const deliveryId = randomUUID();
    const body = JSON.stringify(issueBody({action: 'frobnicated', installationUuid}));

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: signedHeaders(body, 'issue', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    expect(await readIntegrationsOutbox()).toHaveLength(0);
    expect(await readWebhookDeliveries()).toHaveLength(1);
  });

  test('records-and-drops a malformed issue payload', async () => {
    const app = await createTestApp();
    const deliveryId = randomUUID();
    const body = JSON.stringify({action: 'created', installation: {uuid: 'x'}, data: {}});

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: signedHeaders(body, 'issue', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    expect(await readIntegrationsOutbox()).toHaveLength(0);
    expect(await readWebhookDeliveries()).toHaveLength(1);
  });

  test('records-and-drops bad JSON after a valid signature (no 400)', async () => {
    const app = await createTestApp();
    const body = '{not valid json';
    const deliveryId = randomUUID();

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: signedHeaders(body, 'issue', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    expect(await readIntegrationsOutbox()).toHaveLength(0);
    expect(await readWebhookDeliveries()).toHaveLength(1);
  });

  test('installation/deleted disables the connection and marks the installation deleted', async () => {
    const installationUuid = 'install-lifecycle-del';
    const connection = await insertConnection({externalAccountId: installationUuid});
    await insertSentryInstallation({connectionId: connection.id, installationUuid});
    const app = await createTestApp();
    const deliveryId = randomUUID();
    const body = JSON.stringify({action: 'deleted', installation: {uuid: installationUuid}});

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: signedHeaders(body, 'installation', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    const installations = await readSentryInstallations();
    expect(installations[0]?.status).toBe('deleted');
    const connection2 = await getIntegrationConnectionById(connection.id);
    expect(connection2?.lifecycleStatus).toBe('disabled');
    expect(await readWebhookDeliveries()).toHaveLength(1);
  });

  test('installation/deleted with no matching row records the delivery and does not throw', async () => {
    const app = await createTestApp();
    const deliveryId = randomUUID();
    const body = JSON.stringify({action: 'deleted', installation: {uuid: 'never-installed'}});

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: signedHeaders(body, 'installation', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    expect(await readSentryInstallations()).toHaveLength(0);
    expect(await readWebhookDeliveries()).toHaveLength(1);
  });

  test('installation/created records the delivery and creates no installation row', async () => {
    const app = await createTestApp();
    const deliveryId = randomUUID();
    const body = JSON.stringify({action: 'created', installation: {uuid: 'install-pending'}});

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: signedHeaders(body, 'installation', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    expect(await readSentryInstallations()).toHaveLength(0);
    expect(await readWebhookDeliveries()).toHaveLength(1);
  });

  test('records-and-drops a malformed installation payload', async () => {
    const app = await createTestApp();
    const deliveryId = randomUUID();
    const body = JSON.stringify({action: 'suspended', installation: {uuid: 'x'}});

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: signedHeaders(body, 'installation', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    expect(await readWebhookDeliveries()).toHaveLength(1);
  });
});
