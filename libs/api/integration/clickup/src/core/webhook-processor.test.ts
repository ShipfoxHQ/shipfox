import {createHmac} from 'node:crypto';
import type {ClickUpWebhookEventName} from '@shipfox/api-integration-clickup-dto';
import {createStoredWebhookRequest, type IntegrationConnection} from '@shipfox/api-integration-spi';
import type {NodePgDatabase} from 'drizzle-orm/node-postgres';
import {createClickUpWebhookProcessor} from './webhook-processor.js';

const connectionId = 'c0a8012e-0b6d-4d8f-8d5c-6d74102602b0';
const workspaceId = 'a0a8012e-0b6d-4d8f-8d5c-6d74102602b0';
const webhookId = 'webhook-1';
const webhookSecret = 'webhook-secret';
const authorizingUserId = 'authorizing-user';
const receivedAt = '2026-07-20T10:30:00.123Z';

const actorBearingEvents: ClickUpWebhookEventName[] = [
  'taskCreated',
  'taskUpdated',
  'taskMoved',
  'taskStatusUpdated',
  'taskAssigneeUpdated',
  'taskPriorityUpdated',
  'taskDueDateUpdated',
  'taskTagUpdated',
  'taskCommentPosted',
  'taskCommentUpdated',
];

function createConnection(
  overrides: Partial<IntegrationConnection<'clickup'>> = {},
): IntegrationConnection<'clickup'> {
  const now = new Date();
  return {
    id: connectionId,
    workspaceId,
    provider: 'clickup',
    externalAccountId: 'team-1',
    slug: 'clickup_acme',
    displayName: 'ClickUp Acme',
    lifecycleStatus: 'active',
    repositoryAccessMode: 'selected',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function createHistoryItem(userId = 'other-user', id = 'history-1') {
  return {
    id,
    type: 1,
    date: '1710000000000',
    field: 'status',
    parent_id: 'list-1',
    data: {},
    source: {},
    user: {id: userId, username: 'user'},
    before: null,
    after: {status: 'open'},
  };
}

function createPayload(
  event: ClickUpWebhookEventName | string = 'taskUpdated',
  userId = 'other-user',
  historyId = 'history-1',
): Record<string, unknown> {
  if (event === 'taskDeleted') {
    return {event, webhook_id: webhookId, task_id: 'task-1'};
  }
  const historyItem = createHistoryItem(userId, historyId);
  if (event === 'taskCommentPosted' || event === 'taskCommentUpdated') {
    return {
      event,
      webhook_id: webhookId,
      task_id: 'task-1',
      history_items: [
        {
          ...historyItem,
          comment: {
            id: 'comment-1',
            text_content: 'Hello',
            comment: [],
            user: {id: userId},
            date: '1710000000000',
          },
        },
      ],
    };
  }
  return {event, webhook_id: webhookId, task_id: 'task-1', history_items: [historyItem]};
}

function createRequest(
  payload: unknown,
  options: {signature?: string; requestConnectionId?: string} = {},
) {
  const body = new TextEncoder().encode(
    typeof payload === 'string' ? payload : JSON.stringify(payload),
  );
  const signature =
    options.signature ?? createHmac('sha256', webhookSecret).update(body).digest('hex');
  return createStoredWebhookRequest({
    requestId: crypto.randomUUID(),
    routeId: 'clickup',
    receivedAt,
    rawQueryString: '',
    headers: {'content-type': 'application/json', ...(signature ? {'x-signature': signature} : {})},
    body,
    connectionId: options.requestConnectionId ?? connectionId,
  });
}

function createHarness(
  overrides: {
    connection?: IntegrationConnection<'clickup'> | null;
    installation?: Record<string, unknown> | null;
    secret?: string | null;
    published?: boolean;
  } = {},
) {
  const seenDeliveryIds = new Set<string>();
  const publishIntegrationEventReceived = vi.fn().mockImplementation(({event}) => {
    if (overrides.published === false || seenDeliveryIds.has(event.deliveryId)) {
      return Promise.resolve({published: false});
    }
    seenDeliveryIds.add(event.deliveryId);
    return Promise.resolve({published: true});
  });
  const recordDeliveryOnly = vi.fn().mockResolvedValue(undefined);
  const coreDb = vi.fn(() => ({
    transaction: async (callback: (tx: unknown) => Promise<unknown>) => await callback({}),
  }));
  const getIntegrationConnectionById = vi
    .fn()
    .mockResolvedValue(
      overrides.connection === null ? undefined : (overrides.connection ?? createConnection()),
    );
  const getClickUpInstallationByConnectionId = vi.fn().mockResolvedValue(
    overrides.installation === null
      ? undefined
      : (overrides.installation ?? {
          id: 'installation-1',
          connectionId,
          teamId: 'team-1',
          teamName: 'Acme',
          authorizingUserId,
          webhookId,
          status: 'installed',
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
  );
  const getWebhookSecret = vi
    .fn()
    .mockResolvedValue(overrides.secret === undefined ? webhookSecret : overrides.secret);
  const processor = createClickUpWebhookProcessor({
    coreDb: coreDb as unknown as () => NodePgDatabase<Record<string, unknown>>,
    publishIntegrationEventReceived,
    recordDeliveryOnly,
    getIntegrationConnectionById,
    getClickUpInstallationByConnectionId,
    getWebhookSecret,
  });
  return {
    processor,
    coreDb,
    getIntegrationConnectionById,
    getClickUpInstallationByConnectionId,
    getWebhookSecret,
    publishIntegrationEventReceived,
    recordDeliveryOnly,
  };
}

describe('ClickUp webhook processor', () => {
  it('verifies a signed delivery and publishes the raw payload with team_id', async () => {
    const harness = createHarness();

    const result = await harness.processor.process(createRequest(createPayload('taskUpdated')));

    expect(result).toMatchObject({
      outcome: 'processed',
      deliveryId: `${webhookId}:taskUpdated:history-1`,
    });
    expect(harness.publishIntegrationEventReceived).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          provider: 'clickup',
          source: 'clickup_acme',
          event: 'taskUpdated',
          payload: expect.objectContaining({team_id: 'team-1'}),
        }),
      }),
    );
  });

  it('rejects missing and tampered signatures without recording', async () => {
    const missing = createHarness();
    const tampered = createHarness();

    const missingResult = await missing.processor.process(
      createRequest(createPayload(), {signature: ''}),
    );
    const tamperedResult = await tampered.processor.process(
      createRequest(createPayload(), {signature: '0'.repeat(64)}),
    );

    expect(missingResult).toMatchObject({outcome: 'discarded', reason: 'invalid_signature'});
    expect(tamperedResult).toMatchObject({outcome: 'discarded', reason: 'invalid_signature'});
    expect(missing.recordDeliveryOnly).not.toHaveBeenCalled();
    expect(tampered.recordDeliveryOnly).not.toHaveBeenCalled();
    expect(missing.publishIntegrationEventReceived).not.toHaveBeenCalled();
    expect(tampered.publishIntegrationEventReceived).not.toHaveBeenCalled();
  });

  it.each([
    ['unknown connection', {connection: null}],
    ['wrong provider', {connection: {...createConnection(), provider: 'github'} as never}],
    ['missing installation', {installation: null}],
    [
      'revoked installation',
      {
        installation: {
          connectionId,
          teamId: 'team-1',
          teamName: 'Acme',
          authorizingUserId,
          webhookId,
          status: 'revoked',
        },
      },
    ],
  ])('does not record a delivery for a %s', async (_description, overrides) => {
    const harness = createHarness(overrides);

    const result = await harness.processor.process(createRequest(createPayload()));

    expect(result).toMatchObject({outcome: 'discarded', reason: 'connection_unavailable'});
    expect(harness.recordDeliveryOnly).not.toHaveBeenCalled();
    expect(harness.publishIntegrationEventReceived).not.toHaveBeenCalled();
  });

  it('records a verified delivery for a disabled or error connection and does not publish', async () => {
    for (const lifecycleStatus of ['disabled', 'error'] as const) {
      const harness = createHarness({connection: createConnection({lifecycleStatus})});

      const result = await harness.processor.process(createRequest(createPayload()));

      expect(result).toMatchObject({outcome: 'discarded', reason: 'connection_unavailable'});
      expect(harness.recordDeliveryOnly).toHaveBeenCalledOnce();
      expect(harness.publishIntegrationEventReceived).not.toHaveBeenCalled();
    }
  });

  it('records a signed webhook id mismatch and drops it', async () => {
    const harness = createHarness();

    const result = await harness.processor.process(
      createRequest({...createPayload(), webhook_id: 'another-webhook'}),
    );

    expect(result).toMatchObject({outcome: 'discarded', reason: 'unsupported_event'});
    expect(harness.recordDeliveryOnly).toHaveBeenCalledOnce();
    expect(harness.publishIntegrationEventReceived).not.toHaveBeenCalled();
  });

  it.each(actorBearingEvents)('drops self-authored %s events', async (event) => {
    const harness = createHarness();

    const result = await harness.processor.process(
      createRequest(createPayload(event, authorizingUserId)),
    );

    expect(result).toMatchObject({outcome: 'discarded', reason: 'unsupported_event'});
    expect(harness.recordDeliveryOnly).toHaveBeenCalledOnce();
    expect(harness.publishIntegrationEventReceived).not.toHaveBeenCalled();
  });

  it('passes taskDeleted through with a connection-scoped body hash delivery id', async () => {
    const harness = createHarness();

    const result = await harness.processor.process(createRequest(createPayload('taskDeleted')));

    expect(result).toMatchObject({outcome: 'processed'});
    expect(result).toHaveProperty('deliveryId');
    expect(harness.publishIntegrationEventReceived).toHaveBeenCalledWith(
      expect.objectContaining({event: expect.objectContaining({event: 'taskDeleted'})}),
    );
  });

  it('keeps paired events distinct when ClickUp reuses a history item id', async () => {
    const harness = createHarness();

    const created = await harness.processor.process(
      createRequest(createPayload('taskCreated', 'other-user', 'shared-history')),
    );
    const status = await harness.processor.process(
      createRequest(createPayload('taskStatusUpdated', 'other-user', 'shared-history')),
    );

    expect(created.outcome).toBe('processed');
    expect(status.outcome).toBe('processed');
    expect(harness.publishIntegrationEventReceived).toHaveBeenCalledTimes(2);
  });

  it('returns duplicate for a replayed delivery', async () => {
    const harness = createHarness();
    const payload = createPayload();

    const first = await harness.processor.process(createRequest(payload));
    const replay = await harness.processor.process(createRequest(payload));

    expect(first).toMatchObject({outcome: 'processed'});
    expect(replay).toMatchObject({outcome: 'duplicate'});
    expect(harness.publishIntegrationEventReceived).toHaveBeenCalledTimes(2);
  });

  it('records and drops an event outside the curated vocabulary', async () => {
    const harness = createHarness();

    const result = await harness.processor.process(
      createRequest(createPayload('taskTimeTrackedUpdated')),
    );

    expect(result).toMatchObject({outcome: 'discarded', reason: 'unsupported_event'});
    expect(harness.recordDeliveryOnly).toHaveBeenCalledOnce();
    expect(harness.publishIntegrationEventReceived).not.toHaveBeenCalled();
  });

  it('reports malformed JSON after signature verification without recording', async () => {
    const harness = createHarness();

    const result = await harness.processor.process(createRequest('{'));

    expect(result).toMatchObject({outcome: 'discarded', reason: 'malformed_payload'});
    expect(harness.recordDeliveryOnly).not.toHaveBeenCalled();
  });
});
