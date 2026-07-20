import {createHmac, randomUUID} from 'node:crypto';
import {
  createStoredWebhookRequest,
  type IntegrationConnection,
} from '@shipfox/api-integration-core-dto';
import {eq} from 'drizzle-orm';
import type {SentryApiClient} from '#api/client.js';
import {db} from '#db/db.js';
import {sentryInstallations} from '#db/schema/installations.js';
import {sentryInstallationFactory, sentryIssueWebhookFactory} from '#test/index.js';
import {createSentryWebhookProcessor} from './webhook-processor.js';

const CLIENT_SECRET = 'test-client-secret';

function fakeConnection(overrides: Partial<IntegrationConnection> = {}): IntegrationConnection {
  return {
    id: randomUUID(),
    workspaceId: randomUUID(),
    provider: 'sentry',
    externalAccountId: 'install-uuid',
    slug: 'sentry_acme',
    displayName: 'Sentry acme',
    lifecycleStatus: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function sentryClient(): SentryApiClient {
  return {
    exchangeAuthorizationCode: vi.fn(() =>
      Promise.resolve({token: 'tok', refreshToken: 'refresh', expiresAt: 'x'}),
    ),
    getInstallation: vi.fn(() => Promise.resolve({orgSlug: 'acme'})),
    verifyInstallation: vi.fn(() => Promise.resolve()),
  };
}

function signedRequest(input: {body: unknown; deliveryId?: string; resource: string}) {
  const rawBody = Buffer.from(JSON.stringify(input.body));
  const signature = createHmac('sha256', CLIENT_SECRET).update(rawBody).digest('hex');

  return createStoredWebhookRequest({
    requestId: randomUUID(),
    routeId: 'sentry',
    receivedAt: new Date().toISOString(),
    rawQueryString: '',
    headers: {
      'content-type': 'application/json',
      'request-id': input.deliveryId ?? randomUUID(),
      'sentry-hook-resource': input.resource,
      'sentry-hook-signature': signature,
    },
    body: rawBody,
  });
}

describe('Sentry webhook processor', () => {
  beforeEach(async () => {
    await db().delete(sentryInstallations);
  });

  it('processes a valid issue delivery outside the HTTP adapter', async () => {
    const connection = fakeConnection();
    const installationUuid = 'processor-issue-installation';
    const publishIntegrationEventReceived = vi.fn(() => Promise.resolve({published: true}));
    const processor = createSentryWebhookProcessor({
      sentry: sentryClient(),
      coreDb: db,
      publishIntegrationEventReceived,
      recordDeliveryOnly: vi.fn(() => Promise.resolve()),
      getIntegrationConnectionById: vi.fn(() => Promise.resolve(connection)),
      updateConnectionLifecycleStatus: vi.fn(() => Promise.resolve(undefined)),
    });
    await sentryInstallationFactory.create({installationUuid, connectionId: connection.id});
    const request = signedRequest({
      resource: 'issue',
      body: sentryIssueWebhookFactory.build({
        action: 'created',
        installation: {uuid: installationUuid},
      }),
    });

    const result = await processor.process(request);

    expect(result).toMatchObject({outcome: 'processed'});
    expect(publishIntegrationEventReceived).toHaveBeenCalledOnce();
  });

  it('processes an installation deletion outside the HTTP adapter', async () => {
    const installationUuid = 'processor-installation-deletion';
    const updateConnectionLifecycleStatus = vi.fn(() => Promise.resolve(undefined));
    const processor = createSentryWebhookProcessor({
      sentry: sentryClient(),
      coreDb: db,
      publishIntegrationEventReceived: vi.fn(() => Promise.resolve({published: true})),
      recordDeliveryOnly: vi.fn(() => Promise.resolve()),
      getIntegrationConnectionById: vi.fn(() => Promise.resolve(fakeConnection())),
      updateConnectionLifecycleStatus,
    });
    const connectionId = randomUUID();
    await sentryInstallationFactory.create({installationUuid, connectionId});
    const request = signedRequest({
      resource: 'installation',
      body: {action: 'deleted', data: {installation: {uuid: installationUuid}}},
    });

    const result = await processor.process(request);

    const [installation] = await db()
      .select()
      .from(sentryInstallations)
      .where(eq(sentryInstallations.installationUuid, installationUuid));
    expect(result).toMatchObject({outcome: 'processed'});
    expect(installation?.status).toBe('deleted');
    expect(updateConnectionLifecycleStatus).toHaveBeenCalledWith(
      {id: connectionId, lifecycleStatus: 'disabled'},
      expect.objectContaining({tx: expect.anything()}),
    );
  });

  it('does not create a side effect for an invalid signature', async () => {
    const publishIntegrationEventReceived = vi.fn(() => Promise.resolve({published: true}));
    const processor = createSentryWebhookProcessor({
      sentry: sentryClient(),
      coreDb: db,
      publishIntegrationEventReceived,
      recordDeliveryOnly: vi.fn(() => Promise.resolve()),
      getIntegrationConnectionById: vi.fn(() => Promise.resolve(fakeConnection())),
      updateConnectionLifecycleStatus: vi.fn(() => Promise.resolve(undefined)),
    });
    const request = signedRequest({
      resource: 'issue',
      body: sentryIssueWebhookFactory.build({action: 'created'}),
    });
    request.headers['sentry-hook-signature'] = 'not-a-signature';

    const result = await processor.process(request);

    expect(result).toMatchObject({outcome: 'discarded', reason: 'invalid_signature'});
    expect(publishIntegrationEventReceived).not.toHaveBeenCalled();
  });
});
