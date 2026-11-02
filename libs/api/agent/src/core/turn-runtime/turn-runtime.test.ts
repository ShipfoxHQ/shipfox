import {
  type AssistantMessage,
  fauxAssistantMessage,
  fauxText,
  fauxThinking,
  fauxToolCall,
} from '@earendil-works/pi-ai';
import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import {eq} from 'drizzle-orm';
import {db} from '#db/index.js';
import {conversationItems} from '#db/schema/conversation-items.js';
import {conversations} from '#db/schema/conversations.js';
import {turnStreamChunks} from '#db/schema/turn-stream-chunks.js';
import {getConversationById, getTurnById, listContextItems} from '#db/turn-runtime.js';
import {conversationThinkingDroppedCount} from '#metrics/index.js';
import {conversationFactory} from '#test/factories/conversation.js';
import {createTestProjectsClient} from '#test/fixtures/projects-client.js';
import {createScriptedModel, textReply} from '#test/fixtures/scripted-model.js';
import {CONVERSATION_SESSION_VERSION} from '../conversation-entries.js';
import {
  aadForConversationItem,
  conversationDataKey,
  openConversationEntry,
} from '../conversation-sealing.js';
import {postWebConversationMessage} from '../conversations.js';
import type {ConversationItem} from '../entities/conversation.js';
import {ConversationEntryUnreadableError} from '../errors.js';
import {buildSessionEntries, loadConversationContext} from './conversation-session.js';
import {TurnFailure} from './failures.js';
import {runModelCall} from './model-call.js';
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
  return {
    client: {callTool, listConversationTools} as unknown as IntegrationsModuleClient,
    callTool,
    listConversationTools,
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
  const deps = {integrations: integrations.client, projects};
  const begin = async () => {
    const turn = await beginConversationTurn({conversationId: conversation.id, deps});
    if (!turn) throw new Error('No turn began');
    return turn.turnId;
  };
  const items = async () => await listContextItems({conversationId: conversation.id, fromSeq: 1});
  return {conversation, workspaceId, projectId, ownerUserId, integrations, deps, begin, items};
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
      const {run, items, conversation, ownerUserId, workspaceId, integrations} =
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
      await claimConversationInputs(conversation.id);

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
