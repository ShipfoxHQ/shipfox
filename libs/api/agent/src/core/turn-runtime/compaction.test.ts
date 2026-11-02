import {fauxAssistantMessage, fauxText, fauxToolCall} from '@earendil-works/pi-ai';
import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import {eq} from 'drizzle-orm';
import {db} from '#db/index.js';
import {conversationItems} from '#db/schema/conversation-items.js';
import {getConversationById, listContextItems} from '#db/turn-runtime.js';
import {conversationFactory} from '#test/factories/conversation.js';
import {createTestProjectsClient} from '#test/fixtures/projects-client.js';
import {createScriptedModel, textReply} from '#test/fixtures/scripted-model.js';
import {createTestWorkspacesClient} from '#test/fixtures/workspaces-client.js';
import {
  aadForConversationItem,
  conversationDataKey,
  openConversationEntry,
} from '../conversation-sealing.js';
import {postWebConversationMessage} from '../conversations.js';
import type {Conversation, ConversationItem} from '../entities/conversation.js';
import {COMPACTION_CALL_INDEX, compactConversation} from './compaction.js';
import {loadConversationContext} from './conversation-session.js';
import {runModelCall} from './model-call.js';
import {runToolCall} from './tool-call.js';
import {
  beginConversationTurn,
  CONTEXT_OVERFLOW_NOTICE,
  finishConversationTurn,
} from './turn-lifecycle.js';

// About 10,000 tokens by pi's chars/4 estimate.
const BIG = 'lorem '.repeat(7_000);
// pi reserves 16,384 tokens, so this window passes the threshold at about 43,600 tokens.
const SMALL_WINDOW = 60_000;

function createFakeIntegrations() {
  return {
    callTool: vi.fn().mockResolvedValue({
      outcome: 'success',
      result: null,
      content: [{type: 'text', text: 'run 7 failed in step build'}],
    }),
    listConversationTools: vi.fn().mockResolvedValue({
      tools: [
        {
          id: 'list_workflow_runs',
          provider: 'shipfox',
          description: 'List workflow runs',
          sensitivity: 'read' as const,
          sensitive: false,
          requiredScope: [],
          inputSchema: {type: 'object', properties: {}},
        },
      ],
    }),
  };
}

async function setup() {
  const workspaceId = crypto.randomUUID();
  const projectId = crypto.randomUUID();
  const ownerUserId = crypto.randomUUID();
  const {conversation} = await conversationFactory.create({
    workspaceId,
    projectId,
    ownerUserId,
    body: `First question. ${BIG}`,
  });
  const fake = createFakeIntegrations();
  const integrations = fake as unknown as IntegrationsModuleClient;
  const workspaces = createTestWorkspacesClient();
  workspaces.state.memberOf.add(workspaceId);
  const deps = {
    integrations,
    projects: createTestProjectsClient({projects: new Map([[projectId, {workspaceId}]])}),
    workspaces: workspaces.client,
  };

  const begin = async () => {
    const turn = await beginConversationTurn({conversationId: conversation.id, deps});
    if (!turn) throw new Error('No turn began');
    return turn.turnId;
  };
  const base = (turnId: string, modelCallIndex = 0) => ({
    conversationId: conversation.id,
    turnId,
    modelCallIndex,
  });
  const ask = async (question: string) => {
    await postWebConversationMessage({
      conversation: (await getConversationById(conversation.id)) as never,
      authorUserId: ownerUserId,
      clientMessageId: crypto.randomUUID(),
      body: question,
    });
  };
  /** Answers the queued message and ends the turn, then queues another question. */
  const answerAndAsk = async (question: string) => {
    const turnId = await begin();
    const model = createScriptedModel([textReply('Noted.')]);
    await runModelCall({...base(turnId), createModelRuntime: model.createModelRuntime});
    await finishConversationTurn({conversationId: conversation.id, turnId, status: 'succeeded'});
    await ask(question);
  };
  const items = async () => await listContextItems({conversationId: conversation.id, fromSeq: 1});
  const read = async (item: ConversationItem) =>
    JSON.parse(
      openConversationEntry({
        key: await conversationDataKey(workspaceId),
        aad: aadForConversationItem({
          workspaceId,
          conversationId: conversation.id,
          itemId: item.id,
        }),
        sealed: item.sealedEntry,
      }),
    );
  return {conversation, begin, base, ask, answerAndAsk, items, read, fake, deps};
}

/** A conversation of four answered questions, and a fifth waiting, so the next prompt is too big. */
async function longConversation() {
  const ctx = await setup();
  for (let round = 2; round <= 5; round += 1) await ctx.answerAndAsk(`Question ${round}. ${BIG}`);
  const turnId = await ctx.begin();
  return {...ctx, turnId};
}

function summaryReply(text = '## Goal\nFind why run 7 failed.') {
  return textReply(text);
}

describe('compaction', () => {
  it('asks to compact when the new results push the estimate over the threshold, and stores nothing', async () => {
    const {turnId, base, items} = await longConversation();
    const before = await items();
    const model = createScriptedModel([], {contextWindow: SMALL_WINDOW});

    const result = await runModelCall({
      ...base(turnId),
      createModelRuntime: model.createModelRuntime,
    });

    expect(result).toEqual({stopReason: 'compact', toolCallCount: 0, compactionCause: 'estimate'});
    expect(model.requests).toHaveLength(0);
    expect(await items()).toHaveLength(before.length);
  });

  it('asks to compact when the provider rejects the prompt for its size', async () => {
    const {turnId, base} = await setup().then(async (ctx) => ({...ctx, turnId: await ctx.begin()}));
    const model = createScriptedModel([
      fauxAssistantMessage('', {
        stopReason: 'error',
        errorMessage: 'prompt is too long: 250000 tokens > 200000 maximum',
      }),
    ]);

    const result = await runModelCall({
      ...base(turnId),
      createModelRuntime: model.createModelRuntime,
    });

    expect(result).toEqual({stopReason: 'compact', toolCallCount: 0, compactionCause: 'overflow'});
  });

  it('summarizes the old part, keeps the recent part, and leaves the timeline as it was', async () => {
    const {turnId, base, items, read, conversation} = await longConversation();
    const before = await items();
    const summarizer = createScriptedModel([summaryReply()]);

    const result = await compactConversation({
      ...base(turnId),
      createModelRuntime: summarizer.createModelRuntime,
    });

    expect(result).toEqual({compacted: true});
    const after = await items();
    expect(after.slice(0, before.length).map((item) => item.id)).toEqual(
      before.map((item) => item.id),
    );
    const entry = after.at(-1) as ConversationItem;
    expect(entry).toMatchObject({
      entryType: 'compaction',
      turnId,
      modelCallIndex: base(turnId).modelCallIndex,
      callIndex: COMPACTION_CALL_INDEX,
      seq: before.length + 1,
    });
    const stored = await read(entry);
    expect(stored).toMatchObject({type: 'compaction', summary: '## Goal\nFind why run 7 failed.'});
    const {contextStartSeq} = (await getConversationById(conversation.id)) as {
      contextStartSeq: number;
    };
    expect(stored.firstKeptEntryId).toBe(after.find((item) => item.seq === contextStartSeq)?.id);
    expect(stored.systemMessage.toolsAdded.map((tool: {name: string}) => tool.name)).toContain(
      'list_workflow_runs',
    );
    expect(contextStartSeq).toBeGreaterThan(1);
  });

  it('keeps the system message and tools in the prompt after a compaction', async () => {
    const {turnId, base, conversation} = await longConversation();
    const before = await loadConversationContext({
      conversation: (await getConversationById(conversation.id)) as never,
    });
    await compactConversation({
      ...base(turnId),
      createModelRuntime: createScriptedModel([summaryReply()]).createModelRuntime,
    });

    const model = createScriptedModel([textReply('Run 7 failed in the build step.')], {
      contextWindow: SMALL_WINDOW,
    });
    const result = await runModelCall({
      ...base(turnId),
      createModelRuntime: model.createModelRuntime,
    });

    expect(result).toEqual({stopReason: 'stop', toolCallCount: 0});
    const sent = model.requests[0]?.context.messages ?? [];
    // pi stamps the carried system message when it compacts, so only the timestamp differs.
    expect({...sent[0], timestamp: 0}).toEqual({...before[0], timestamp: 0});
    expect(JSON.stringify(sent[0])).toContain('list_workflow_runs');
    expect(JSON.stringify(sent[1])).toContain('Find why run 7 failed.');
    expect(sent.length).toBeLessThan(before.length);
    expect(JSON.stringify(sent.at(-1))).toContain('Question 5.');
  });

  it('repeats the call after the compaction and stores one reply', async () => {
    const {turnId, base, items} = await longConversation();
    await compactConversation({
      ...base(turnId),
      createModelRuntime: createScriptedModel([summaryReply()]).createModelRuntime,
    });
    const model = createScriptedModel([textReply('Done.')], {contextWindow: SMALL_WINDOW});

    await runModelCall({...base(turnId), createModelRuntime: model.createModelRuntime});

    const stored = await items();
    expect(stored.filter((item) => item.meta.role === 'assistant').at(-1)).toMatchObject({
      turnId,
      modelCallIndex: 0,
    });
    expect(stored.filter((item) => item.entryType === 'compaction')).toHaveLength(1);
  });

  it('finds the stored compaction on a repeat and calls no model', async () => {
    const {turnId, base, items} = await longConversation();
    const first = createScriptedModel([summaryReply()]);
    await compactConversation({...base(turnId), createModelRuntime: first.createModelRuntime});
    const count = (await items()).length;
    const repeat = createScriptedModel([]);

    const result = await compactConversation({
      ...base(turnId),
      createModelRuntime: repeat.createModelRuntime,
    });

    expect(result).toEqual({compacted: true});
    expect(repeat.requests).toHaveLength(0);
    expect(await items()).toHaveLength(count);
  });

  it('has nothing to compact when the prompt already ends in a compaction', async () => {
    const {turnId, base} = await longConversation();
    await compactConversation({
      ...base(turnId),
      createModelRuntime: createScriptedModel([summaryReply()]).createModelRuntime,
    });
    // A later model call of the turn sees the compaction as the last entry only if nothing followed.
    const model = createScriptedModel([]);

    const result = await compactConversation({
      ...base(turnId, 1),
      createModelRuntime: model.createModelRuntime,
    });

    expect(result).toEqual({compacted: false});
    expect(model.requests).toHaveLength(0);
  });

  it('stores no summary that was cut short by an abort, and lets the turn retry', async () => {
    const {turnId, base, items} = await longConversation();
    const count = (await items()).length;
    const controller = new AbortController();
    controller.abort();

    const call = compactConversation({
      ...base(turnId),
      signal: controller.signal,
      createModelRuntime: createScriptedModel([summaryReply()]).createModelRuntime,
    });

    await expect(call).rejects.toMatchObject({code: 'provider_unavailable', retryable: true});
    expect(await items()).toHaveLength(count);
  });

  it('has nothing to compact when everything fits in the part that is kept', async () => {
    const ctx = await setup();
    const turnId = await ctx.begin();
    const model = createScriptedModel([]);

    const result = await compactConversation({
      ...ctx.base(turnId),
      createModelRuntime: model.createModelRuntime,
    });

    expect(result).toEqual({compacted: false});
  });

  it('updates the previous summary on a second compaction', async () => {
    const {turnId, base, ask, answerAndAsk, begin, conversation} = await longConversation();
    await compactConversation({
      ...base(turnId),
      createModelRuntime: createScriptedModel([summaryReply('First summary.')]).createModelRuntime,
    });
    await runModelCall({
      ...base(turnId),
      createModelRuntime: createScriptedModel([textReply('Answered.')]).createModelRuntime,
    });
    await finishConversationTurn({conversationId: conversation.id, turnId, status: 'succeeded'});
    await ask(`Question 6. ${BIG}`);
    await answerAndAsk(`Question 7. ${BIG}`);
    await answerAndAsk(`Question 8. ${BIG}`);
    const next = await begin();
    const summarizer = createScriptedModel([summaryReply('Second summary.')]);

    const result = await compactConversation({
      ...base(next),
      createModelRuntime: summarizer.createModelRuntime,
    });

    expect(result).toEqual({compacted: true});
    const request = JSON.stringify(summarizer.requests[0]?.context.messages);
    expect(request).toContain('<previous-summary>');
    expect(request).toContain('First summary.');
    const sent = await loadConversationContext({
      conversation: (await getConversationById(conversation.id)) as never,
    });
    expect(JSON.stringify(sent)).toContain('Second summary.');
    expect(JSON.stringify(sent)).not.toContain('First summary.');
  });

  it('never separates a tool call from its result', async () => {
    const ctx = await setup();
    // One turn with a tool call whose result is big, so the cut falls inside the turn.
    ctx.fake.callTool.mockResolvedValue({
      outcome: 'success',
      result: null,
      content: [{type: 'text', text: BIG.repeat(3)}],
    });
    const turnId = await ctx.begin();
    const calls = createScriptedModel([
      fauxAssistantMessage(
        [fauxText('Checking.'), fauxToolCall('list_workflow_runs', {}, {id: 'c1'})],
        {
          stopReason: 'toolUse',
        },
      ),
      fauxAssistantMessage(
        [fauxText('Again.'), fauxToolCall('list_workflow_runs', {}, {id: 'c2'})],
        {
          stopReason: 'toolUse',
        },
      ),
      textReply('Done.'),
    ]);
    for (const index of [0, 1]) {
      await runModelCall({
        ...ctx.base(turnId, index),
        createModelRuntime: calls.createModelRuntime,
      });
      await runToolCall({
        ...ctx.base(turnId, index),
        callIndex: 0,
        integrations: ctx.deps.integrations,
        lastAttempt: false,
      });
    }

    const result = await compactConversation({
      ...ctx.base(turnId, 2),
      createModelRuntime: createScriptedModel([summaryReply(), summaryReply()]).createModelRuntime,
    });

    expect(result).toEqual({compacted: true});
    const conversation = (await getConversationById(ctx.conversation.id)) as Conversation;
    expect(conversation.contextStartSeq).toBeGreaterThan(1);
    const messages = await loadConversationContext({conversation});
    const roles = messages.map((message) => message.role);
    expect(roles[0]).toBe('system');
    for (const [index, message] of messages.entries()) {
      if (message.role !== 'toolResult') continue;
      const call = messages
        .slice(0, index)
        .reverse()
        .find((candidate) => candidate.role === 'assistant');
      expect(JSON.stringify(call)).toContain((message as {toolCallId: string}).toolCallId);
    }
  });

  it('fails the turn with a notice to start a new conversation when it can not fit', async () => {
    const {turnId, conversation, items, read} = await longConversation();

    await finishConversationTurn({
      conversationId: conversation.id,
      turnId,
      status: 'failed',
      failureCode: 'context_overflow',
    });
    await finishConversationTurn({
      conversationId: conversation.id,
      turnId,
      status: 'failed',
      failureCode: 'context_overflow',
    });

    const notices = (await items()).filter((item) => item.entryType === 'custom');
    expect(notices).toHaveLength(1);
    expect(await read(notices[0] as ConversationItem)).toMatchObject({
      type: 'custom',
      customType: 'turn_notice',
      data: {code: 'context_overflow', message: CONTEXT_OVERFLOW_NOTICE},
    });
  });

  it('does not touch rows it did not write', async () => {
    const {turnId, base, items} = await longConversation();
    const [system] = await items();

    await compactConversation({
      ...base(turnId),
      createModelRuntime: createScriptedModel([summaryReply()]).createModelRuntime,
    });

    const [row] = await db()
      .select()
      .from(conversationItems)
      .where(eq(conversationItems.id, (system as ConversationItem).id));
    expect(row?.seq).toBe(1);
  });
});
