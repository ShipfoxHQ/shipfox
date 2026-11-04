import {
  type AssistantMessage,
  createAssistantMessageEventStream,
  fauxAssistantMessage,
  fauxText,
  fauxThinking,
  fauxToolCall,
} from '@earendil-works/pi-ai';
import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import {workspacesInterModuleContract} from '@shipfox/api-workspaces-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import {eq} from 'drizzle-orm';
import {db} from '#db/index.js';
import {conversationItems} from '#db/schema/conversation-items.js';
import {conversations} from '#db/schema/conversations.js';
import {turnStreamChunks} from '#db/schema/turn-stream-chunks.js';
import {
  getConversationById,
  getTurnById,
  hasPendingTurnWork,
  listContextItems,
  listConversationsToRecover,
  requestTurnStop,
} from '#db/turn-runtime.js';
import {conversationThinkingDroppedCount} from '#metrics/index.js';
import {conversationFactory} from '#test/factories/conversation.js';
import {createTestProjectsClient} from '#test/fixtures/projects-client.js';
import {createScriptedModel, textReply} from '#test/fixtures/scripted-model.js';
import {createTestWorkspacesClient} from '#test/fixtures/workspaces-client.js';
import {CONVERSATION_SESSION_VERSION} from '../conversation-entries.js';
import {
  aadForConversationItem,
  conversationDataKey,
  openConversationEntry,
} from '../conversation-sealing.js';
import {postWebConversationMessage, requestWebConversationRetry} from '../conversations.js';
import type {ConversationItem} from '../entities/conversation.js';
import {
  ConversationEntryUnreadableError,
  ConversationRetryUnavailableError,
  ConversationTurnRunningError,
} from '../errors.js';
import {routeInteraction} from '../interaction-routing.js';
import {recoverConversations} from '../recover-conversations.js';
import {buildSessionEntries, loadConversationContext} from './conversation-session.js';
import {TurnFailure} from './failures.js';
import {runModelCall} from './model-call.js';
import type {CreateModelRuntime, ModelCallRuntime} from './model-runtime.js';
import {runToolCall} from './tool-call.js';
import {
  beginConversationTurn,
  claimConversationInputs,
  finishConversationTurn,
} from './turn-lifecycle.js';

const prompt = vi.hoisted(() => ({text: 'You are Shippy, first release.'}));

vi.mock('@shipfox/workflow-templates', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shipfox/workflow-templates')>()),
  getBuiltInAgentPrompt: () => prompt.text,
}));

const runsTool = {
  id: 'list_workflow_runs',
  provider: 'shipfox',
  description: 'List workflow runs',
  sensitivity: 'read' as const,
  sensitive: false,
  requiredScope: [],
  inputSchema: {type: 'object', properties: {limit: {type: 'number'}}},
};

function createFakeIntegrations() {
  const callTool = vi.fn().mockResolvedValue({
    outcome: 'success',
    result: null,
    content: [{type: 'text', text: 'run 7 failed in step build'}],
  });
  const listConversationTools = vi.fn().mockResolvedValue({tools: [runsTool]});
  const listInteractionProviders = vi.fn().mockResolvedValue({
    providers: [
      {
        provider: 'slack',
        interactionEvents: {app_mention: 'request'},
        requestContextSchema: {},
        replyGuidance: 'Reply in at most three short paragraphs, with no headings.',
      },
    ],
  });
  return {
    client: {
      callTool,
      listConversationTools,
      listInteractionProviders,
    } as unknown as IntegrationsModuleClient,
    callTool,
    listConversationTools,
    listInteractionProviders,
  };
}

async function readEntry(item: ConversationItem, workspaceId: string) {
  return JSON.parse(
    openConversationEntry({
      key: await conversationDataKey(workspaceId),
      aad: aadForConversationItem({
        workspaceId,
        conversationId: item.conversationId,
        itemId: item.id,
      }),
      sealed: item.sealedEntry,
    }),
  );
}

async function setup(body = 'Why did run 7 fail?') {
  const workspaceId = crypto.randomUUID();
  const projectId = crypto.randomUUID();
  const ownerUserId = crypto.randomUUID();
  const {conversation} = await conversationFactory.create({
    workspaceId,
    projectId,
    ownerUserId,
    body,
  });
  const integrations = createFakeIntegrations();
  const projects = createTestProjectsClient({projects: new Map([[projectId, {workspaceId}]])});
  const workspaces = createTestWorkspacesClient();
  workspaces.state.memberOf.add(workspaceId);
  const deps = {integrations: integrations.client, projects, workspaces: workspaces.client};
  const begin = async () => {
    const turn = await beginConversationTurn({conversationId: conversation.id, deps});
    if (!turn) throw new Error('No turn began');
    return turn.turnId;
  };
  const items = async () => await listContextItems({conversationId: conversation.id, fromSeq: 1});
  return {
    conversation,
    workspaceId,
    projectId,
    ownerUserId,
    integrations,
    workspaces,
    deps,
    begin,
    items,
  };
}

function toolCallReply(options: {thinking?: boolean} = {}): AssistantMessage {
  const thinking = fauxThinking('Look at the run first');
  thinking.thinkingSignature = 'signature-abc';
  return fauxAssistantMessage(
    [
      ...(options.thinking ? [thinking] : []),
      fauxText('Let me check.'),
      fauxToolCall('list_workflow_runs', {limit: 1}, {id: 'call-1'}),
    ],
    {stopReason: 'toolUse'},
  );
}

describe('turn runtime', () => {
  beforeEach(() => {
    prompt.text = 'You are Shippy, first release.';
  });

  describe('beginConversationTurn', () => {
    it('pins the system entry at seq 1 before it claims the first message', async () => {
      const {begin, items, workspaceId} = await setup();

      await begin();

      const [system, user] = await items();
      expect(system).toMatchObject({seq: 1, meta: {role: 'system'}});
      expect(user).toMatchObject({seq: 2, meta: {role: 'user'}});
      const entry = await readEntry(system as ConversationItem, workspaceId);
      expect(entry.message.role).toBe('system');
      expect(entry.message.content).toContain('You are Shippy, first release.');
      expect(entry.message.content).toContain('Project: "Project"');
      expect(entry.message.toolsAdded.map((tool: {name: string}) => tool.name)).toEqual([
        'list_workflow_runs',
        'read_skill',
      ]);
    });

    it('pins the provider reply guidance in the first entry of an integration conversation', async () => {
      const workspaceId = crypto.randomUUID();
      const projectId = crypto.randomUUID();
      const routed = await routeInteraction(
        {
          workspaceId,
          connectionId: crypto.randomUUID(),
          provider: 'slack',
          deliveryKey: crypto.randomUUID(),
          interaction: {conversationKey: 'C1:1.1', role: 'request', text: 'Why did run 7 fail?'},
        },
        {
          projects: {
            getDefaultProject: vi.fn().mockResolvedValue({project: {id: projectId}}),
          },
          wake: async () => undefined,
        },
      );
      if (routed.outcome === 'dropped') throw new Error('Expected a conversation');
      const {deps} = await setup();

      const turn = await beginConversationTurn({
        conversationId: routed.conversationId,
        deps: {
          ...deps,
          projects: createTestProjectsClient({projects: new Map([[projectId, {workspaceId}]])}),
        },
      });

      expect(turn).toBeDefined();
      const [system, user] = await listContextItems({
        conversationId: routed.conversationId,
        fromSeq: 1,
      });
      expect(system).toMatchObject({seq: 1, meta: {role: 'system'}});
      expect(user).toMatchObject({seq: 2, meta: {role: 'user'}});
      const entry = await readEntry(system as ConversationItem, workspaceId);
      expect(entry.message.content).toContain('Started from: "slack"');
      expect(entry.message.content).toContain(
        'Reply in at most three short paragraphs, with no headings.',
      );
      expect(entry.message.content).toContain('<untrusted_data>');
    });

    it('adds no reply guidance to a web conversation', async () => {
      const {begin, items, workspaceId, integrations} = await setup();

      await begin();

      const [system] = await items();
      const entry = await readEntry(system as ConversationItem, workspaceId);
      expect(entry.message.content).not.toContain('Replying here');
      expect(integrations.listInteractionProviders).not.toHaveBeenCalled();
    });

    it('returns the running turn on a repeat and writes nothing more', async () => {
      const {begin, items, conversation} = await setup();

      const first = await begin();
      const second = await begin();

      expect(second).toBe(first);
      expect(await items()).toHaveLength(2);
      expect((await getConversationById(conversation.id))?.lastSeq).toBe(2);
    });

    it('starts no turn when nothing is queued', async () => {
      const {begin, deps, conversation} = await setup();
      const turnId = await begin();
      await finishConversationTurn({conversationId: conversation.id, turnId, status: 'succeeded'});

      const next = await beginConversationTurn({conversationId: conversation.id, deps});

      expect(next).toBeUndefined();
    });

    it('does not change a running conversation when the built-in prompt changes', async () => {
      const {begin, conversation} = await setup();
      const turnId = await begin();
      const model = createScriptedModel([textReply('ok'), textReply('ok again')]);
      await runModelCall({
        conversationId: conversation.id,
        turnId,
        modelCallIndex: 0,
        createModelRuntime: model.createModelRuntime,
      });

      prompt.text = 'You are Shippy, second release.';
      await runModelCall({
        conversationId: conversation.id,
        turnId,
        modelCallIndex: 1,
        createModelRuntime: model.createModelRuntime,
      });

      for (const request of model.requests) {
        expect(JSON.stringify(request.context.messages[0])).toContain('first release');
        expect(JSON.stringify(request.context.messages[0])).not.toContain('second release');
      }
    });

    it('gives a new conversation the current prompt', async () => {
      const first = await setup();
      await first.begin();
      prompt.text = 'You are Shippy, second release.';

      const second = await setup();
      await second.begin();

      const [system] = await second.items();
      const entry = await readEntry(system as ConversationItem, second.workspaceId);
      expect(entry.message.content).toContain('second release');
    });
  });

  describe('runModelCall', () => {
    it('flushes the last text before it ends, and clears it when the turn finishes', async () => {
      const {begin, conversation} = await setup();
      const turnId = await begin();
      const failed = fauxAssistantMessage('Partial text', {
        stopReason: 'error',
        errorMessage: '400 invalid request',
      });
      const model = createScriptedModel([failed]);

      await runModelCall({
        conversationId: conversation.id,
        turnId,
        modelCallIndex: 0,
        createModelRuntime: model.createModelRuntime,
      }).catch((error: unknown) => expect(error).toMatchObject({code: 'provider_error'}));
      const left = await db()
        .select()
        .from(turnStreamChunks)
        .where(eq(turnStreamChunks.turnId, turnId));
      await finishConversationTurn({
        conversationId: conversation.id,
        turnId,
        status: 'failed',
        failureCode: 'provider_error',
      });
      const after = await db()
        .select()
        .from(turnStreamChunks)
        .where(eq(turnStreamChunks.turnId, turnId));

      expect(left).toHaveLength(1);
      expect(after).toHaveLength(0);
    });

    it('stores nothing for a call that outlives its turn', async () => {
      const {begin, items, conversation} = await setup();
      const turnId = await begin();
      await finishConversationTurn({
        conversationId: conversation.id,
        turnId,
        status: 'failed',
        failureCode: 'timeout',
      });
      const model = createScriptedModel([textReply('too late')]);

      const call = runModelCall({
        conversationId: conversation.id,
        turnId,
        modelCallIndex: 0,
        createModelRuntime: model.createModelRuntime,
      });

      await expect(call).rejects.toMatchObject({code: 'internal_error'});
      expect(await items()).toHaveLength(2);
      expect((await getTurnById(turnId))?.modelCallCount).toBe(0);
    });

    it('stores the whole reply as one entry and counts the call', async () => {
      const {begin, items, conversation} = await setup();
      const turnId = await begin();
      const model = createScriptedModel([textReply('Run 7 failed in the build step.')]);

      const result = await runModelCall({
        conversationId: conversation.id,
        turnId,
        modelCallIndex: 0,
        createModelRuntime: model.createModelRuntime,
      });

      expect(result).toEqual({stopReason: 'stop', toolCallCount: 0});
      const stored = (await items()).at(-1) as ConversationItem;
      expect(stored).toMatchObject({seq: 3, turnId, modelCallIndex: 0, meta: {role: 'assistant'}});
      expect((await getConversationById(conversation.id))?.lastAgentSeq).toBe(3);
      expect((await getTurnById(turnId))?.modelCallCount).toBe(1);
    });

    it('returns the stored reply on a repeat and calls no model', async () => {
      const {begin, items, conversation} = await setup();
      const turnId = await begin();
      const model = createScriptedModel([toolCallReply()]);
      const params = {
        conversationId: conversation.id,
        turnId,
        modelCallIndex: 0,
        createModelRuntime: model.createModelRuntime,
      };

      const first = await runModelCall(params);
      const repeat = await runModelCall(params);

      expect(repeat).toEqual(first);
      expect(first).toEqual({stopReason: 'toolUse', toolCallCount: 1});
      expect(model.requests).toHaveLength(1);
      expect(await items()).toHaveLength(3);
      expect((await getTurnById(turnId))?.modelCallCount).toBe(1);
    });

    it('sends identical bytes up to the new entries, with thinking and signatures intact', async () => {
      const {begin, conversation} = await setup();
      const turnId = await begin();
      const model = createScriptedModel([toolCallReply({thinking: true}), textReply('Done.')]);
      const base = {conversationId: conversation.id, turnId};

      await runModelCall({
        ...base,
        modelCallIndex: 0,
        createModelRuntime: model.createModelRuntime,
      });
      await runToolCall({
        ...base,
        modelCallIndex: 0,
        callIndex: 0,
        integrations: createFakeIntegrations().client,
        lastAttempt: false,
      });
      await runModelCall({
        ...base,
        modelCallIndex: 1,
        createModelRuntime: model.createModelRuntime,
      });

      const [first, second] = model.requests.map((request) => request.context.messages);
      const sent = JSON.stringify(first);
      expect(JSON.stringify(second?.slice(0, first?.length))).toBe(sent);
      expect(second?.length).toBeGreaterThan(first?.length ?? 0);
      const assistant = second?.find((message) => message.role === 'assistant') as AssistantMessage;
      expect(assistant.content[0]).toMatchObject({
        type: 'thinking',
        thinking: 'Look at the run first',
        thinkingSignature: 'signature-abc',
      });
    });

    it('passes the conversation ID as the session ID', async () => {
      const {begin, conversation} = await setup();
      const turnId = await begin();
      const model = createScriptedModel([textReply('ok')]);

      await runModelCall({
        conversationId: conversation.id,
        turnId,
        modelCallIndex: 0,
        createModelRuntime: model.createModelRuntime,
      });

      expect(model.requests[0]?.options.sessionId).toBe(conversation.id);
    });

    it('does not end a turn when a model locks after its first call', async () => {
      const {begin, conversation} = await setup();
      const turnId = await begin();
      const model = createScriptedModel([toolCallReply(), textReply('Done.')]);
      const base = {conversationId: conversation.id, turnId};

      await runModelCall({
        ...base,
        modelCallIndex: 0,
        createModelRuntime: model.createModelRuntime,
      });
      await runModelCall({
        ...base,
        modelCallIndex: 1,
        createModelRuntime: model.createModelRuntime,
      });

      expect(model.requests.map((request) => request.params.renewal)).toEqual([false, true]);
    });

    it('stores nothing for a failed call, and tells a transient failure from a final one', async () => {
      const {begin, items, conversation} = await setup();
      const turnId = await begin();
      const base = {conversationId: conversation.id, turnId, modelCallIndex: 0};
      const final = createScriptedModel([
        fauxAssistantMessage('', {stopReason: 'error', errorMessage: '400 invalid request'}),
      ]);
      const transient = createScriptedModel([
        fauxAssistantMessage('', {stopReason: 'error', errorMessage: '529 overloaded'}),
      ]);

      const finalFailure = await runModelCall({
        ...base,
        createModelRuntime: final.createModelRuntime,
      }).catch((error: unknown) => error);
      const transientFailure = await runModelCall({
        ...base,
        createModelRuntime: transient.createModelRuntime,
      }).catch((error: unknown) => error);

      expect(finalFailure).toMatchObject({code: 'provider_error', retryable: false});
      expect(transientFailure).toMatchObject({code: 'provider_unavailable', retryable: true});
      expect(finalFailure).toBeInstanceOf(TurnFailure);
      expect(await items()).toHaveLength(2);
      expect((await getTurnById(turnId))?.modelCallCount).toBe(0);
    });

    it('fails the call when a row can not be opened, because a gap would cut the entry chain', async () => {
      const {begin, conversation, items} = await setup();
      const turnId = await begin();
      const [, user] = await items();
      await db()
        .update(conversationItems)
        .set({body: Buffer.from('not a sealed entry')})
        .where(eq(conversationItems.id, (user as ConversationItem).id));
      const model = createScriptedModel([textReply('never sent')]);

      const call = runModelCall({
        conversationId: conversation.id,
        turnId,
        modelCallIndex: 0,
        createModelRuntime: model.createModelRuntime,
      });

      await expect(call).rejects.toBeInstanceOf(ConversationEntryUnreadableError);
      expect(model.requests).toHaveLength(0);
    });

    it('streams sealed text chunks while the call runs and clears them with the stored reply', async () => {
      const {begin, conversation} = await setup();
      const turnId = await begin();
      const model = createScriptedModel([textReply('Hello there')]);
      const slow = {
        ...model,
        createModelRuntime: async (params: Parameters<typeof model.createModelRuntime>[0]) => {
          const runtime = await model.createModelRuntime(params);
          return {
            ...runtime,
            stream: (...args: Parameters<typeof runtime.stream>) => {
              const stream = runtime.stream(...args);
              return {
                async *[Symbol.asyncIterator]() {
                  for await (const event of stream) {
                    yield event;
                    await new Promise((resolve) => setTimeout(resolve, 400));
                  }
                },
                result: () => stream.result(),
              } as unknown as typeof stream;
            },
          };
        },
      };

      const call = runModelCall({
        conversationId: conversation.id,
        turnId,
        modelCallIndex: 0,
        createModelRuntime: slow.createModelRuntime,
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
      const during = await db()
        .select()
        .from(turnStreamChunks)
        .where(eq(turnStreamChunks.turnId, turnId));
      await call;
      const after = await db()
        .select()
        .from(turnStreamChunks)
        .where(eq(turnStreamChunks.turnId, turnId));

      expect(during).toHaveLength(1);
      expect(during[0]?.body.toString('utf8')).not.toContain('Hello');
      expect(after).toHaveLength(0);
    });

    it('counts the input transformations pi reports for a prompt', async () => {
      const {begin, conversation} = await setup();
      const turnId = await begin();
      const reply = textReply('ok');
      reply.diagnostics = [
        {
          type: 'anthropic_input_transformations',
          timestamp: Date.now(),
          details: {transformations: [{type: 'drop_block'}, {type: 'drop_block'}]},
        },
      ];
      const add = vi.spyOn(conversationThinkingDroppedCount, 'add');

      await runModelCall({
        conversationId: conversation.id,
        turnId,
        modelCallIndex: 0,
        createModelRuntime: createScriptedModel([reply]).createModelRuntime,
      });

      expect(add).toHaveBeenCalledWith(2);
    });
  });

  describe('runToolCall', () => {
    async function afterToolRequest() {
      const context = await setup();
      const turnId = await context.begin();
      const model = createScriptedModel([toolCallReply()]);
      await runModelCall({
        conversationId: context.conversation.id,
        turnId,
        modelCallIndex: 0,
        createModelRuntime: model.createModelRuntime,
      });
      const assistant = (await context.items()).at(-1) as ConversationItem;
      const run = (overrides: {lastAttempt?: boolean} = {}) =>
        runToolCall({
          conversationId: context.conversation.id,
          turnId,
          modelCallIndex: 0,
          callIndex: 0,
          integrations: context.integrations.client,
          lastAttempt: overrides.lastAttempt ?? false,
        });
      return {...context, turnId, assistant, run};
    }

    it('calls the tool as the conversation, keyed by the assistant entry and call index', async () => {
      const {run, integrations, assistant, ownerUserId, conversation, projectId, turnId} =
        await afterToolRequest();

      await run();

      expect(integrations.callTool).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: conversation.workspaceId,
          arguments: {limit: 1},
          caller: {
            kind: 'conversation',
            projectId,
            conversationId: conversation.id,
            agentKey: conversation.agentKey,
            turnId,
            callItemId: `${assistant.id}:0`,
            actorUserId: ownerUserId,
          },
        }),
      );
    });

    it('stores the result wrapped as untrusted data, and repeats nothing after a crash', async () => {
      const {run, items, integrations, workspaceId} = await afterToolRequest();

      const first = await run();
      const repeat = await run();

      expect(first).toEqual({status: 'success'});
      expect(repeat).toEqual({status: 'success'});
      expect(integrations.callTool).toHaveBeenCalledOnce();
      const result = (await items()).at(-1) as ConversationItem;
      expect(result).toMatchObject({seq: 4, callIndex: 0, meta: {role: 'toolResult'}});
      const entry = await readEntry(result, workspaceId);
      expect(entry.message).toMatchObject({
        role: 'toolResult',
        toolCallId: 'call-1',
        isError: false,
      });
      expect(entry.message.content[0].text).toBe(
        '<untrusted_data source="tool:list_workflow_runs">\nrun 7 failed in step build\n</untrusted_data>',
      );
    });

    it('lets a message posted during the call land after its result', async () => {
      const {run, items, conversation, ownerUserId, workspaceId, integrations, turnId} =
        await afterToolRequest();
      integrations.callTool.mockImplementationOnce(async () => {
        await postWebConversationMessage({
          conversation: (await getConversationById(conversation.id)) as never,
          authorUserId: ownerUserId,
          clientMessageId: crypto.randomUUID(),
          body: 'Also check run 8',
        });
        return {outcome: 'success', result: null, content: [{type: 'text', text: 'run 7 failed'}]};
      });

      await run();
      await claimConversationInputs({conversationId: conversation.id, turnId});

      const stored = await items();
      expect(stored.map((item) => item.meta.role)).toEqual([
        'system',
        'user',
        'assistant',
        'toolResult',
        'user',
      ]);
      expect(stored.map((item) => item.seq)).toEqual([1, 2, 3, 4, 5]);
      expect((await readEntry(stored[4] as ConversationItem, workspaceId)).message.role).toBe(
        'user',
      );
    });

    it('stores a tool error for the model to read', async () => {
      const {run, items, integrations, workspaceId} = await afterToolRequest();
      integrations.callTool.mockResolvedValue({
        outcome: 'error',
        code: 'not-found',
        message: 'No such run',
      });

      const result = await run();

      expect(result).toEqual({status: 'error'});
      const entry = await readEntry((await items()).at(-1) as ConversationItem, workspaceId);
      expect(entry.message.isError).toBe(true);
      expect(entry.message.content[0].text).toContain('not-found: No such run');
    });

    it('retries an unexpected failure until the last attempt, then records it', async () => {
      const {run, items, integrations, workspaceId} = await afterToolRequest();
      integrations.callTool.mockRejectedValue(new Error('connection reset'));

      await expect(run()).rejects.toThrow('connection reset');
      const final = await run({lastAttempt: true});

      expect(final).toEqual({status: 'error'});
      const entry = await readEntry((await items()).at(-1) as ConversationItem, workspaceId);
      expect(entry.message.content[0].text).toContain('The tool failed to run');
      expect(entry.message.content[0].text).not.toContain('connection reset');
    });
  });
});

/** A model that streams `partial`, then waits for the abort signal and ends the way pi does. */
function createAbortableModel(partial: string) {
  const createModelRuntime: CreateModelRuntime = () =>
    Promise.resolve({
      model: {contextWindow: 200_000} as ModelCallRuntime['model'],
      thinking: 'default',
      stream: (_context, options) => {
        const stream = createAssistantMessageEventStream();
        const message = fauxAssistantMessage(partial, {stopReason: 'aborted'});
        queueMicrotask(() => {
          stream.push({type: 'text_delta', contentIndex: 0, delta: partial, partial: message});
          options.signal?.addEventListener('abort', () => {
            stream.push({type: 'error', reason: 'aborted', error: message});
            stream.end();
          });
        });
        return stream;
      },
    });
  return {createModelRuntime};
}

describe('turn admission', () => {
  const denial = {
    allowed: false as const,
    reason: 'depleted',
    requiredAction: {reason: 'depleted', message: 'Add credits', url: '/billing'},
  };

  async function setupWithPolicy(admit = vi.fn().mockResolvedValue(denial)) {
    const context = await setup();
    const deps = {...context.deps, admission: {policy: {admit}}};
    const begin = async () =>
      await beginConversationTurn({conversationId: context.conversation.id, deps});
    return {...context, admit, deps, begin};
  }

  async function noticeOf(item: ConversationItem, workspaceId: string) {
    return await readEntry(item, workspaceId);
  }

  it('passes the workspace and the agent source to the policy', async () => {
    const {begin, admit, workspaceId} = await setupWithPolicy();

    await begin();

    expect(admit).toHaveBeenCalledWith({workspaceId, source: 'agent'});
  });

  it('opens no turn on a denial, and writes a notice after the claimed inputs', async () => {
    const {begin, items, workspaceId, conversation} = await setupWithPolicy();

    const turn = await begin();

    expect(turn).toBeUndefined();
    const stored = await items();
    expect(stored.map((item) => [item.seq, item.entryType])).toEqual([
      [1, 'message'],
      [2, 'message'],
      [3, 'custom'],
    ]);
    expect(stored.map((item) => item.meta.role ?? item.meta.custom_type)).toEqual([
      'system',
      'user',
      'turn_notice',
    ]);
    expect(await noticeOf(stored[2] as ConversationItem, workspaceId)).toMatchObject({
      type: 'custom',
      customType: 'turn_notice',
      data: {
        code: 'admission-denied',
        message: null,
        required_action: {reason: 'depleted', message: 'Add credits', url: '/billing'},
      },
    });
    expect((await getConversationById(conversation.id))?.lastSeq).toBe(3);
  });

  it('keeps the pinned prompt at seq 1 and reads it as the base prompt in the next admitted turn', async () => {
    const admit = vi.fn().mockResolvedValueOnce(denial).mockResolvedValue({allowed: true});
    const {begin, items, conversation} = await setupWithPolicy(admit);
    await begin();
    await requestWebConversationRetry(conversation.id);

    const turn = await begin();

    expect(turn).toBeDefined();
    const model = createScriptedModel([textReply('Back again.')]);
    await runModelCall({
      conversationId: conversation.id,
      turnId: turn?.turnId as string,
      modelCallIndex: 0,
      createModelRuntime: model.createModelRuntime,
    });
    const [system] = await items();
    expect(system).toMatchObject({seq: 1, meta: {role: 'system'}});
    const request = model.requests[0]?.context;
    expect(JSON.stringify(request?.messages[0])).toContain('You are Shippy, first release.');
    expect(request?.messages.map((message) => message.role)).toEqual(['system', 'user']);
  });

  it('writes one notice for one denial, even when the activity repeats', async () => {
    const {begin, items} = await setupWithPolicy();

    await begin();
    await begin();

    expect((await items()).filter((item) => item.entryType === 'custom')).toHaveLength(1);
  });

  it('does not ask the policy when nothing is pending', async () => {
    const admit = vi.fn().mockResolvedValue({allowed: true});
    const {begin, admit: policy, conversation} = await setupWithPolicy(admit);
    const turn = await begin();
    await finishConversationTurn({
      conversationId: conversation.id,
      turnId: turn?.turnId as string,
      status: 'succeeded',
    });
    policy.mockClear();

    const next = await begin();

    expect(next).toBeUndefined();
    expect(policy).not.toHaveBeenCalled();
  });

  it('does not stop a turn that is running', async () => {
    const admit = vi.fn().mockResolvedValue({allowed: true});
    const {begin, admit: policy} = await setupWithPolicy(admit);
    const first = await begin();
    policy.mockResolvedValue(denial);

    const second = await begin();

    expect(second).toEqual(first);
    expect(policy).toHaveBeenCalledTimes(1);
  });

  it('retries a policy failure instead of denying', async () => {
    const admit = vi.fn().mockRejectedValue(new Error('Policy unavailable'));
    const {begin, items, conversation} = await setupWithPolicy(admit);

    await expect(begin()).rejects.toThrow('Policy unavailable');

    expect((await items()).map((item) => item.seq)).toEqual([1]);
    expect(await hasPendingTurnWork(conversation.id)).toBe(true);
  });

  it.each([
    'suspended',
    'deleted',
  ] as const)('denies a %s workspace with a notice', async (status) => {
    const {begin, items, workspaces, workspaceId} = await setupWithPolicy(
      vi.fn().mockResolvedValue({allowed: true}),
    );
    workspaces.state.status = status;

    const turn = await begin();

    expect(turn).toBeUndefined();
    const notice = await noticeOf((await items()).at(-1) as ConversationItem, workspaceId);
    expect(notice.data).toMatchObject({code: `workspace-${status}`, required_action: null});
  });

  it('treats a workspace that is gone as deleted', async () => {
    const {begin, items, workspaces, workspaceId} = await setupWithPolicy(
      vi.fn().mockResolvedValue({allowed: true}),
    );
    workspaces.state.stateError = createInterModuleKnownError(
      workspacesInterModuleContract.methods.getWorkspaceOperatingState,
      'workspace-not-found',
      {workspaceId},
    );

    const turn = await begin();

    expect(turn).toBeUndefined();
    const notice = await noticeOf((await items()).at(-1) as ConversationItem, workspaceId);
    expect(notice.data.code).toBe('workspace-deleted');
  });

  it('claims the inputs and opens no turn when the owner left the workspace', async () => {
    const {begin, items, workspaces, workspaceId, admit, conversation} = await setupWithPolicy(
      vi.fn().mockResolvedValue({allowed: true}),
    );
    workspaces.state.memberOf.delete(workspaceId);

    const turn = await begin();

    expect(turn).toBeUndefined();
    expect((await items()).map((item) => [item.seq, item.entryType])).toEqual([
      [1, 'message'],
      [2, 'message'],
    ]);
    expect(admit).not.toHaveBeenCalled();
    expect(await listConversationsToRecover(100)).not.toContain(conversation.id);
  });

  it('leaves nothing for the recovery sweep after a denial', async () => {
    const {begin, conversation} = await setupWithPolicy();

    await begin();

    expect(await listConversationsToRecover(100)).not.toContain(conversation.id);
  });
});

describe('stop', () => {
  it('claims nothing once a stop is requested, and the message waits for the next turn', async () => {
    const {begin, items, conversation, ownerUserId, deps} = await setup();
    const turnId = await begin();
    await postWebConversationMessage({
      conversation: (await getConversationById(conversation.id)) as never,
      authorUserId: ownerUserId,
      clientMessageId: crypto.randomUUID(),
      body: 'Sent while stopping',
    });

    await requestTurnStop(conversation.id);
    const claim = await claimConversationInputs({conversationId: conversation.id, turnId});

    expect(claim).toEqual({claimed: 0, stopRequested: true});
    expect((await items()).map((item) => item.seq)).toEqual([1, 2]);
    await finishConversationTurn({conversationId: conversation.id, turnId, status: 'stopped'});
    const next = await beginConversationTurn({conversationId: conversation.id, deps});
    expect(next?.turnId).not.toBe(turnId);
    expect((await items()).map((item) => item.seq)).toEqual([1, 2, 3]);
  });

  it('claims queued inputs when no stop is requested', async () => {
    const {begin, conversation, ownerUserId} = await setup();
    const turnId = await begin();
    await postWebConversationMessage({
      conversation: (await getConversationById(conversation.id)) as never,
      authorUserId: ownerUserId,
      clientMessageId: crypto.randomUUID(),
      body: 'Joins the turn',
    });

    const claim = await claimConversationInputs({conversationId: conversation.id, turnId});

    expect(claim).toEqual({claimed: 1, stopRequested: false});
  });

  it('asks only the running turn, once', async () => {
    const {begin, conversation} = await setup();

    expect(await requestTurnStop(conversation.id)).toBe(false);
    const turnId = await begin();
    expect(await requestTurnStop(conversation.id)).toBe(true);
    expect(await requestTurnStop(conversation.id)).toBe(false);
    expect((await getTurnById(turnId))?.stopRequestedAt).toBeInstanceOf(Date);
  });

  it('aborts the stream, stores the partial message as aborted, and reports the stop', async () => {
    const {begin, items, conversation, workspaceId} = await setup();
    const turnId = await begin();
    const params = {
      conversationId: conversation.id,
      turnId,
      modelCallIndex: 0,
      createModelRuntime: createAbortableModel('Run 7 failed in').createModelRuntime,
    };

    const call = runModelCall(params);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await requestTurnStop(conversation.id);
    const result = await call;

    expect(result).toEqual({stopReason: 'stopped', toolCallCount: 0});
    const stored = (await items()).at(-1) as ConversationItem;
    expect(stored).toMatchObject({seq: 3, meta: {role: 'assistant', stop_reason: 'aborted'}});
    const entry = await readEntry(stored, workspaceId);
    expect(entry.message.stopReason).toBe('aborted');
    expect(entry.message.content[0].text).toBe('Run 7 failed in');
    expect((await getTurnById(turnId))?.modelCallCount).toBe(1);
    expect(await runModelCall(params)).toEqual({stopReason: 'stopped', toolCallCount: 0});
  });

  it('still fails a call that was aborted for another reason', async () => {
    const {begin, conversation} = await setup();
    const turnId = await begin();
    const controller = new AbortController();

    const call = runModelCall({
      conversationId: conversation.id,
      turnId,
      modelCallIndex: 0,
      createModelRuntime: createAbortableModel('Partial').createModelRuntime,
      signal: controller.signal,
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    controller.abort();

    await expect(call).rejects.toMatchObject({code: 'provider_unavailable', retryable: true});
  });
});

describe('retry', () => {
  async function failedTurn() {
    const context = await setup();
    const turnId = await context.begin();
    await finishConversationTurn({
      conversationId: context.conversation.id,
      turnId,
      status: 'failed',
      failureCode: 'provider_unavailable',
    });
    return context;
  }

  it('runs a failed turn again without a new input, and spends the request', async () => {
    const {conversation, deps, items} = await failedTurn();
    expect(await beginConversationTurn({conversationId: conversation.id, deps})).toBeUndefined();

    await requestWebConversationRetry(conversation.id);
    expect((await getConversationById(conversation.id))?.retryRequestedAt).toBeInstanceOf(Date);
    const turn = await beginConversationTurn({conversationId: conversation.id, deps});

    expect(turn).toBeDefined();
    expect((await getConversationById(conversation.id))?.retryRequestedAt).toBeNull();
    expect((await items()).map((item) => item.seq)).toEqual([1, 2]);
  });

  it('does not wake a failed turn again on its own', async () => {
    const {conversation} = await failedTurn();

    expect(await listConversationsToRecover(100)).not.toContain(conversation.id);
  });

  it('accepts a retry after a denial', async () => {
    const context = await setup();
    const deps = {
      ...context.deps,
      admission: {policy: {admit: vi.fn().mockResolvedValue({allowed: false, reason: 'depleted'})}},
    };
    await beginConversationTurn({conversationId: context.conversation.id, deps});

    await requestWebConversationRetry(context.conversation.id);

    expect(await listConversationsToRecover(100)).toContain(context.conversation.id);
  });

  it('refuses while a turn is running', async () => {
    const {begin, conversation} = await setup();
    await begin();

    await expect(requestWebConversationRetry(conversation.id)).rejects.toBeInstanceOf(
      ConversationTurnRunningError,
    );
  });

  it.each(['succeeded', 'stopped'] as const)('refuses after a %s turn', async (status) => {
    const {begin, conversation} = await setup();
    const turnId = await begin();
    await finishConversationTurn({conversationId: conversation.id, turnId, status});

    await expect(requestWebConversationRetry(conversation.id)).rejects.toBeInstanceOf(
      ConversationRetryUnavailableError,
    );
  });

  it('refuses a conversation that never had a turn', async () => {
    const {conversation} = await setup();

    await expect(requestWebConversationRetry(conversation.id)).rejects.toBeInstanceOf(
      ConversationRetryUnavailableError,
    );
  });
});

describe('recovery sweep', () => {
  it('wakes a conversation with a queued input and no running turn', async () => {
    const {conversation} = await setup();
    const wake = vi.fn().mockResolvedValue(undefined);

    const result = await recoverConversations({wake});

    expect(wake).toHaveBeenCalledWith(conversation.id);
    expect(result.woken).toBeGreaterThanOrEqual(1);
  });

  it('skips a conversation whose turn is running, even with a queued input', async () => {
    const {begin, conversation, ownerUserId} = await setup();
    await begin();
    await postWebConversationMessage({
      conversation: (await getConversationById(conversation.id)) as never,
      authorUserId: ownerUserId,
      clientMessageId: crypto.randomUUID(),
      body: 'Queued',
    });

    expect(await listConversationsToRecover(1000)).not.toContain(conversation.id);
  });

  it('gives an input that arrives during a failing turn its own turn', async () => {
    const {begin, conversation, ownerUserId, deps, items} = await setup();
    const failing = await begin();
    await postWebConversationMessage({
      conversation: (await getConversationById(conversation.id)) as never,
      authorUserId: ownerUserId,
      clientMessageId: crypto.randomUUID(),
      body: 'Arrives mid-turn',
    });
    await finishConversationTurn({
      conversationId: conversation.id,
      turnId: failing,
      status: 'failed',
      failureCode: 'timeout',
    });

    expect(await listConversationsToRecover(1000)).toContain(conversation.id);
    const next = await beginConversationTurn({conversationId: conversation.id, deps});

    expect(next?.turnId).not.toBe(failing);
    expect((await items()).map((item) => item.seq)).toEqual([1, 2, 3]);
    expect(await listConversationsToRecover(1000)).not.toContain(conversation.id);
  });

  it('wakes a conversation with a requested retry', async () => {
    const {begin, conversation} = await setup();
    const turnId = await begin();
    await finishConversationTurn({
      conversationId: conversation.id,
      turnId,
      status: 'failed',
      failureCode: 'timeout',
    });
    await requestWebConversationRetry(conversation.id);

    expect(await listConversationsToRecover(1000)).toContain(conversation.id);
  });
});

describe('conversation session loader', () => {
  it('holds the same session version as pi', async () => {
    const pi = await import('@earendil-works/pi-coding-agent');

    expect(CONVERSATION_SESSION_VERSION).toBe(pi.CURRENT_SESSION_VERSION);
  });

  it('migrates an older row in memory and derives parents from the row order', async () => {
    const pi = await import('@earendil-works/pi-coding-agent');
    const hook = {
      type: 'message',
      timestamp: new Date(0).toISOString(),
      message: {
        role: 'hookMessage',
        customType: 'note',
        content: 'hi',
        display: true,
        timestamp: 1,
      },
    };
    const current = {...hook, message: {role: 'user', content: 'hello', timestamp: 2}};

    const entries = buildSessionEntries({
      pi,
      conversationId: 'conversation',
      rows: [
        {id: 'row-1', sessionVersion: 2, entry: hook},
        {id: 'row-2', sessionVersion: CONVERSATION_SESSION_VERSION, entry: current},
      ],
    });

    expect(entries.map((entry) => [entry.id, entry.parentId])).toEqual([
      ['row-1', null],
      ['row-2', 'row-1'],
    ]);
    expect((entries[0] as {message: {role: string}}).message.role).toBe('custom');
  });

  it('builds the prompt from the stored entries only', async () => {
    const {begin, conversation} = await setup('Why did run 7 fail?');
    await begin();

    const messages = await loadConversationContext({
      conversation: (await getConversationById(conversation.id)) as never,
    });

    expect(messages.map((message) => message.role)).toEqual(['system', 'user']);
    expect(JSON.stringify(messages[1])).toContain('Why did run 7 fail?');
  });

  it('starts at context_start_seq', async () => {
    const {begin, conversation} = await setup();
    await begin();
    await db()
      .update(conversations)
      .set({contextStartSeq: 2})
      .where(eq(conversations.id, conversation.id));

    const messages = await loadConversationContext({
      conversation: (await getConversationById(conversation.id)) as never,
    });

    expect(messages.map((message) => message.role)).toEqual(['user']);
  });
});
