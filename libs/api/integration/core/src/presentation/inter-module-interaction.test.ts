import {integrationsInterModuleContract} from '@shipfox/api-integration-core-dto/inter-module';
import {
  createFakeInteractionProvider,
  type FakeInteractionProviderOptions,
} from '@shipfox/api-integration-spi/testing';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {createInMemoryInterModuleTransport} from '@shipfox/node-module/inter-module';
import type {IntegrationConnection} from '#core/entities/connection.js';
import {createIntegrationProviderRegistry} from '#core/providers/registry.js';
import {createSourceControlIntegrationService} from '#core/source-control-service.js';
import {createIntegrationsInterModulePresentation} from './inter-module.js';

const workspaceId = crypto.randomUUID();
const connectionId = crypto.randomUUID();

function connectionFor(provider: string, lifecycleStatus: 'active' | 'disabled' = 'active') {
  const connection: IntegrationConnection = {
    id: connectionId,
    workspaceId,
    provider,
    externalAccountId: 'acme',
    slug: 'acme',
    displayName: 'Acme',
    lifecycleStatus,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  return connection;
}

function createClient(
  options: FakeInteractionProviderOptions & {
    lifecycleStatus?: 'active' | 'disabled';
    reconnectRequired?: boolean;
  } = {},
) {
  const fake = createFakeInteractionProvider(options);
  const registry = createIntegrationProviderRegistry([
    {
      provider: 'chat',
      displayName: 'Chat',
      adapters: {interaction: fake.provider},
      connectionReconnectRequired: () => Promise.resolve(options.reconnectRequired ?? false),
    },
    {provider: 'plain', displayName: 'Plain', adapters: {}},
  ]);
  const plainConnection = {...connectionFor('plain'), id: crypto.randomUUID()};
  const connections = new Map<string, IntegrationConnection>([
    [connectionId, connectionFor('chat', options.lifecycleStatus)],
    [plainConnection.id, plainConnection],
  ]);
  const getIntegrationConnectionById = async (id: string) => {
    await Promise.resolve();
    return connections.get(id);
  };
  const transport = createInMemoryInterModuleTransport();
  const client = transport.createClient(integrationsInterModuleContract);
  transport.register(
    createIntegrationsInterModulePresentation({
      registry,
      sourceControl: createSourceControlIntegrationService({
        registry,
        getIntegrationConnectionById,
      }),
      getIntegrationConnectionById,
    }),
  );
  transport.seal();
  return {client, fake, plainConnectionId: plainConnection.id};
}

describe('integrations inter-module interaction operations', () => {
  const target = {workspaceId, connectionId};

  it('round-trips a request, a follow-up, a stop, a reply, and a progress update', async () => {
    const {client, fake} = createClient();
    const author = {externalId: 'U1', displayName: 'Ada'};

    const request = await client.readInteraction({
      ...target,
      event: 'fake.request',
      payload: {conversationKey: 'c1', text: 'Deploy?', context: {channel: 'C1'}, author},
    });
    const followUp = await client.readInteraction({
      ...target,
      event: 'fake.follow_up',
      payload: {conversationKey: 'c1', text: 'And staging?'},
    });
    const stop = await client.readInteraction({
      ...target,
      event: 'fake.stop',
      payload: {conversationKey: 'c1'},
    });
    const progress = await client.reportInteractionProgress({
      ...target,
      conversationKey: 'c1',
      state: 'working',
      detail: 'Reading logs',
      links: [{label: 'Run', url: 'https://app.shipfox.io/runs/1'}],
    });
    const reply = await client.sendInteractionReply({
      ...target,
      conversationKey: 'c1',
      replyId: 'r1',
      kind: 'response',
      text: 'Yes.',
      agent: {name: 'Shippy'},
    });

    expect(request).toEqual({
      conversationKey: 'c1',
      role: 'request',
      context: {channel: 'C1'},
      author,
      text: 'Deploy?',
    });
    expect(followUp).toMatchObject({
      conversationKey: 'c1',
      role: 'follow_up',
      text: 'And staging?',
    });
    expect(stop).toMatchObject({conversationKey: 'c1', role: 'stop'});
    expect(progress).toEqual({reported: true});
    expect(reply).toEqual({outcome: 'delivered'});
    expect(fake.progress).toMatchObject([
      {conversationKey: 'c1', state: 'working', detail: 'Reading logs'},
    ]);
    expect(fake.replies).toMatchObject([
      {conversationKey: 'c1', replyId: 'r1', kind: 'response', agent: {name: 'Shippy'}},
    ]);
  });

  it('delivers an error reply and reports an undeliverable one', async () => {
    const {client, fake} = createClient({undeliverableConversationKeys: ['archived']});
    const reply = {...target, replyId: 'r1', text: 'Failed.', agent: {name: 'Shippy'}};

    const delivered = await client.sendInteractionReply({
      ...reply,
      conversationKey: 'c1',
      kind: 'error',
    });
    const undeliverable = await client.sendInteractionReply({
      ...reply,
      conversationKey: 'archived',
      kind: 'response',
    });

    expect(delivered).toEqual({outcome: 'delivered'});
    expect(fake.replies).toMatchObject([{conversationKey: 'c1', kind: 'error'}]);
    expect(undeliverable).toEqual({
      outcome: 'undeliverable',
      reason: 'The conversation was archived',
    });
  });

  it('works with a provider that cannot report progress', async () => {
    const {client, fake} = createClient({reportsProgress: false});

    const progress = await client.reportInteractionProgress({
      ...target,
      conversationKey: 'c1',
      state: 'working',
    });
    const reply = await client.sendInteractionReply({
      ...target,
      conversationKey: 'c1',
      replyId: 'r1',
      kind: 'response',
      text: 'Done.',
      agent: {name: 'Shippy'},
    });

    expect(progress).toEqual({reported: false});
    expect(reply).toEqual({outcome: 'delivered'});
    expect(fake.progress).toEqual([]);
  });

  it('answers null for an event the provider ignores', async () => {
    const {client} = createClient();

    const ignored = await client.readInteraction({
      ...target,
      event: 'fake.request',
      payload: {conversationKey: 'c1', ignored: true},
    });

    expect(ignored).toBeNull();
  });

  it.each([
    'fake.other',
    'toString',
  ])('answers null for the unlisted event %s without calling the provider', async (event) => {
    const {client, fake} = createClient();
    const readInteraction = vi.spyOn(fake.provider, 'readInteraction');

    const result = await client.readInteraction({
      ...target,
      event,
      payload: {conversationKey: 'c1'},
    });

    expect(result).toBeNull();
    expect(readInteraction).not.toHaveBeenCalled();
  });

  it('answers null without calling the provider while the connection must reconnect', async () => {
    const {client, fake} = createClient({reconnectRequired: true});
    const readInteraction = vi.spyOn(fake.provider, 'readInteraction');

    const result = await client.readInteraction({
      ...target,
      event: 'fake.request',
      payload: {conversationKey: 'c1'},
    });

    expect(result).toBeNull();
    expect(readInteraction).not.toHaveBeenCalled();
  });

  it('lists the events, context schema, and reply guidance of interaction providers only', async () => {
    const {client} = createClient();

    const result = await client.listInteractionProviders({});

    expect(result.providers).toEqual([
      {
        provider: 'chat',
        interactionEvents: {
          'fake.request': 'request',
          'fake.follow_up': 'follow_up',
          'fake.stop': 'stop',
        },
        requestContextSchema: {type: 'object', properties: {channel: {type: 'string'}}},
        replyGuidance: 'Answer in one short paragraph.',
      },
    ]);
  });

  it.each([
    [
      'a connection in another workspace',
      {workspaceId: crypto.randomUUID()},
      'connection-workspace-mismatch',
    ],
    ['a missing connection', {connectionId: crypto.randomUUID()}, 'connection-not-found'],
  ])('refuses %s', async (_name, override, code) => {
    const {client} = createClient();

    const error = await client
      .readInteraction({...target, ...override, event: 'fake.request', payload: {}})
      .catch((caught: unknown) => caught);

    expect(
      isInterModuleKnownError(integrationsInterModuleContract.methods.readInteraction, error) &&
        error.code,
    ).toBe(code);
  });

  it('refuses an inactive connection', async () => {
    const {client} = createClient({lifecycleStatus: 'disabled'});

    const error = await client
      .sendInteractionReply({
        ...target,
        conversationKey: 'c1',
        replyId: 'r1',
        kind: 'response',
        text: 'Hi',
        agent: {name: 'Shippy'},
      })
      .catch((caught: unknown) => caught);

    expect(
      isInterModuleKnownError(
        integrationsInterModuleContract.methods.sendInteractionReply,
        error,
      ) && error.code,
    ).toBe('connection-inactive');
  });

  it('refuses a connection whose provider has no interaction capability', async () => {
    const {client, plainConnectionId} = createClient();

    const error = await client
      .reportInteractionProgress({
        ...target,
        connectionId: plainConnectionId,
        conversationKey: 'c1',
        state: 'idle',
      })
      .catch((caught: unknown) => caught);

    expect(
      isInterModuleKnownError(
        integrationsInterModuleContract.methods.reportInteractionProgress,
        error,
      ) && error.code,
    ).toBe('capability-unavailable');
  });
});
