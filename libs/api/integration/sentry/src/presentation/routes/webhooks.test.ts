import {createHmac, randomUUID} from 'node:crypto';
import type {IntegrationConnection} from '@shipfox/api-integration-core-dto';
import {sentryIssueActionSchema} from '@shipfox/api-integration-sentry-dto';
import {closeApp, createApp} from '@shipfox/node-fastify';
import {eq} from 'drizzle-orm';
import type {FastifyInstance} from 'fastify';
import {db} from '#db/db.js';
import {sentryInstallations} from '#db/schema/installations.js';
import {
  sentryInstallationFactory,
  sentryInstallationWebhook,
  sentryIssueWebhook,
} from '#test/index.js';
import {createSentryWebhookRoutes} from './webhooks.js';

const CLIENT_SECRET = 'test-client-secret';
const URL = '/webhooks/integrations/sentry';

// The route persists through injected core functions (publishIntegrationEventReceived,
// recordDeliveryOnly, getIntegrationConnectionById, updateConnectionLifecycleStatus)
// that @shipfox/api-integration-core owns and wires in production. sentry only
// orchestrates them, so here we fake that interface with spies and assert the route's
// own behavior: signature/payload validation, resource routing, and which core function
// it calls with what mapped event. The persistence itself (outbox + delivery rows, dedup)
// is tested in core, against core's own tables. The route's reads/writes of sentry's own
// `installations` table are exercised for real against sentry's schema.
function fakeConnection(overrides: Partial<IntegrationConnection> = {}): IntegrationConnection {
  return {
    id: randomUUID(),
    workspaceId: randomUUID(),
    provider: 'sentry',
    externalAccountId: 'install-uuid',
    displayName: 'Sentry acme',
    lifecycleStatus: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

interface TestApp {
  app: FastifyInstance;
  publishIntegrationEventReceived: ReturnType<typeof vi.fn>;
  recordDeliveryOnly: ReturnType<typeof vi.fn>;
  getIntegrationConnectionById: ReturnType<typeof vi.fn>;
  updateConnectionLifecycleStatus: ReturnType<typeof vi.fn>;
}

async function createTestApp(options: {connection?: IntegrationConnection} = {}): Promise<TestApp> {
  const publishIntegrationEventReceived = vi.fn(() => Promise.resolve({published: true}));
  const recordDeliveryOnly = vi.fn(() => Promise.resolve());
  const getIntegrationConnectionById = vi.fn(() =>
    Promise.resolve(options.connection ?? fakeConnection()),
  );
  const updateConnectionLifecycleStatus = vi.fn(() => Promise.resolve(undefined));
  const routes = createSentryWebhookRoutes({
    coreDb: db,
    publishIntegrationEventReceived,
    recordDeliveryOnly,
    getIntegrationConnectionById,
    updateConnectionLifecycleStatus,
  });
  const app = await createApp({routes: [routes], swagger: false});
  await app.ready();
  return {
    app,
    publishIntegrationEventReceived,
    recordDeliveryOnly,
    getIntegrationConnectionById,
    updateConnectionLifecycleStatus,
  };
}

async function seedInstallation(
  installationUuid: string,
  options: {connectionId?: string; status?: 'installed' | 'deleted'} = {},
): Promise<void> {
  await sentryInstallationFactory.create({
    installationUuid,
    ...(options.connectionId !== undefined && {connectionId: options.connectionId}),
    ...(options.status !== undefined && {status: options.status}),
  });
}

async function readInstallation(installationUuid: string) {
  const rows = await db()
    .select()
    .from(sentryInstallations)
    .where(eq(sentryInstallations.installationUuid, installationUuid))
    .limit(1);
  return rows[0];
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
    await db().delete(sentryInstallations);
  });

  afterEach(async () => {
    await closeApp();
  });

  test('publishes a mapped event for a valid signed issue from a known installation', async () => {
    const installationUuid = 'install-created';
    const connection = fakeConnection();
    await seedInstallation(installationUuid, {connectionId: connection.id});
    const {app, publishIntegrationEventReceived, recordDeliveryOnly, getIntegrationConnectionById} =
      await createTestApp({connection});
    const deliveryId = randomUUID();
    const body = JSON.stringify(sentryIssueWebhook({action: 'created', installationUuid}));

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: signedHeaders(body, 'issue', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    expect(recordDeliveryOnly).not.toHaveBeenCalled();
    expect(getIntegrationConnectionById).toHaveBeenCalledTimes(1);
    expect(getIntegrationConnectionById).toHaveBeenCalledWith(
      connection.id,
      expect.objectContaining({tx: expect.anything()}),
    );
    expect(publishIntegrationEventReceived).toHaveBeenCalledTimes(1);
    const call = publishIntegrationEventReceived.mock.calls[0]?.[0];
    expect(call.tx).toBeDefined();
    expect(call.event).toMatchObject({
      source: 'sentry',
      event: 'issue.created',
      deliveryId,
      workspaceId: connection.workspaceId,
      connectionId: connection.id,
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
      await seedInstallation(installationUuid);
      const {app, publishIntegrationEventReceived} = await createTestApp();
      const deliveryId = randomUUID();
      const body = JSON.stringify(sentryIssueWebhook({action, installationUuid}));

      const res = await app.inject({
        method: 'POST',
        url: URL,
        headers: signedHeaders(body, 'issue', deliveryId),
        payload: body,
      });

      expect(res.statusCode).toBe(204);
      expect(publishIntegrationEventReceived).toHaveBeenCalledTimes(1);
      expect(publishIntegrationEventReceived.mock.calls[0]?.[0].event).toMatchObject({
        event: `issue.${action}`,
      });
    });
  });

  test('normalizes a raw "ignored" action to issue.archived', async () => {
    const installationUuid = 'install-ignored';
    await seedInstallation(installationUuid);
    const {app, publishIntegrationEventReceived} = await createTestApp();
    const deliveryId = randomUUID();
    const body = JSON.stringify(sentryIssueWebhook({action: 'ignored', installationUuid}));

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: signedHeaders(body, 'issue', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    expect(publishIntegrationEventReceived.mock.calls[0]?.[0].event).toMatchObject({
      event: 'issue.archived',
      payload: {action: 'archived'},
    });
  });

  test('falls back the title to "Sentry issue" and maps nullable fields to null', async () => {
    const installationUuid = 'install-minimal';
    await seedInstallation(installationUuid);
    const {app, publishIntegrationEventReceived} = await createTestApp();
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
    expect(publishIntegrationEventReceived.mock.calls[0]?.[0].event.payload).toMatchObject({
      issueId: 'issue-bare',
      title: 'Sentry issue',
      shortId: null,
      culprit: null,
      webUrl: null,
      issueUrl: null,
      projectUrl: null,
      firstSeenAt: null,
      lastSeenAt: null,
    });
  });

  test('rejects an invalid signature with 401 and persists nothing', async () => {
    const installationUuid = 'install-badsig';
    await seedInstallation(installationUuid);
    const {app, publishIntegrationEventReceived, recordDeliveryOnly} = await createTestApp();
    const deliveryId = randomUUID();
    const body = JSON.stringify(sentryIssueWebhook({action: 'created', installationUuid}));

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
    expect(publishIntegrationEventReceived).not.toHaveBeenCalled();
    expect(recordDeliveryOnly).not.toHaveBeenCalled();
  });

  test('rejects a garbage/short signature with 401 (not 500) and persists nothing', async () => {
    const {app, publishIntegrationEventReceived, recordDeliveryOnly} = await createTestApp();
    const body = JSON.stringify(sentryIssueWebhook({action: 'created', installationUuid: 'x'}));

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
    expect(publishIntegrationEventReceived).not.toHaveBeenCalled();
    expect(recordDeliveryOnly).not.toHaveBeenCalled();
  });

  test('returns 400 when Request-ID header is missing', async () => {
    const {app} = await createTestApp();
    const body = JSON.stringify(sentryIssueWebhook({action: 'created', installationUuid: 'x'}));

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
    const {app} = await createTestApp();
    const body = JSON.stringify(sentryIssueWebhook({action: 'created', installationUuid: 'x'}));

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
    const {app} = await createTestApp();
    const body = JSON.stringify(sentryIssueWebhook({action: 'created', installationUuid: 'x'}));

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
    await seedInstallation(installationUuid);
    const {app, publishIntegrationEventReceived} = await createTestApp();
    const deliveryId = randomUUID();
    const body = JSON.stringify(sentryIssueWebhook({action: 'created', installationUuid}));

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: signedHeaders(body, 'issue', deliveryId, {legacy: true}),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    expect(publishIntegrationEventReceived).toHaveBeenCalledTimes(1);
  });

  test('forwards each delivery to publish (dedup is owned by core)', async () => {
    const installationUuid = 'install-dup';
    await seedInstallation(installationUuid);
    const {app, publishIntegrationEventReceived} = await createTestApp();
    const deliveryId = randomUUID();
    const body = JSON.stringify(sentryIssueWebhook({action: 'created', installationUuid}));
    const headers = signedHeaders(body, 'issue', deliveryId);
    publishIntegrationEventReceived
      .mockResolvedValueOnce({published: true})
      .mockResolvedValueOnce({published: false});

    const first = await app.inject({method: 'POST', url: URL, headers, payload: body});
    const second = await app.inject({method: 'POST', url: URL, headers, payload: body});

    expect(first.statusCode).toBe(204);
    expect(second.statusCode).toBe(204);
    expect(publishIntegrationEventReceived).toHaveBeenCalledTimes(2);
    expect(publishIntegrationEventReceived.mock.calls[0]?.[0].event.deliveryId).toBe(deliveryId);
    expect(publishIntegrationEventReceived.mock.calls[1]?.[0].event.deliveryId).toBe(deliveryId);
  });

  test('records the delivery only for issues from unknown installations', async () => {
    const {app, publishIntegrationEventReceived, recordDeliveryOnly, getIntegrationConnectionById} =
      await createTestApp();
    const deliveryId = randomUUID();
    const body = JSON.stringify(
      sentryIssueWebhook({action: 'created', installationUuid: 'unknown-uuid'}),
    );

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: signedHeaders(body, 'issue', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    expect(getIntegrationConnectionById).not.toHaveBeenCalled();
    expect(publishIntegrationEventReceived).not.toHaveBeenCalled();
    expect(recordDeliveryOnly).toHaveBeenCalledTimes(1);
    expect(recordDeliveryOnly.mock.calls[0]?.[0]).toMatchObject({provider: 'sentry', deliveryId});
  });

  test('records the delivery only for issues from a deleted installation', async () => {
    const installationUuid = 'install-deleted';
    await seedInstallation(installationUuid, {status: 'deleted'});
    const {app, publishIntegrationEventReceived, recordDeliveryOnly, getIntegrationConnectionById} =
      await createTestApp();
    const deliveryId = randomUUID();
    const body = JSON.stringify(sentryIssueWebhook({action: 'created', installationUuid}));

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: signedHeaders(body, 'issue', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    expect(getIntegrationConnectionById).not.toHaveBeenCalled();
    expect(publishIntegrationEventReceived).not.toHaveBeenCalled();
    expect(recordDeliveryOnly).toHaveBeenCalledTimes(1);
  });

  test('records the delivery only when the installation has no connection', async () => {
    const installationUuid = 'install-noconn';
    await seedInstallation(installationUuid);
    const {app, publishIntegrationEventReceived, recordDeliveryOnly, getIntegrationConnectionById} =
      await createTestApp();
    getIntegrationConnectionById.mockResolvedValue(undefined);
    const deliveryId = randomUUID();
    const body = JSON.stringify(sentryIssueWebhook({action: 'created', installationUuid}));

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: signedHeaders(body, 'issue', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    expect(getIntegrationConnectionById).toHaveBeenCalledTimes(1);
    expect(publishIntegrationEventReceived).not.toHaveBeenCalled();
    expect(recordDeliveryOnly).toHaveBeenCalledTimes(1);
  });

  test('records the delivery only for a non-issue, non-installation resource', async () => {
    const {app, publishIntegrationEventReceived, recordDeliveryOnly} = await createTestApp();
    const deliveryId = randomUUID();
    const body = JSON.stringify({hello: 'world'});

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: signedHeaders(body, 'event_alert', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    expect(publishIntegrationEventReceived).not.toHaveBeenCalled();
    expect(recordDeliveryOnly).toHaveBeenCalledTimes(1);
    expect(recordDeliveryOnly.mock.calls[0]?.[0]).toMatchObject({provider: 'sentry', deliveryId});
  });

  test('records the delivery only for an unknown issue action', async () => {
    const installationUuid = 'install-unknown-action';
    await seedInstallation(installationUuid);
    const {app, publishIntegrationEventReceived, recordDeliveryOnly} = await createTestApp();
    const deliveryId = randomUUID();
    const body = JSON.stringify(sentryIssueWebhook({action: 'frobnicated', installationUuid}));

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: signedHeaders(body, 'issue', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    expect(publishIntegrationEventReceived).not.toHaveBeenCalled();
    expect(recordDeliveryOnly).toHaveBeenCalledTimes(1);
  });

  test('records the delivery only for a malformed issue payload', async () => {
    const {app, publishIntegrationEventReceived, recordDeliveryOnly} = await createTestApp();
    const deliveryId = randomUUID();
    const body = JSON.stringify({action: 'created', installation: {uuid: 'x'}, data: {}});

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: signedHeaders(body, 'issue', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    expect(publishIntegrationEventReceived).not.toHaveBeenCalled();
    expect(recordDeliveryOnly).toHaveBeenCalledTimes(1);
  });

  test('records the delivery only for bad JSON after a valid signature (no 400)', async () => {
    const {app, publishIntegrationEventReceived, recordDeliveryOnly} = await createTestApp();
    const body = '{not valid json';
    const deliveryId = randomUUID();

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: signedHeaders(body, 'issue', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    expect(publishIntegrationEventReceived).not.toHaveBeenCalled();
    expect(recordDeliveryOnly).toHaveBeenCalledTimes(1);
  });

  test('installation/deleted disables the connection and marks the installation deleted', async () => {
    const installationUuid = 'install-lifecycle-del';
    const connectionId = randomUUID();
    await seedInstallation(installationUuid, {connectionId});
    const {app, recordDeliveryOnly, updateConnectionLifecycleStatus} = await createTestApp();
    const deliveryId = randomUUID();
    const body = JSON.stringify(sentryInstallationWebhook({action: 'deleted', installationUuid}));

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: signedHeaders(body, 'installation', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    expect((await readInstallation(installationUuid))?.status).toBe('deleted');
    expect(updateConnectionLifecycleStatus).toHaveBeenCalledTimes(1);
    expect(updateConnectionLifecycleStatus).toHaveBeenCalledWith(
      {id: connectionId, lifecycleStatus: 'disabled'},
      expect.objectContaining({tx: expect.anything()}),
    );
    expect(recordDeliveryOnly).toHaveBeenCalledTimes(1);
  });

  test('installation/deleted with no matching row records the delivery and does not disable', async () => {
    const {app, recordDeliveryOnly, updateConnectionLifecycleStatus} = await createTestApp();
    const deliveryId = randomUUID();
    const body = JSON.stringify(
      sentryInstallationWebhook({action: 'deleted', installationUuid: 'never-installed'}),
    );

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: signedHeaders(body, 'installation', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    expect(updateConnectionLifecycleStatus).not.toHaveBeenCalled();
    expect(recordDeliveryOnly).toHaveBeenCalledTimes(1);
  });

  test('installation/created records the delivery and creates no installation row', async () => {
    const {app, recordDeliveryOnly, updateConnectionLifecycleStatus} = await createTestApp();
    const deliveryId = randomUUID();
    const body = JSON.stringify(
      sentryInstallationWebhook({action: 'created', installationUuid: 'install-pending'}),
    );

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: signedHeaders(body, 'installation', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    expect(await readInstallation('install-pending')).toBeUndefined();
    expect(updateConnectionLifecycleStatus).not.toHaveBeenCalled();
    expect(recordDeliveryOnly).toHaveBeenCalledTimes(1);
  });

  test('records the delivery only for a malformed installation payload', async () => {
    const {app, recordDeliveryOnly} = await createTestApp();
    const deliveryId = randomUUID();
    const body = JSON.stringify(
      sentryInstallationWebhook({action: 'suspended', installationUuid: 'x'}),
    );

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: signedHeaders(body, 'installation', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    expect(recordDeliveryOnly).toHaveBeenCalledTimes(1);
  });
});
