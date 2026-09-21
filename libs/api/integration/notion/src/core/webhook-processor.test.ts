import {createHmac, randomUUID} from 'node:crypto';
import type {NotionWebhookEventName} from '@shipfox/api-integration-notion-dto';
import {createStoredWebhookRequest, type IntegrationConnection} from '@shipfox/api-integration-spi';
import type {NodePgDatabase} from 'drizzle-orm/node-postgres';
import type {NotionInstallation} from '#db/installations.js';
import {createNotionWebhookProcessor} from './webhook-processor.js';

const {warn} = vi.hoisted(() => ({warn: vi.fn()}));

vi.mock('@shipfox/node-opentelemetry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shipfox/node-opentelemetry')>()),
  logger: () => ({warn}),
}));

const verificationToken = 'notion-verification-token';
const workspaceId = 'notion-workspace-1';
const connectionId = randomUUID();
const botId = 'notion-bot-1';

function createConnection(
  overrides: Partial<IntegrationConnection<'notion'>> = {},
): IntegrationConnection<'notion'> {
  const now = new Date();
  return {
    id: connectionId,
    workspaceId: randomUUID(),
    provider: 'notion',
    externalAccountId: workspaceId,
    slug: 'notion_acme',
    displayName: 'Notion Acme',
    lifecycleStatus: 'active',
    repositoryAccessMode: 'selected',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function createInstallation(overrides: Partial<NotionInstallation> = {}): NotionInstallation {
  const now = new Date();
  return {
    id: randomUUID(),
    connectionId,
    notionWorkspaceId: workspaceId,
    workspaceName: 'Acme',
    botId,
    authorizedByUserId: randomUUID(),
    tokenExpiresAt: null,
    status: 'installed',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function createPayload(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: `delivery-${randomUUID()}`,
    timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    workspace_id: workspaceId,
    subscription_id: 'subscription-1',
    integration_id: 'integration-1',
    type: 'page.properties_updated',
    authors: [{id: 'person-1', type: 'person'}],
    accessible_by: [{id: botId, type: 'bot'}],
    attempt_number: 8,
    entity: {id: 'page-1', type: 'page'},
    data: {updated_properties: ['status-id']},
    ...overrides,
  };
}

function createRequest(
  payload: unknown,
  options: {signature?: string | undefined; verificationToken?: string} = {},
) {
  const body = new TextEncoder().encode(
    typeof payload === 'string' ? payload : JSON.stringify(payload),
  );
  const signature =
    options.signature ??
    `sha256=${createHmac('sha256', options.verificationToken ?? verificationToken)
      .update(body)
      .digest('hex')}`;
  return createStoredWebhookRequest({
    requestId: randomUUID(),
    routeId: 'notion',
    receivedAt: new Date().toISOString(),
    rawQueryString: '',
    headers: {'content-type': 'application/json', 'x-notion-signature': signature},
    body,
  });
}

function createHarness(
  options: {
    installation?: NotionInstallation | null | undefined;
    connection?: IntegrationConnection<'notion'> | undefined;
    verificationToken?: string | null;
  } = {},
) {
  const installation =
    options.installation === undefined ? createInstallation() : options.installation;
  const connection =
    options.connection ?? createConnection({id: installation?.connectionId ?? connectionId});
  const deliveryIds = new Set<string>();
  const publishIntegrationEventReceived = vi.fn(({event}: {event: {deliveryId: string}}) => {
    if (deliveryIds.has(event.deliveryId)) return Promise.resolve({published: false});
    deliveryIds.add(event.deliveryId);
    return Promise.resolve({published: true});
  });
  const recordDeliveryOnly = vi.fn(async () => undefined);
  const coreDb = vi.fn(() => ({
    transaction: async (callback: (tx: unknown) => Promise<unknown>) => await callback({}),
  }));
  const processor = createNotionWebhookProcessor({
    coreDb: coreDb as unknown as () => NodePgDatabase<Record<string, unknown>>,
    publishIntegrationEventReceived,
    recordDeliveryOnly,
    getIntegrationConnectionById: vi.fn(async () => connection),
    getNotionInstallationByWorkspaceId: vi.fn(async () => installation ?? undefined),
    verificationToken:
      options.verificationToken === undefined ? verificationToken : options.verificationToken,
  });
  return {processor, publishIntegrationEventReceived, recordDeliveryOnly};
}

describe('Notion webhook processor', () => {
  beforeEach(() => {
    warn.mockClear();
  });

  it('accepts the unsigned handshake and stays silent when the token is configured', async () => {
    const harness = createHarness({verificationToken});
    const result = await harness.processor.process(
      createRequest({verification_token: 'new-token'}, {signature: ''}),
    );

    expect(result).toEqual({outcome: 'processed'});
    expect(harness.publishIntegrationEventReceived).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('accepts handshakes and logs the verification token once per processor when unset', async () => {
    const harness = createHarness({verificationToken: null});
    const first = await harness.processor.process(
      createRequest({verification_token: 'first-token'}, {signature: ''}),
    );
    const second = await harness.processor.process(
      createRequest({verification_token: 'second-token'}, {signature: ''}),
    );

    expect(first).toEqual({outcome: 'processed'});
    expect(second).toEqual({outcome: 'processed'});
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      {verificationToken: 'first-token'},
      'Notion webhook verification token received; set NOTION_WEBHOOK_VERIFICATION_TOKEN',
    );
  });

  it('does not treat an object with extra fields as a handshake', async () => {
    const harness = createHarness();
    const result = await harness.processor.process(
      createRequest({verification_token: 'new-token', type: 'not-a-handshake'}, {signature: ''}),
    );

    expect(result).toMatchObject({outcome: 'discarded', reason: 'invalid_signature'});
  });

  it('rejects missing, tampered, and unset verification signatures', async () => {
    const missing = createHarness();
    const tampered = createHarness();
    const unset = createHarness({verificationToken: null});

    const missingResult = await missing.processor.process(
      createRequest(createPayload(), {signature: ''}),
    );
    const tamperedResult = await tampered.processor.process(
      createRequest(createPayload(), {signature: `sha256=${'0'.repeat(64)}`}),
    );
    const unsetResult = await unset.processor.process(
      createRequest(createPayload(), {signature: 'sha256=anything'}),
    );

    expect(missingResult).toMatchObject({outcome: 'discarded', reason: 'invalid_signature'});
    expect(tamperedResult).toMatchObject({outcome: 'discarded', reason: 'invalid_signature'});
    expect(unsetResult).toMatchObject({outcome: 'discarded', reason: 'invalid_signature'});
    expect(missing.publishIntegrationEventReceived).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON and malformed envelopes after signature verification', async () => {
    const harness = createHarness();

    const malformedJson = await harness.processor.process(createRequest('{'));
    const malformedEnvelope = await harness.processor.process(
      createRequest({id: 'delivery-1', type: 'page.created'}),
    );

    expect(malformedJson).toMatchObject({outcome: 'discarded', reason: 'malformed_payload'});
    expect(malformedEnvelope).toMatchObject({outcome: 'discarded', reason: 'malformed_payload'});
    expect(harness.recordDeliveryOnly).not.toHaveBeenCalled();
  });

  it('acknowledges an event outside the closed vocabulary', async () => {
    const harness = createHarness();
    const payload = createPayload({id: 'unsupported-1', type: 'page.archived'});

    const result = await harness.processor.process(createRequest(payload));

    expect(result).toEqual({
      outcome: 'discarded',
      reason: 'unsupported_event',
      deliveryId: 'unsupported-1',
    });
    expect(harness.recordDeliveryOnly).toHaveBeenCalledOnce();
    expect(harness.publishIntegrationEventReceived).not.toHaveBeenCalled();
  });

  it.each([
    ['missing accessible_by', {accessible_by: undefined}],
    ['a different bot', {accessible_by: [{id: 'another-bot', type: 'bot'}]}],
    ['an empty grant list', {accessible_by: []}],
  ])('fails closed for %s', async (_description, overrides) => {
    const harness = createHarness();
    const result = await harness.processor.process(createRequest(createPayload(overrides)));

    expect(result).toMatchObject({
      outcome: 'discarded',
      reason: 'connection_unavailable',
      deliveryId: expect.any(String),
    });
    expect(harness.recordDeliveryOnly).toHaveBeenCalledOnce();
    expect(harness.recordDeliveryOnly).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'notion',
        connectionId,
      }),
    );
    expect(harness.publishIntegrationEventReceived).not.toHaveBeenCalled();
  });

  it('acknowledges unknown and inactive workspaces without publishing', async () => {
    const unknown = createHarness({installation: null});
    const inactive = createHarness({installation: createInstallation({status: 'revoked'})});

    const unknownResult = await unknown.processor.process(createRequest(createPayload()));
    const inactiveResult = await inactive.processor.process(createRequest(createPayload()));

    expect(unknownResult).toMatchObject({outcome: 'discarded', reason: 'connection_unavailable'});
    expect(inactiveResult).toMatchObject({outcome: 'discarded', reason: 'connection_unavailable'});
    expect(unknown.publishIntegrationEventReceived).not.toHaveBeenCalled();
    expect(unknown.recordDeliveryOnly).not.toHaveBeenCalled();
    expect(inactive.recordDeliveryOnly).toHaveBeenCalledOnce();
    expect(inactive.recordDeliveryOnly).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'notion',
        connectionId,
      }),
    );
  });

  it('publishes the raw payload for the installation bot, including bot-authored events', async () => {
    const harness = createHarness();
    const payload = createPayload({
      id: 'bot-authored-1',
      type: 'comment.created' satisfies NotionWebhookEventName,
      authors: [{id: botId, type: 'bot'}],
    });

    const result = await harness.processor.process(createRequest(payload));

    expect(result).toEqual({outcome: 'processed', deliveryId: 'bot-authored-1'});
    expect(harness.publishIntegrationEventReceived).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          provider: 'notion',
          event: 'comment.created',
          payload,
        }),
      }),
    );
  });

  it('accepts a day-old delivery and deduplicates the retry by payload id', async () => {
    const harness = createHarness();
    const payload = createPayload({id: 'day-old-retry'});

    const first = await harness.processor.process(createRequest(payload));
    const retry = await harness.processor.process(createRequest(payload));

    expect(first).toEqual({outcome: 'processed', deliveryId: 'day-old-retry'});
    expect(retry).toEqual({outcome: 'duplicate', deliveryId: 'day-old-retry'});
    expect(harness.publishIntegrationEventReceived).toHaveBeenCalledTimes(2);
  });
});
