import {createHmac, randomUUID} from 'node:crypto';
import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import {createStoredWebhookRequest} from '@shipfox/api-integration-spi';
import {db} from '#db/db.js';
import {upsertLinearInstallation} from '#db/installations.js';
import {linearInstallations} from '#db/schema/installations.js';
import {createLinearWebhookProcessor} from './webhook-processor.js';

const WEBHOOK_SECRET = 'test-webhook-secret';

function fakeConnection(overrides: Partial<IntegrationConnection> = {}): IntegrationConnection {
  return {
    id: randomUUID(),
    workspaceId: randomUUID(),
    provider: 'linear',
    externalAccountId: 'org-1',
    slug: 'Linear_Acme',
    displayName: 'Linear Acme',
    lifecycleStatus: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function signedRequest(input: {
  body: Record<string, unknown>;
  deliveryId?: string | undefined;
  receivedAt: string;
}) {
  const rawBody = Buffer.from(JSON.stringify(input.body));
  const signature = createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');

  return createStoredWebhookRequest({
    requestId: randomUUID(),
    routeId: 'linear',
    receivedAt: input.receivedAt,
    rawQueryString: '',
    headers: {
      'content-type': 'application/json',
      'linear-delivery': input.deliveryId ?? randomUUID(),
      'linear-event': String(input.body.type),
      'linear-signature': signature,
    },
    body: rawBody,
  });
}

async function seedInstallation(input: {
  connectionId: string;
  organizationId: string;
}): Promise<void> {
  await upsertLinearInstallation({
    connectionId: input.connectionId,
    organizationId: input.organizationId,
    organizationUrlKey: 'acme',
    appUserId: 'app-user-1',
    scopes: ['read', 'write'],
    status: 'installed',
  });
}

describe('Linear webhook processor', () => {
  beforeEach(async () => {
    await db().delete(linearInstallations);
  });

  it('accepts a delayed request that was valid when the adapter received it', async () => {
    const connection = fakeConnection();
    const receivedAt = new Date(Date.now() - 10 * 60_000).toISOString();
    const webhookTimestamp = new Date(receivedAt).getTime();
    const publishIntegrationEventReceived = vi.fn(() => Promise.resolve({published: true}));
    const processor = createLinearWebhookProcessor({
      coreDb: db,
      publishIntegrationEventReceived,
      recordDeliveryOnly: vi.fn(() => Promise.resolve({claimed: true})),
      getIntegrationConnectionById: vi.fn(() => Promise.resolve(connection)),
    });
    await seedInstallation({connectionId: connection.id, organizationId: 'org-delayed'});
    const request = signedRequest({
      receivedAt,
      body: {
        action: 'create',
        type: 'Issue',
        organizationId: 'org-delayed',
        webhookTimestamp,
        data: {id: 'issue-1'},
      },
    });

    const result = await processor.process(request);

    expect(result).toMatchObject({outcome: 'processed'});
    expect(publishIntegrationEventReceived).toHaveBeenCalledTimes(1);
  });

  it('discards a request that was stale when the adapter received it', async () => {
    const receivedAt = new Date().toISOString();
    const publishIntegrationEventReceived = vi.fn(() => Promise.resolve({published: true}));
    const processor = createLinearWebhookProcessor({
      coreDb: db,
      publishIntegrationEventReceived,
      recordDeliveryOnly: vi.fn(() => Promise.resolve({claimed: true})),
      getIntegrationConnectionById: vi.fn(),
    });
    const request = signedRequest({
      receivedAt,
      body: {
        action: 'create',
        type: 'Issue',
        organizationId: 'org-stale',
        webhookTimestamp: new Date(receivedAt).getTime() - 60_001,
        data: {id: 'issue-1'},
      },
    });

    const result = await processor.process(request);

    expect(result).toMatchObject({outcome: 'discarded', reason: 'stale_at_receipt'});
    expect(publishIntegrationEventReceived).not.toHaveBeenCalled();
  });

  it('records and drops an unsupported signed event', async () => {
    const connection = fakeConnection();
    const receivedAt = new Date().toISOString();
    const deliveryId = randomUUID();
    const recordDeliveryOnly = vi.fn(() => Promise.resolve({claimed: true}));
    const processor = createLinearWebhookProcessor({
      coreDb: db,
      publishIntegrationEventReceived: vi.fn(() => Promise.resolve({published: true})),
      recordDeliveryOnly,
      getIntegrationConnectionById: vi.fn(() => Promise.resolve(connection)),
    });
    await seedInstallation({connectionId: connection.id, organizationId: 'org-unsupported'});
    const request = signedRequest({
      deliveryId,
      receivedAt,
      body: {
        action: 'create',
        type: 'Reaction',
        organizationId: 'org-unsupported',
        webhookTimestamp: new Date(receivedAt).getTime(),
        data: {id: 'reaction-1'},
      },
    });

    const result = await processor.process(request);

    expect(result).toEqual({outcome: 'discarded', reason: 'unsupported_event', deliveryId});
    expect(recordDeliveryOnly).toHaveBeenCalledWith(
      expect.objectContaining({provider: 'linear', deliveryId}),
    );
  });

  describe('agent session acknowledgement', () => {
    function agentSessionRequest(input: {action: 'created' | 'prompted'; organizationId: string}) {
      const receivedAt = new Date().toISOString();
      return signedRequest({
        receivedAt,
        body: {
          action: input.action,
          type: 'AgentSessionEvent',
          organizationId: input.organizationId,
          appUserId: 'app-user-1',
          webhookTimestamp: new Date(receivedAt).getTime(),
          agentSession: {id: 'session-1'},
        },
      });
    }

    it('starts the acknowledgement before a delayed outbox publish settles', async () => {
      const connection = fakeConnection();
      await seedInstallation({connectionId: connection.id, organizationId: 'org-ack'});
      let releasePublish: (result: {published: boolean}) => void = () => undefined;
      const publishGate = new Promise<{published: boolean}>((resolve) => {
        releasePublish = resolve;
      });
      const events: string[] = [];
      const publishIntegrationEventReceived = vi.fn(async () => {
        events.push('publish-started');
        const result = await publishGate;
        events.push('publish-settled');
        return result;
      });
      const acknowledgeAgentSession = vi.fn(() => {
        events.push('acknowledged');
        return Promise.resolve();
      });
      const processor = createLinearWebhookProcessor({
        coreDb: db,
        publishIntegrationEventReceived,
        recordDeliveryOnly: vi.fn(() => Promise.resolve({claimed: true})),
        getIntegrationConnectionById: vi.fn(() => Promise.resolve(connection)),
        acknowledgeAgentSession,
      });

      const processing = processor.process(
        agentSessionRequest({action: 'created', organizationId: 'org-ack'}),
      );
      await vi.waitFor(() => expect(publishIntegrationEventReceived).toHaveBeenCalled());
      releasePublish({published: true});
      const result = await processing;

      expect(result).toMatchObject({outcome: 'processed'});
      expect(acknowledgeAgentSession).toHaveBeenCalledWith({
        connectionId: connection.id,
        agentSessionId: 'session-1',
      });
      expect(events).toEqual(['acknowledged', 'publish-started', 'publish-settled']);
    });

    it('answers the webhook while the acknowledgement is still running', async () => {
      const connection = fakeConnection();
      await seedInstallation({connectionId: connection.id, organizationId: 'org-slow-ack'});
      const acknowledgeAgentSession = vi.fn(() => new Promise<void>(() => undefined));
      const processor = createLinearWebhookProcessor({
        coreDb: db,
        publishIntegrationEventReceived: vi.fn(() => Promise.resolve({published: true})),
        recordDeliveryOnly: vi.fn(() => Promise.resolve({claimed: true})),
        getIntegrationConnectionById: vi.fn(() => Promise.resolve(connection)),
        acknowledgeAgentSession,
      });

      const result = await processor.process(
        agentSessionRequest({action: 'created', organizationId: 'org-slow-ack'}),
      );

      expect(result).toMatchObject({outcome: 'processed'});
      expect(acknowledgeAgentSession).toHaveBeenCalledTimes(1);
    });

    it('still publishes the event when the acknowledgement fails', async () => {
      const connection = fakeConnection();
      await seedInstallation({connectionId: connection.id, organizationId: 'org-failed-ack'});
      const publishIntegrationEventReceived = vi.fn(() => Promise.resolve({published: true}));
      const acknowledgeAgentSession = vi.fn(() => Promise.reject(new Error('Linear is down')));
      const processor = createLinearWebhookProcessor({
        coreDb: db,
        publishIntegrationEventReceived,
        recordDeliveryOnly: vi.fn(() => Promise.resolve({claimed: true})),
        getIntegrationConnectionById: vi.fn(() => Promise.resolve(connection)),
        acknowledgeAgentSession,
      });

      const result = await processor.process(
        agentSessionRequest({action: 'created', organizationId: 'org-failed-ack'}),
      );

      expect(result).toMatchObject({outcome: 'processed'});
      expect(acknowledgeAgentSession).toHaveBeenCalledWith({
        connectionId: connection.id,
        agentSessionId: 'session-1',
      });
      expect(publishIntegrationEventReceived).toHaveBeenCalledTimes(1);
    });

    it('does not acknowledge a prompt, which continues a session that already has activity', async () => {
      const connection = fakeConnection();
      await seedInstallation({connectionId: connection.id, organizationId: 'org-prompted'});
      const acknowledgeAgentSession = vi.fn(() => Promise.resolve());
      const processor = createLinearWebhookProcessor({
        coreDb: db,
        publishIntegrationEventReceived: vi.fn(() => Promise.resolve({published: true})),
        recordDeliveryOnly: vi.fn(() => Promise.resolve({claimed: true})),
        getIntegrationConnectionById: vi.fn(() => Promise.resolve(connection)),
        acknowledgeAgentSession,
      });

      await processor.process(
        agentSessionRequest({action: 'prompted', organizationId: 'org-prompted'}),
      );

      expect(acknowledgeAgentSession).not.toHaveBeenCalled();
    });

    it('does not acknowledge a session of a connection that is not active', async () => {
      const connection = fakeConnection({lifecycleStatus: 'disabled'});
      await seedInstallation({connectionId: connection.id, organizationId: 'org-disabled'});
      const acknowledgeAgentSession = vi.fn(() => Promise.resolve());
      const processor = createLinearWebhookProcessor({
        coreDb: db,
        publishIntegrationEventReceived: vi.fn(() => Promise.resolve({published: true})),
        recordDeliveryOnly: vi.fn(() => Promise.resolve({claimed: true})),
        getIntegrationConnectionById: vi.fn(() => Promise.resolve(connection)),
        acknowledgeAgentSession,
      });

      await processor.process(
        agentSessionRequest({action: 'created', organizationId: 'org-disabled'}),
      );

      expect(acknowledgeAgentSession).not.toHaveBeenCalled();
    });
  });
});
