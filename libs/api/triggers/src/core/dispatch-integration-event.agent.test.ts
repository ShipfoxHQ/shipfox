import {integrationsInterModuleContract} from '@shipfox/api-integration-core-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import {eq} from 'drizzle-orm';
import type {DispatchIntegrationEventParams} from '#core/dispatch-integration-event.js';
import type {AgentRoutingClient, AgentRoutingIntegrations} from '#core/route-event-to-agent.js';
import {db} from '#db/db.js';
import {triggersDecisions} from '#db/schema/decisions.js';
import {triggersReceivedEvents} from '#db/schema/received-events.js';
import {agentSubscriptionFactory, triggerSubscriptionFactory} from '#test/index.js';
import {dispatchIntegrationEvent} from './dispatch-integration-event.js';

const startRun = vi.fn();
const listInteractionProviders = vi.fn();
const readInteraction = vi.fn();
const reportInteractionProgress = vi.fn();
const routeInteraction = vi.fn();

const workflows = {
  startRunFromTrigger: (...args: unknown[]) => startRun(...args),
  deliverEventToJobListener: vi.fn(),
  resolveWorkflowRunTriggerReference: vi.fn(),
} as unknown as DispatchIntegrationEventParams['workflows'];
const integrations = {
  listInteractionProviders: (...args: unknown[]) => listInteractionProviders(...args),
  readInteraction: (...args: unknown[]) => readInteraction(...args),
  reportInteractionProgress: (...args: unknown[]) => reportInteractionProgress(...args),
} as unknown as AgentRoutingIntegrations;
const agent = {
  routeInteraction: (...args: unknown[]) => routeInteraction(...args),
} as unknown as AgentRoutingClient;

const PROJECT_ID = crypto.randomUUID();

function dispatch(
  overrides: Partial<DispatchIntegrationEventParams> = {},
  clients: Pick<DispatchIntegrationEventParams, 'integrations' | 'agent'> = {integrations, agent},
) {
  return dispatchIntegrationEvent({
    workflows,
    ...clients,
    eventRef: crypto.randomUUID(),
    provider: 'slack',
    source: 'slack',
    event: 'app_mention',
    workspaceId: crypto.randomUUID(),
    connectionId: crypto.randomUUID(),
    connectionName: 'Acme Slack',
    deliveryId: crypto.randomUUID(),
    receivedAt: new Date(),
    payload: {text: '<@U1> why did run 7 fail?'},
    ...overrides,
  });
}

async function receivedEvent(eventRef: string) {
  const [row] = await db()
    .select()
    .from(triggersReceivedEvents)
    .where(eq(triggersReceivedEvents.eventRef, eventRef));
  if (!row) throw new Error('No received event');
  return row;
}

async function agentDecisions(eventRef: string) {
  const event = await receivedEvent(eventRef);
  return await db()
    .select()
    .from(triggersDecisions)
    .where(eq(triggersDecisions.receivedEventId, event.id));
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    conversationKey: 'C1:1.1',
    role: 'request',
    context: {channel_id: 'C1'},
    author: {externalId: 'U1'},
    text: 'why did run 7 fail?',
    ...overrides,
  };
}

describe('dispatchIntegrationEvent with agent routing', () => {
  beforeEach(() => {
    startRun.mockReset();
    listInteractionProviders.mockReset();
    readInteraction.mockReset();
    reportInteractionProgress.mockReset();
    reportInteractionProgress.mockResolvedValue({reported: true});
    routeInteraction.mockReset();
    startRun.mockResolvedValue({id: crypto.randomUUID(), name: 'Build and test'});
    listInteractionProviders.mockResolvedValue({
      providers: [
        {
          provider: 'slack',
          interactionEvents: {app_mention: 'request', message: 'follow_up'},
          requestContextSchema: {},
          replyGuidance: 'Keep it short.',
        },
      ],
    });
    readInteraction.mockResolvedValue(request());
    routeInteraction.mockResolvedValue({
      outcome: 'default',
      conversationId: crypto.randomUUID(),
      projectId: PROJECT_ID,
      agentKey: 'shippy',
    });
  });

  test('hands a request to the agent and records the default agent as the decision', async () => {
    const eventRef = crypto.randomUUID();
    const workspaceId = crypto.randomUUID();
    const connectionId = crypto.randomUUID();

    await dispatch({eventRef, workspaceId, connectionId});

    expect(readInteraction).toHaveBeenCalledWith({
      workspaceId,
      connectionId,
      event: 'app_mention',
      payload: {text: '<@U1> why did run 7 fail?'},
    });
    expect(routeInteraction).toHaveBeenCalledWith({
      workspaceId,
      connectionId,
      provider: 'slack',
      deliveryKey: eventRef,
      interaction: {
        conversationKey: 'C1:1.1',
        role: 'request',
        text: 'why did run 7 fail?',
        author: {externalId: 'U1'},
      },
      candidates: [],
    });
    expect(await receivedEvent(eventRef)).toMatchObject({outcome: 'routed', matchedCount: 0});
    expect(await agentDecisions(eventRef)).toEqual([
      expect.objectContaining({
        subscriptionKind: 'agent',
        subscriptionId: null,
        subscriptionName: 'shippy',
        decision: 'default',
        projectId: PROJECT_ID,
        reason: null,
      }),
    ]);
  });

  test('records the owner when the key already has a conversation', async () => {
    const eventRef = crypto.randomUUID();
    readInteraction.mockResolvedValue(request({role: 'follow_up'}));
    routeInteraction.mockResolvedValue({
      outcome: 'owner',
      conversationId: crypto.randomUUID(),
      projectId: PROJECT_ID,
      agentKey: 'shippy',
    });

    await dispatch({eventRef, event: 'message'});

    expect(await agentDecisions(eventRef)).toEqual([
      expect.objectContaining({subscriptionKind: 'agent', decision: 'owner'}),
    ]);
    expect(await receivedEvent(eventRef)).toMatchObject({outcome: 'routed'});
  });

  test('hands a stop to the agent and records the owner it reached', async () => {
    const eventRef = crypto.randomUUID();
    readInteraction.mockResolvedValue(request({role: 'stop', text: ''}));
    routeInteraction.mockResolvedValue({
      outcome: 'owner',
      conversationId: crypto.randomUUID(),
      projectId: PROJECT_ID,
      agentKey: 'shippy',
    });

    await dispatch({eventRef});

    expect(routeInteraction).toHaveBeenCalledWith(
      expect.objectContaining({interaction: expect.objectContaining({role: 'stop'})}),
    );
    expect(await agentDecisions(eventRef)).toEqual([
      expect.objectContaining({subscriptionKind: 'agent', decision: 'owner'}),
    ]);
  });

  test('clears the progress of a request dropped for lack of a project', async () => {
    const workspaceId = crypto.randomUUID();
    const connectionId = crypto.randomUUID();
    readInteraction.mockResolvedValue(request({conversationKey: 'D1:1.1'}));
    routeInteraction.mockResolvedValue({outcome: 'dropped', reason: 'no-project'});

    await dispatch({workspaceId, connectionId});

    expect(reportInteractionProgress).toHaveBeenCalledWith({
      workspaceId,
      connectionId,
      conversationKey: 'D1:1.1',
      state: 'idle',
    });
  });

  test('still records a dropped request when clearing its progress fails', async () => {
    const eventRef = crypto.randomUUID();
    routeInteraction.mockResolvedValue({outcome: 'dropped', reason: 'no-project'});
    reportInteractionProgress.mockRejectedValue(new Error('slack is down'));

    await dispatch({eventRef});

    expect(await agentDecisions(eventRef)).toEqual([
      expect.objectContaining({decision: 'dropped', reason: 'no-project'}),
    ]);
  });

  test('leaves the progress alone when the agent takes the request', async () => {
    await dispatch();

    expect(reportInteractionProgress).not.toHaveBeenCalled();
  });

  test('leaves the progress alone when a dropped event is not a request', async () => {
    readInteraction.mockResolvedValue(request({role: 'stop', text: ''}));
    routeInteraction.mockResolvedValue({outcome: 'dropped', reason: 'no-owner'});

    await dispatch();

    expect(reportInteractionProgress).not.toHaveBeenCalled();
  });

  test('records a stop with no owner as dropped', async () => {
    const eventRef = crypto.randomUUID();
    readInteraction.mockResolvedValue(request({role: 'stop', text: ''}));
    routeInteraction.mockResolvedValue({outcome: 'dropped', reason: 'no-owner'});

    await dispatch({eventRef});

    expect(await agentDecisions(eventRef)).toEqual([
      expect.objectContaining({decision: 'dropped', reason: 'no-owner'}),
    ]);
  });

  test('records a follow-up with no owner as dropped and matches nothing', async () => {
    const eventRef = crypto.randomUUID();
    readInteraction.mockResolvedValue(request({role: 'follow_up'}));
    routeInteraction.mockResolvedValue({outcome: 'dropped', reason: 'no-owner'});

    await dispatch({eventRef, event: 'message'});

    expect(await agentDecisions(eventRef)).toEqual([
      expect.objectContaining({
        subscriptionKind: 'agent',
        subscriptionName: 'none',
        decision: 'dropped',
        projectId: null,
        reason: 'no-owner',
      }),
    ]);
    expect(await receivedEvent(eventRef)).toMatchObject({outcome: 'discarded', matchedCount: 0});
  });

  test('records one decision when the same event is delivered twice', async () => {
    const eventRef = crypto.randomUUID();
    const workspaceId = crypto.randomUUID();
    const connectionId = crypto.randomUUID();

    await dispatch({eventRef, workspaceId, connectionId});
    await dispatch({eventRef, workspaceId, connectionId});

    expect(routeInteraction).toHaveBeenCalledTimes(2);
    expect(routeInteraction.mock.calls[1]?.[0].deliveryKey).toBe(eventRef);
    expect(await agentDecisions(eventRef)).toHaveLength(1);
  });

  test('still starts the workflows subscribed to the same event', async () => {
    const workspaceId = crypto.randomUUID();
    const subscription = await triggerSubscriptionFactory.create({
      workspaceId,
      source: 'slack',
      event: 'app_mention',
      config: {},
    });
    const eventRef = crypto.randomUUID();

    await dispatch({eventRef, workspaceId});

    expect(startRun).toHaveBeenCalledTimes(1);
    expect(startRun).toHaveBeenCalledWith(
      expect.objectContaining({definitionId: subscription.workflowDefinitionId}),
    );
    expect(routeInteraction).toHaveBeenCalledTimes(1);
    expect(await receivedEvent(eventRef)).toMatchObject({outcome: 'routed', matchedCount: 1});
    const decisions = await agentDecisions(eventRef);
    expect(decisions.map(({subscriptionKind}) => subscriptionKind).sort()).toEqual([
      'agent',
      'trigger',
    ]);
  });

  test('leaves an event the provider does not list for an agent alone', async () => {
    const eventRef = crypto.randomUUID();

    await dispatch({eventRef, event: 'reaction_added'});

    expect(readInteraction).not.toHaveBeenCalled();
    expect(routeInteraction).not.toHaveBeenCalled();
    expect(await agentDecisions(eventRef)).toEqual([]);
    expect(await receivedEvent(eventRef)).toMatchObject({outcome: 'discarded'});
  });

  test('leaves an event from a provider without the capability alone', async () => {
    const eventRef = crypto.randomUUID();

    await dispatch({eventRef, provider: 'github', source: 'github', event: 'push'});

    expect(readInteraction).not.toHaveBeenCalled();
    expect(routeInteraction).not.toHaveBeenCalled();
    expect(await agentDecisions(eventRef)).toEqual([]);
  });

  test('routes nothing when the provider says the event is not for an agent', async () => {
    const eventRef = crypto.randomUUID();
    readInteraction.mockResolvedValue(null);

    await dispatch({eventRef});

    expect(routeInteraction).not.toHaveBeenCalled();
    expect(await agentDecisions(eventRef)).toEqual([]);
  });

  test('routes nothing without the integrations and agent clients', async () => {
    const eventRef = crypto.randomUUID();

    await dispatch({eventRef}, {});

    expect(listInteractionProviders).not.toHaveBeenCalled();
    expect(routeInteraction).not.toHaveBeenCalled();
  });

  test('replays the event when Integrations fails in a way it does not declare', async () => {
    const eventRef = crypto.randomUUID();
    readInteraction.mockRejectedValue(new Error('transport closed'));

    await expect(dispatch({eventRef})).rejects.toThrow('transport closed');

    expect(routeInteraction).not.toHaveBeenCalled();
    expect(await receivedEvent(eventRef)).toMatchObject({outcome: 'failed'});
  });

  test('skips an interaction whose key is too long for an agent', async () => {
    const eventRef = crypto.randomUUID();
    readInteraction.mockResolvedValue(request({conversationKey: 'k'.repeat(257)}));

    await dispatch({eventRef});

    expect(routeInteraction).not.toHaveBeenCalled();
    expect(await agentDecisions(eventRef)).toEqual([]);
  });

  test('replays the event when routing fails, after the workflows have run', async () => {
    const workspaceId = crypto.randomUUID();
    await triggerSubscriptionFactory.create({
      workspaceId,
      source: 'slack',
      event: 'app_mention',
      config: {},
    });
    const eventRef = crypto.randomUUID();
    routeInteraction.mockRejectedValue(new Error('agent unavailable'));

    await expect(dispatch({eventRef, workspaceId})).rejects.toThrow('agent unavailable');

    expect(startRun).toHaveBeenCalledTimes(1);
    expect(await receivedEvent(eventRef)).toMatchObject({outcome: 'failed'});
  });

  test('skips agent routing when the provider fails to read the event, so nothing is replayed', async () => {
    const workspaceId = crypto.randomUUID();
    await triggerSubscriptionFactory.create({
      workspaceId,
      source: 'slack',
      event: 'app_mention',
      config: {},
    });
    const eventRef = crypto.randomUUID();
    readInteraction.mockRejectedValue(
      createInterModuleKnownError(
        integrationsInterModuleContract.methods.readInteraction,
        'provider-failure',
        {reason: 'rate limited'},
      ),
    );

    await dispatch({eventRef, workspaceId});

    expect(startRun).toHaveBeenCalledTimes(1);
    expect(routeInteraction).not.toHaveBeenCalled();
    expect(await receivedEvent(eventRef)).toMatchObject({outcome: 'routed'});
  });
});

describe('dispatchIntegrationEvent with agent rules', () => {
  const PAYMENTS_FILTER = 'request.channel_id == "C04PAYMENTS"';

  beforeEach(() => {
    listInteractionProviders.mockReset();
    readInteraction.mockReset();
    reportInteractionProgress.mockReset();
    routeInteraction.mockReset();
    listInteractionProviders.mockResolvedValue({
      providers: [
        {
          provider: 'slack',
          interactionEvents: {app_mention: 'request', message: 'follow_up'},
          requestContextSchema: {},
          replyGuidance: 'Keep it short.',
        },
      ],
    });
    routeInteraction.mockResolvedValue({
      outcome: 'default',
      conversationId: crypto.randomUUID(),
      projectId: PROJECT_ID,
      agentKey: 'shippy',
    });
  });

  function candidateOf(subscription: {
    id: string;
    projectId: string;
    agentKey: string;
    createdAt: Date;
  }) {
    return {
      subscriptionId: subscription.id,
      projectId: subscription.projectId,
      agentKey: subscription.agentKey,
      boundAt: subscription.createdAt.toISOString(),
    };
  }

  test('offers a rule on a channel only the mentions made in that channel', async () => {
    const workspaceId = crypto.randomUUID();
    const payments = await agentSubscriptionFactory.create({
      workspaceId,
      agentKey: 'payments',
      filter: PAYMENTS_FILTER,
    });

    readInteraction.mockResolvedValue(request({context: {channel_id: 'C04PAYMENTS'}}));
    await dispatch({workspaceId});
    readInteraction.mockResolvedValue(request({context: {channel_id: 'C1'}}));
    await dispatch({workspaceId});

    expect(routeInteraction.mock.calls.map(([input]) => input.candidates)).toEqual([
      [candidateOf(payments)],
      [],
    ]);
  });

  test('matches a filter on the raw event, and only the rules of the event source', async () => {
    const workspaceId = crypto.randomUUID();
    const onEvent = await agentSubscriptionFactory.create({
      workspaceId,
      filter: 'event.text.contains("refund")',
    });
    await agentSubscriptionFactory.create({workspaceId, source: 'other-slack'});
    await agentSubscriptionFactory.create({source: 'slack'});
    readInteraction.mockResolvedValue(request());

    await dispatch({workspaceId, payload: {text: '<@U1> refund order 12'}});

    expect(routeInteraction).toHaveBeenCalledWith(
      expect.objectContaining({candidates: [candidateOf(onEvent)]}),
    );
  });

  test('records the winning rule as owner and the other match as ambiguous', async () => {
    const workspaceId = crypto.randomUUID();
    const eventRef = crypto.randomUUID();
    const payments = await agentSubscriptionFactory.create({workspaceId, agentKey: 'payments'});
    const billing = await agentSubscriptionFactory.create({workspaceId, agentKey: 'billing'});
    readInteraction.mockResolvedValue(request());
    routeInteraction.mockResolvedValue({
      outcome: 'matched',
      conversationId: crypto.randomUUID(),
      projectId: payments.projectId,
      agentKey: 'payments',
      subscriptionId: payments.id,
      ambiguousSubscriptionIds: [billing.id],
    });

    await dispatch({eventRef, workspaceId});

    const decisions = await agentDecisions(eventRef);
    expect(decisions).toHaveLength(2);
    expect(decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          subscriptionKind: 'agent',
          subscriptionId: payments.id,
          subscriptionName: 'payments',
          projectId: payments.projectId,
          decision: 'owner',
        }),
        expect.objectContaining({
          subscriptionKind: 'agent',
          subscriptionId: billing.id,
          subscriptionName: 'billing',
          projectId: billing.projectId,
          decision: 'ambiguous',
        }),
      ]),
    );
    expect(await receivedEvent(eventRef)).toMatchObject({outcome: 'routed'});
  });

  test('records the same decisions when a matched event is delivered twice', async () => {
    const workspaceId = crypto.randomUUID();
    const eventRef = crypto.randomUUID();
    const payments = await agentSubscriptionFactory.create({workspaceId});
    readInteraction.mockResolvedValue(request());
    routeInteraction.mockResolvedValue({
      outcome: 'matched',
      conversationId: crypto.randomUUID(),
      projectId: payments.projectId,
      agentKey: payments.agentKey,
      subscriptionId: payments.id,
      ambiguousSubscriptionIds: [],
    });

    await dispatch({eventRef, workspaceId});
    await dispatch({eventRef, workspaceId});

    expect(await agentDecisions(eventRef)).toEqual([
      expect.objectContaining({subscriptionId: payments.id, decision: 'owner'}),
    ]);
  });

  test('records a rule whose filter fails, and still routes the request', async () => {
    const workspaceId = crypto.randomUUID();
    const eventRef = crypto.randomUUID();
    const broken = await agentSubscriptionFactory.create({
      workspaceId,
      filter: 'request.channel_id ==',
    });
    readInteraction.mockResolvedValue(request());

    await dispatch({eventRef, workspaceId});

    expect(routeInteraction).toHaveBeenCalledWith(expect.objectContaining({candidates: []}));
    expect(await agentDecisions(eventRef)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({subscriptionId: null, decision: 'default'}),
        expect.objectContaining({subscriptionId: broken.id, decision: 'filter-error'}),
      ]),
    );
  });

  test('matches no rule for a follow-up', async () => {
    const workspaceId = crypto.randomUUID();
    await agentSubscriptionFactory.create({workspaceId});
    readInteraction.mockResolvedValue(request({role: 'follow_up'}));

    await dispatch({workspaceId, event: 'message'});

    expect(routeInteraction).toHaveBeenCalledWith(expect.objectContaining({candidates: []}));
  });

  test('records only the owner for a request on an owned key', async () => {
    const workspaceId = crypto.randomUUID();
    const eventRef = crypto.randomUUID();
    await agentSubscriptionFactory.create({workspaceId});
    await agentSubscriptionFactory.create({workspaceId, filter: 'request.channel_id =='});
    readInteraction.mockResolvedValue(request());
    routeInteraction.mockResolvedValue({
      outcome: 'owner',
      conversationId: crypto.randomUUID(),
      projectId: PROJECT_ID,
      agentKey: 'shippy',
    });

    await dispatch({eventRef, workspaceId});

    expect(await agentDecisions(eventRef)).toEqual([
      expect.objectContaining({subscriptionId: null, decision: 'owner'}),
    ]);
  });
});
