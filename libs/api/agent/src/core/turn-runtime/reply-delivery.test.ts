import {
  createAssistantMessageEventStream,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
} from '@earendil-works/pi-ai';
import {
  type IntegrationsModuleClient,
  integrationsInterModuleContract,
} from '@shipfox/api-integration-core-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import {getTurnById, listContextItems, requestTurnStop} from '#db/turn-runtime.js';
import {conversationReplyCount} from '#metrics/index.js';
import {conversationFactory} from '#test/factories/conversation.js';
import {createTestProjectsClient} from '#test/fixtures/projects-client.js';
import {createScriptedModel, textReply} from '#test/fixtures/scripted-model.js';
import {createTestWorkspacesClient} from '#test/fixtures/workspaces-client.js';
import {
  aadForConversationItem,
  conversationDataKey,
  openConversationEntry,
} from '../conversation-sealing.js';
import {routeInteraction} from '../interaction-routing.js';
import {stopWork} from '../stop-work.js';
import {runModelCall} from './model-call.js';
import type {CreateModelRuntime, ModelCallRuntime} from './model-runtime.js';
import {deliverConversationReply, REPLY_UNDELIVERABLE_NOTICE_CODE} from './reply-delivery.js';
import {runToolCall} from './tool-call.js';
import {beginConversationTurn, finishConversationTurn} from './turn-lifecycle.js';

const runsTool = {
  id: 'list_workflow_runs',
  provider: 'shipfox',
  description: 'List workflow runs',
  sensitivity: 'read' as const,
  sensitive: false,
  requiredScope: [],
  inputSchema: {type: 'object', properties: {limit: {type: 'number'}}},
};

type SendInput = Parameters<IntegrationsModuleClient['sendInteractionReply']>[0];
type SendOutput = Awaited<ReturnType<IntegrationsModuleClient['sendInteractionReply']>>;

/** Stands in for the provider behind Integrations: it records what it is asked to send. */
function createFakeIntegrations(
  options: {sendOutcome?: () => SendOutput | Promise<SendOutput>} = {},
) {
  const replies: SendInput[] = [];
  const progress: Parameters<IntegrationsModuleClient['reportInteractionProgress']>[0][] = [];
  const sendInteractionReply = vi.fn(async (input: SendInput): Promise<SendOutput> => {
    const outcome = (await options.sendOutcome?.()) ?? {outcome: 'delivered' as const};
    if (outcome.outcome === 'delivered') replies.push(input);
    return outcome;
  });
  const reportInteractionProgress = vi.fn((input: (typeof progress)[number]) => {
    progress.push(input);
    return Promise.resolve({reported: true});
  });
  const client = {
    sendInteractionReply,
    reportInteractionProgress,
    listConversationTools: vi.fn().mockResolvedValue({tools: [runsTool]}),
    listInteractionProviders: vi.fn().mockResolvedValue({
      providers: [
        {
          provider: 'slack',
          interactionEvents: {app_mention: 'request'},
          requestContextSchema: {},
          replyGuidance: 'Reply briefly.',
        },
      ],
    }),
    callTool: vi.fn().mockResolvedValue({
      outcome: 'success',
      result: null,
      content: [{type: 'text', text: 'run 7 failed'}],
    }),
  } as unknown as IntegrationsModuleClient;
  return {client, replies, progress, sendInteractionReply, reportInteractionProgress};
}

async function setup(options: Parameters<typeof createFakeIntegrations>[0] = {}) {
  const workspaceId = crypto.randomUUID();
  const projectId = crypto.randomUUID();
  const connectionId = crypto.randomUUID();
  const conversationKey = 'C1:1700000000.000100';
  const projects = createTestProjectsClient({projects: new Map([[projectId, {workspaceId}]])});
  const routed = await routeInteraction(
    {
      workspaceId,
      connectionId,
      provider: 'slack',
      deliveryKey: crypto.randomUUID(),
      interaction: {conversationKey, role: 'request', text: 'Why did run 7 fail?'},
    },
    {
      projects: {
        getDefaultProject: vi.fn().mockResolvedValue({project: {id: projectId}}),
        getProjectAccessPolicy: vi.fn().mockResolvedValue({
          policy: {
            projectId,
            configSource: {
              managed: true,
              connectionId: crypto.randomUUID(),
              externalRepositoryId: 'managed:repository',
              lookupName: null,
            },
            connections: 'all',
          },
        }),
      } as never,
      wake: async () => undefined,
    },
  );
  if (routed.outcome === 'dropped') throw new Error('Expected a conversation');
  const conversationId = routed.conversationId;

  const workspaces = createTestWorkspacesClient();
  workspaces.state.memberOf.add(workspaceId);
  const integrations = createFakeIntegrations(options);
  const deps = {integrations: integrations.client, projects, workspaces: workspaces.client};
  const begin = async (overrides: Partial<typeof deps> & {admission?: never} = {}) =>
    await beginConversationTurn({conversationId, deps: {...deps, ...overrides}});
  const answer = async (reply = 'Run 7 failed in build.') => {
    const turn = await begin();
    if (!turn) throw new Error('No turn began');
    await runModelCall({
      conversationId,
      turnId: turn.turnId,
      modelCallIndex: 0,
      createModelRuntime: createScriptedModel([textReply(reply)]).createModelRuntime,
    });
    return turn.turnId;
  };
  const deliver = async (turnId?: string) =>
    await deliverConversationReply({conversationId, turnId, integrations: integrations.client});
  return {
    conversationId,
    workspaceId,
    projectId,
    connectionId,
    conversationKey,
    integrations,
    deps,
    begin,
    answer,
    deliver,
    workspaces,
  };
}

function abortableModel(partial: string): CreateModelRuntime {
  return () =>
    Promise.resolve({
      model: {contextWindow: 200_000} as ModelCallRuntime['model'],
      thinking: 'default',
      stream: (_context, options) => {
        const stream = createAssistantMessageEventStream();
        const message = fauxAssistantMessage(partial === '' ? [] : [fauxText(partial)], {
          stopReason: 'aborted',
        });
        queueMicrotask(() => {
          if (partial !== '') {
            stream.push({type: 'text_delta', contentIndex: 0, delta: partial, partial: message});
          }
          options.signal?.addEventListener('abort', () => {
            stream.push({type: 'error', reason: 'aborted', error: message});
            stream.end();
          });
        });
        return stream;
      },
    });
}

describe('reply delivery', () => {
  it('sends the answer of a turn as a response, then clears the progress', async () => {
    const {answer, deliver, integrations, conversationKey, connectionId, workspaceId} =
      await setup();
    const turnId = await answer('Run 7 failed in build.');
    await finishConversationTurn({
      conversationId: (await listTurn(turnId)).conversationId,
      turnId,
      status: 'succeeded',
    });

    await deliver(turnId);

    expect(integrations.replies).toEqual([
      {
        workspaceId,
        connectionId,
        conversationKey,
        replyId: turnId,
        kind: 'response',
        text: 'Run 7 failed in build.',
        agent: {name: 'Shippy'},
      },
    ]);
    expect(integrations.progress.at(-1)).toMatchObject({state: 'idle', conversationKey});
  });

  it('sends a failed turn as an error', async () => {
    const {begin, conversationId, deliver, integrations} = await setup();
    const turn = await begin();
    if (!turn) throw new Error('No turn began');
    await finishConversationTurn({
      conversationId,
      turnId: turn.turnId,
      status: 'failed',
      failureCode: 'provider_error',
    });

    await deliver(turn.turnId);

    expect(integrations.replies).toHaveLength(1);
    expect(integrations.replies[0]).toMatchObject({kind: 'error', replyId: turn.turnId});
    expect(integrations.replies[0]?.text).toContain('model provider');
  });

  it('sends a denial as an error and opens no turn', async () => {
    const {deliver, integrations, deps, conversationId} = await setup();
    const denied = await beginConversationTurn({
      conversationId,
      deps: {
        ...deps,
        admission: {
          policy: {
            admit: async () => ({
              allowed: false,
              reason: 'depleted',
              requiredAction: {reason: 'depleted', message: 'Add credits', url: '/billing'},
            }),
          },
        },
      },
    });
    expect(denied).toBeUndefined();

    await deliver();

    expect(integrations.replies).toHaveLength(1);
    expect(integrations.replies[0]).toMatchObject({kind: 'error', text: 'Add credits'});
    expect(integrations.progress.at(-1)).toMatchObject({state: 'idle'});
    // Nothing is left to tell once the denial was sent.
    await deliver();
    expect(integrations.replies).toHaveLength(1);
  });

  it('sends nothing for an idle conversation', async () => {
    const {deliver, integrations} = await setup();

    await deliver();

    expect(integrations.sendInteractionReply).not.toHaveBeenCalled();
    expect(integrations.progress).toEqual([]);
  });

  it('sends the reply once when the delivery repeats', async () => {
    const {answer, deliver, integrations, conversationId} = await setup();
    const turnId = await answer();
    await finishConversationTurn({conversationId, turnId, status: 'succeeded'});

    await deliver(turnId);
    await deliver(turnId);

    expect(integrations.replies).toHaveLength(1);
    // The repeat still clears the status, in case the first attempt ended before it did.
    expect(integrations.progress.filter(({state}) => state === 'idle')).toHaveLength(2);
  });

  it('ends a turn with no text with a short reply, and clears the progress', async () => {
    const {begin, conversationId, deliver, integrations} = await setup();
    const turn = await begin();
    if (!turn) throw new Error('No turn began');
    await runModelCall({
      conversationId,
      turnId: turn.turnId,
      modelCallIndex: 0,
      createModelRuntime: createScriptedModel([textReply('   ')]).createModelRuntime,
    });
    await finishConversationTurn({conversationId, turnId: turn.turnId, status: 'succeeded'});

    await deliver(turn.turnId);
    await deliver(turn.turnId);

    expect(integrations.replies).toHaveLength(1);
    expect(integrations.replies[0]).toMatchObject({kind: 'response', text: 'Done.'});
    expect(integrations.progress.at(-1)).toMatchObject({state: 'idle'});
  });

  it('does nothing for a turn that is still running', async () => {
    const {answer, deliver, integrations} = await setup();
    const turnId = await answer();

    await deliver(turnId);

    expect(integrations.sendInteractionReply).not.toHaveBeenCalled();
  });

  it('does nothing for a web conversation', async () => {
    const integrations = createFakeIntegrations();
    const {conversation} = await conversationFactory.create({
      workspaceId: crypto.randomUUID(),
      projectId: crypto.randomUUID(),
      ownerUserId: crypto.randomUUID(),
    });

    await deliverConversationReply({
      conversationId: conversation.id,
      integrations: integrations.client,
    });

    expect(integrations.sendInteractionReply).not.toHaveBeenCalled();
    expect(integrations.reportInteractionProgress).not.toHaveBeenCalled();
  });

  describe('stop work', () => {
    async function stopped(reason: 'project_deleted' | 'workspace_suspended') {
      const context = await setupWithBase();
      const turn = await context.begin();
      if (!turn) throw new Error('No turn began');
      const scope = {workspaceId: context.workspaceId, projectId: context.projectId};
      const result = await stopWork({scope, reason});
      await finishConversationTurn({
        conversationId: context.conversationId,
        turnId: turn.turnId,
        status: 'stopped',
      });
      return {...context, turn, scope, result};
    }

    it('asks the running turn to stop and counts it as remaining', async () => {
      const {turn, result} = await stopped('project_deleted');

      expect(result).toEqual({remaining: 1});
      expect((await getTurnById(turn.turnId))?.stopRequestedAt).toBeInstanceOf(Date);
    });

    it('counts nothing remaining once the turn has finished, and a repeat changes nothing', async () => {
      const {scope} = await stopped('project_deleted');

      expect(await stopWork({scope, reason: 'project_deleted'})).toEqual({remaining: 0});
    });

    it('posts nothing for a deleted project, not even the progress status', async () => {
      const {turn, deliver, integrations} = await stopped('project_deleted');

      await deliver(turn.turnId);

      expect(integrations.sendInteractionReply).not.toHaveBeenCalled();
      expect(integrations.reportInteractionProgress).not.toHaveBeenCalled();
    });

    it('still replies "Stopped." for other reasons', async () => {
      const {turn, deliver, integrations} = await stopped('workspace_suspended');

      await deliver(turn.turnId);

      expect(integrations.replies[0]).toMatchObject({kind: 'response', text: 'Stopped.'});
    });

    it('leaves the turns of other projects running', async () => {
      const {scope} = await stopped('project_deleted');
      const other = await setupWithBase();
      const otherTurn = await other.begin();
      if (!otherTurn) throw new Error('No turn began');

      await stopWork({scope, reason: 'project_deleted'});

      expect((await getTurnById(otherTurn.turnId))?.stopRequestedAt).toBeNull();
    });

    it('stops every turn of a workspace when the scope has no project', async () => {
      const context = await setupWithBase();
      const turn = await context.begin();
      if (!turn) throw new Error('No turn began');

      await stopWork({scope: {workspaceId: context.workspaceId}, reason: 'workspace_suspended'});

      expect((await getTurnById(turn.turnId))?.stopRequestedAt).toBeInstanceOf(Date);
    });
  });

  describe('stop', () => {
    it('ends a model call and sends the partial text once', async () => {
      const {begin, conversationId, deliver, integrations} = await setupWithBase();
      const turn = await begin();
      if (!turn) throw new Error('No turn began');

      const call = runModelCall({
        conversationId,
        turnId: turn.turnId,
        modelCallIndex: 0,
        createModelRuntime: abortableModel('Run 7 failed in'),
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      await requestTurnStop(conversationId);
      expect(await call).toEqual({stopReason: 'stopped', toolCallCount: 0});
      await finishConversationTurn({conversationId, turnId: turn.turnId, status: 'stopped'});

      await deliver(turn.turnId);
      await deliver(turn.turnId);

      expect(integrations.replies).toHaveLength(1);
      expect(integrations.replies[0]).toMatchObject({kind: 'response', text: 'Run 7 failed in'});
    });

    it('sends "Stopped." when nothing was written', async () => {
      const {begin, conversationId, deliver, integrations} = await setupWithBase();
      const turn = await begin();
      if (!turn) throw new Error('No turn began');
      await requestTurnStop(conversationId);
      await finishConversationTurn({conversationId, turnId: turn.turnId, status: 'stopped'});

      await deliver(turn.turnId);

      expect(integrations.replies[0]).toMatchObject({kind: 'response', text: 'Stopped.'});
    });

    it('does not send earlier narration as the answer to a stop', async () => {
      const {begin, conversationId, deliver, integrations} = await setupWithBase();
      const turn = await begin();
      if (!turn) throw new Error('No turn began');
      await runModelCall({
        conversationId,
        turnId: turn.turnId,
        modelCallIndex: 0,
        createModelRuntime: createScriptedModel([
          fauxAssistantMessage(
            [fauxText('Let me check.'), fauxToolCall('list_workflow_runs', {limit: 1}, {id: 'c1'})],
            {stopReason: 'toolUse'},
          ),
        ]).createModelRuntime,
      });
      await finishConversationTurn({conversationId, turnId: turn.turnId, status: 'stopped'});

      await deliver(turn.turnId);

      expect(integrations.replies[0]?.text).toBe('Stopped.');
    });

    it('reaches the running turn through a stop interaction', async () => {
      const {begin, conversationId, base} = await setupWithBase();
      const turn = await begin();
      if (!turn) throw new Error('No turn began');

      const result = await routeInteraction(
        {
          ...base,
          deliveryKey: crypto.randomUUID(),
          interaction: {conversationKey: base.conversationKey, role: 'stop', text: ''},
        },
        {
          projects: {
            getProjectAccessPolicy: vi.fn().mockResolvedValue({
              policy: {
                projectId: crypto.randomUUID(),
                configSource: {
                  managed: true,
                  connectionId: crypto.randomUUID(),
                  externalRepositoryId: 'managed:repository',
                  lookupName: null,
                },
                connections: 'all',
              },
            }),
          } as never,
          wake: async () => undefined,
        },
      );

      expect(result).toMatchObject({conversationId});
      expect((await getTurnById(turn.turnId))?.stopRequestedAt).toBeInstanceOf(Date);
    });
  });

  describe('undeliverable', () => {
    it('records a notice and a metric, and does not retry', async () => {
      const {answer, deliver, integrations, conversationId, workspaceId} = await setup({
        sendOutcome: () => ({outcome: 'undeliverable', reason: 'The channel was archived'}),
      });
      const turnId = await answer();
      await finishConversationTurn({conversationId, turnId, status: 'succeeded'});
      const count = vi.spyOn(conversationReplyCount, 'add');

      await deliver(turnId);
      await deliver(turnId);

      expect(count).toHaveBeenCalledTimes(1);
      expect(count).toHaveBeenCalledWith(1, {
        provider: 'slack',
        kind: 'response',
        outcome: 'undeliverable',
      });
      expect(integrations.sendInteractionReply).toHaveBeenCalledTimes(1);
      const items = await listContextItems({conversationId, fromSeq: 1});
      const notices = items.filter((item) => item.meta.custom_type === 'turn_notice');
      expect(notices).toHaveLength(1);
      const notice = JSON.parse(
        openConversationEntry({
          key: await conversationDataKey(workspaceId),
          aad: aadForConversationItem({
            workspaceId,
            conversationId,
            itemId: notices[0]?.id as string,
          }),
          sealed: notices[0]?.sealedEntry as never,
        }),
      );
      expect(notice.data).toMatchObject({code: REPLY_UNDELIVERABLE_NOTICE_CODE});
      expect(notice.data.message).toContain('The channel was archived');
      expect(integrations.progress.at(-1)).toMatchObject({state: 'idle'});
      // The notice is not a denial that still needs telling.
      await deliver();
      expect(integrations.sendInteractionReply).toHaveBeenCalledTimes(1);
    });

    it('treats an inactive connection as undeliverable instead of retrying', async () => {
      const {answer, deliver, integrations, conversationId} = await setup();
      const turnId = await answer();
      await finishConversationTurn({conversationId, turnId, status: 'succeeded'});
      integrations.sendInteractionReply.mockRejectedValueOnce(
        createInterModuleKnownError(
          integrationsInterModuleContract.methods.sendInteractionReply,
          'connection-not-found',
          {connectionId: crypto.randomUUID()},
        ),
      );

      await deliver(turnId);

      const items = await listContextItems({conversationId, fromSeq: 1});
      expect(items.some((item) => item.meta.custom_type === 'turn_notice')).toBe(true);
    });

    it('clears the progress even when the send fails', async () => {
      const {answer, deliver, integrations, conversationId} = await setup();
      const turnId = await answer();
      await finishConversationTurn({conversationId, turnId, status: 'succeeded'});
      integrations.sendInteractionReply.mockRejectedValueOnce(new Error('Slack is down'));

      await expect(deliver(turnId)).rejects.toThrow('Slack is down');

      expect(integrations.progress.at(-1)).toMatchObject({state: 'idle'});
    });

    it('does not fail a delivered reply when the progress can not be cleared', async () => {
      const {answer, deliver, integrations, conversationId} = await setup();
      const turnId = await answer();
      await finishConversationTurn({conversationId, turnId, status: 'succeeded'});
      integrations.reportInteractionProgress.mockRejectedValueOnce(new Error('No status'));

      await deliver(turnId);

      expect(integrations.replies).toHaveLength(1);
    });

    it('retries a failure that may pass', async () => {
      const {answer, deliver, integrations, conversationId} = await setup();
      const turnId = await answer();
      await finishConversationTurn({conversationId, turnId, status: 'succeeded'});
      integrations.sendInteractionReply.mockRejectedValueOnce(new Error('Slack is down'));

      await expect(deliver(turnId)).rejects.toThrow('Slack is down');
      await deliver(turnId);

      expect(integrations.replies).toHaveLength(1);
    });
  });

  describe('tool progress', () => {
    it('reports each tool call as working with the tool label', async () => {
      const {begin, conversationId, integrations, conversationKey} = await setup();
      const turn = await begin();
      if (!turn) throw new Error('No turn began');
      await runModelCall({
        conversationId,
        turnId: turn.turnId,
        modelCallIndex: 0,
        createModelRuntime: createScriptedModel([
          fauxAssistantMessage(
            [
              fauxToolCall('list_workflow_runs', {limit: 1}, {id: 'c1'}),
              fauxToolCall('read_skill', {name: 'x'}, {id: 'c2'}),
            ],
            {stopReason: 'toolUse'},
          ),
        ]).createModelRuntime,
      });

      for (const callIndex of [0, 1]) {
        await runToolCall({
          conversationId,
          turnId: turn.turnId,
          modelCallIndex: 0,
          callIndex,
          integrations: integrations.client,
          lastAttempt: false,
        });
      }

      expect(integrations.progress).toEqual([
        expect.objectContaining({state: 'working', detail: 'list_workflow_runs', conversationKey}),
        expect.objectContaining({state: 'working', detail: 'read_skill', conversationKey}),
      ]);
    });

    it('runs the tool when the provider cannot show progress', async () => {
      const {begin, conversationId, integrations} = await setup();
      integrations.client.reportInteractionProgress = vi
        .fn()
        .mockRejectedValue(new Error('No progress')) as never;
      const turn = await begin();
      if (!turn) throw new Error('No turn began');
      await runModelCall({
        conversationId,
        turnId: turn.turnId,
        modelCallIndex: 0,
        createModelRuntime: createScriptedModel([
          fauxAssistantMessage([fauxToolCall('list_workflow_runs', {limit: 1}, {id: 'c1'})], {
            stopReason: 'toolUse',
          }),
        ]).createModelRuntime,
      });

      const result = await runToolCall({
        conversationId,
        turnId: turn.turnId,
        modelCallIndex: 0,
        callIndex: 0,
        integrations: integrations.client,
        lastAttempt: false,
      });

      expect(result).toEqual({status: 'success'});
    });
  });
});

async function listTurn(turnId: string) {
  const turn = await getTurnById(turnId);
  if (!turn) throw new Error('No turn');
  return turn;
}

async function setupWithBase() {
  const context = await setup();
  return {
    ...context,
    conversation: undefined,
    base: {
      workspaceId: context.workspaceId,
      connectionId: context.connectionId,
      provider: 'slack',
      conversationKey: context.conversationKey,
    },
  };
}
