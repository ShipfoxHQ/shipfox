import {claimQueuedConversationItems} from '#db/conversations.js';
import {deleteStreamChunks} from '#db/turn-runtime.js';
import {conversationFactory} from '#test/factories/conversation.js';
import {turnFactory} from '#test/factories/turn.js';
import {appendConversationEntry} from '#test/fixtures/conversation-entries.js';
import {endTurn, storeReply, storeStreamChunk} from '#test/fixtures/conversation-stream.js';
import {type ConversationStreamEvent, streamConversation} from './conversation-stream.js';
import type {OpenConversation} from './entities/conversation.js';

const INTERVAL_MS = 10;

async function arrangeConversation() {
  const {conversation} = await conversationFactory.create();
  await claimQueuedConversationItems(conversation.id);
  return conversation;
}

function follow(params: {
  conversation: OpenConversation;
  afterSeq?: number;
  maxDurationMs?: number;
}) {
  const controller = new AbortController();
  const events: ConversationStreamEvent[] = [];
  const finished = (async () => {
    const stream = streamConversation({
      conversation: params.conversation,
      afterSeq: params.afterSeq ?? 0,
      signal: controller.signal,
      intervalMs: INTERVAL_MS,
      maxDurationMs: params.maxDurationMs,
    });
    for await (const event of stream) events.push(event);
  })();
  const types = () => events.map((event) => event.type);
  const text = () =>
    events.flatMap((event) => (event.type === 'delta' ? [event.text] : [])).join('');
  return {events, types, text, finished, stop: () => controller.abort()};
}

describe('streamConversation', () => {
  it('ends at once when no turn runs and no input waits', async () => {
    const conversation = await arrangeConversation();

    const stream = follow({conversation});
    await stream.finished;

    expect(stream.types()).toEqual(['item']);
  });

  it('sends the items after the cursor, then the final turn, and ends', async () => {
    const conversation = await arrangeConversation();
    const turn = await turnFactory.create({conversationId: conversation.id, status: 'succeeded'});
    await appendConversationEntry({
      conversation,
      entry: {
        type: 'message',
        message: {role: 'assistant', content: [{type: 'text', text: 'Answer'}]},
      },
      meta: {role: 'assistant'},
      turnId: turn.id,
      modelCallIndex: 0,
    });

    const stream = follow({conversation, afterSeq: 1});
    await stream.finished;

    expect(stream.types()).toEqual(['item', 'turn']);
    expect(stream.events[0]).toMatchObject({type: 'item', item: {seq: 2, turnId: turn.id}});
    expect(stream.events[1]).toEqual({
      type: 'turn',
      turnId: turn.id,
      status: 'succeeded',
      failureCode: null,
    });
  });

  it('reports why a turn failed', async () => {
    const conversation = await arrangeConversation();
    const turn = await turnFactory.create({
      conversationId: conversation.id,
      status: 'failed',
      failureCode: 'step_limit',
    });

    const stream = follow({conversation, afterSeq: 1});
    await stream.finished;

    expect(stream.events).toEqual([
      {type: 'turn', turnId: turn.id, status: 'failed', failureCode: 'step_limit'},
    ]);
  });

  it('sends the running call from its first chunk after a reset, then the stored reply', async () => {
    const conversation = await arrangeConversation();
    const turn = await turnFactory.create({conversationId: conversation.id});
    const ids = {conversation, turnId: turn.id, modelCallIndex: 0};
    await storeStreamChunk({...ids, chunkSeq: 0, text: 'Hel'});
    await storeStreamChunk({...ids, chunkSeq: 1, text: 'lo'});

    const stream = follow({conversation, afterSeq: 1});
    await vi.waitFor(() => expect(stream.text()).toBe('Hello'));
    await storeStreamChunk({...ids, chunkSeq: 2, text: ' there'});
    await vi.waitFor(() => expect(stream.text()).toBe('Hello there'));
    await storeReply({...ids, text: 'Hello there'});
    await endTurn({turnId: turn.id, status: 'succeeded'});
    await stream.finished;

    expect(stream.types()).toEqual(['turn', 'reset', 'delta', 'delta', 'delta', 'item', 'turn']);
    expect(stream.events[1]).toEqual({type: 'reset', reason: 'reconnect'});
    expect(stream.events.at(-2)).toMatchObject({type: 'item', item: {seq: 2}});
    expect(stream.events.at(-1)).toMatchObject({type: 'turn', status: 'succeeded'});
  });

  it('sends no chunk twice across ticks', async () => {
    const conversation = await arrangeConversation();
    const turn = await turnFactory.create({conversationId: conversation.id});
    const ids = {conversation, turnId: turn.id, modelCallIndex: 0};
    await storeStreamChunk({...ids, chunkSeq: 0, text: 'a'});

    const stream = follow({conversation, afterSeq: 1});
    await vi.waitFor(() => expect(stream.text()).toBe('a'));
    await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS * 5));
    await storeStreamChunk({...ids, chunkSeq: 1, text: 'b'});
    await vi.waitFor(() => expect(stream.text()).toBe('ab'));
    await endTurn({turnId: turn.id, status: 'stopped'});
    await stream.finished;

    expect(stream.text()).toBe('ab');
  });

  it('resets partial text when the model call starts over', async () => {
    const conversation = await arrangeConversation();
    const turn = await turnFactory.create({conversationId: conversation.id});
    const ids = {conversation, turnId: turn.id, modelCallIndex: 0};
    await storeStreamChunk({...ids, chunkSeq: 0, text: 'Partial '});
    await storeStreamChunk({...ids, chunkSeq: 1, text: 'text'});

    const stream = follow({conversation, afterSeq: 1});
    await vi.waitFor(() => expect(stream.text()).toBe('Partial text'));
    await deleteStreamChunks({turnId: turn.id, modelCallIndex: 0});
    await storeStreamChunk({...ids, chunkSeq: 0, text: 'Fresh'});
    await vi.waitFor(() => expect(stream.text()).toBe('Partial textFresh'));
    await endTurn({turnId: turn.id, status: 'failed', failureCode: 'provider_unavailable'});
    await stream.finished;

    const afterReset = stream.events.slice(
      stream.events.findIndex((event) => event.type === 'reset' && event.reason === 'retry'),
    );
    expect(afterReset.map((event) => event.type)).toEqual(['reset', 'delta', 'turn']);
    expect(afterReset[1]).toMatchObject({type: 'delta', text: 'Fresh'});
  });

  it('resets when a retry rewrites the chunk the reader holds', async () => {
    const conversation = await arrangeConversation();
    const turn = await turnFactory.create({conversationId: conversation.id});
    const ids = {conversation, turnId: turn.id, modelCallIndex: 0};
    await storeStreamChunk({...ids, chunkSeq: 0, text: 'old '});
    await storeStreamChunk({...ids, chunkSeq: 1, text: 'text'});

    const stream = follow({conversation, afterSeq: 1});
    await vi.waitFor(() => expect(stream.text()).toBe('old text'));
    // The retry outpaces the reader, so the chunk at its cursor exists again with new text.
    await deleteStreamChunks({turnId: turn.id, modelCallIndex: 0});
    await storeStreamChunk({...ids, chunkSeq: 0, text: 'new '});
    await storeStreamChunk({...ids, chunkSeq: 1, text: 'text!'});
    await vi.waitFor(() => expect(stream.text()).toBe('old textnew text!'));
    await endTurn({turnId: turn.id, status: 'stopped'});
    await stream.finished;

    expect(stream.events.filter((event) => event.type === 'reset')).toEqual([
      {type: 'reset', reason: 'reconnect'},
      {type: 'reset', reason: 'retry'},
    ]);
  });

  it('moves to the chunks of the next call once a reply replaces the first', async () => {
    const conversation = await arrangeConversation();
    const turn = await turnFactory.create({conversationId: conversation.id});
    const first = {conversation, turnId: turn.id, modelCallIndex: 0};
    const second = {conversation, turnId: turn.id, modelCallIndex: 1};
    await storeStreamChunk({...first, chunkSeq: 0, text: 'Looking. '});

    const stream = follow({conversation, afterSeq: 1});
    await vi.waitFor(() => expect(stream.text()).toBe('Looking. '));
    await storeReply({...first, text: 'Looking. '});
    await storeStreamChunk({...second, chunkSeq: 0, text: 'Found it.'});
    await vi.waitFor(() => expect(stream.text()).toBe('Looking. Found it.'));
    await endTurn({turnId: turn.id, status: 'succeeded'});
    await stream.finished;

    expect(stream.events.filter((event) => event.type === 'reset')).toHaveLength(1);
    expect(stream.events.filter((event) => event.type === 'delta')).toEqual([
      {type: 'delta', turnId: turn.id, modelCallIndex: 0, text: 'Looking. '},
      {type: 'delta', turnId: turn.id, modelCallIndex: 1, text: 'Found it.'},
    ]);
    expect(stream.types()).toEqual(['turn', 'reset', 'delta', 'item', 'delta', 'turn']);
  });

  it('sends every page of items before the text of the running call', async () => {
    const conversation = await arrangeConversation();
    for (let index = 0; index < 120; index += 1) {
      await appendConversationEntry({
        conversation,
        entry: {type: 'message', message: {role: 'user', content: [{type: 'text', text: 'hi'}]}},
        meta: {role: 'user'},
      });
    }
    const turn = await turnFactory.create({conversationId: conversation.id});
    await storeStreamChunk({
      conversation,
      turnId: turn.id,
      modelCallIndex: 0,
      chunkSeq: 0,
      text: 'Live',
    });

    const stream = follow({conversation});
    await vi.waitFor(() => expect(stream.text()).toBe('Live'));
    stream.stop();
    await stream.finished;

    const types = stream.types();
    expect(types.filter((type) => type === 'item')).toHaveLength(121);
    expect(types.indexOf('delta')).toBeGreaterThan(types.lastIndexOf('item'));
  });

  it('waits for a turn while an input is queued, and announces the input once', async () => {
    const {conversation} = await conversationFactory.create();

    const stream = follow({conversation});
    await vi.waitFor(() => expect(stream.types()).toEqual(['queued']));
    await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS * 5));
    const turn = await turnFactory.create({conversationId: conversation.id});
    await claimQueuedConversationItems(conversation.id);
    await vi.waitFor(() => expect(stream.types()).toContain('turn'));
    await endTurn({turnId: turn.id, status: 'succeeded'});
    await stream.finished;

    expect(stream.types()).toEqual(['queued', 'turn', 'item', 'turn']);
    expect(stream.events[1]).toMatchObject({type: 'turn', status: 'running'});
  });

  it('does not take an earlier, finished turn for the one a queued input waits on', async () => {
    const conversation = await arrangeConversation();
    const earlier = await turnFactory.create({conversationId: conversation.id, status: 'failed'});
    await postQueued(conversation);

    const stream = follow({conversation, afterSeq: 1});
    await vi.waitFor(() => expect(stream.types()).toEqual(['queued']));
    const next = await turnFactory.create({
      conversationId: conversation.id,
      startedAt: new Date(earlier.startedAt.getTime() + 1),
    });
    await vi.waitFor(() => expect(stream.types()).toContain('turn'));
    await endTurn({turnId: next.id, status: 'succeeded'});
    await stream.finished;

    const turnEvents = stream.events.filter((event) => event.type === 'turn');
    expect(turnEvents.map((event) => event.turnId)).not.toContain(earlier.id);
    expect(turnEvents.at(-1)).toMatchObject({turnId: next.id, status: 'succeeded'});
  });

  it('ends at the deadline with the turn still running', async () => {
    const conversation = await arrangeConversation();
    await turnFactory.create({conversationId: conversation.id});

    const stream = follow({conversation, afterSeq: 1, maxDurationMs: INTERVAL_MS * 5});
    await stream.finished;

    expect(stream.types()).toEqual(['turn', 'reset']);
  });

  it('ends when the reader leaves', async () => {
    const conversation = await arrangeConversation();
    await turnFactory.create({conversationId: conversation.id});

    const stream = follow({conversation, afterSeq: 1});
    await vi.waitFor(() => expect(stream.types()).toContain('reset'));
    stream.stop();
    await stream.finished;

    expect(stream.types()).toEqual(['turn', 'reset']);
  });

  it('keeps the pinned system entry away from the reader', async () => {
    const {conversation} = await conversationFactory.create();
    await appendConversationEntry({
      conversation,
      entry: {type: 'message', message: {role: 'system', content: 'secret prompt'}},
      meta: {role: 'system'},
    });
    await claimQueuedConversationItems(conversation.id);

    const stream = follow({conversation});
    await stream.finished;

    expect(JSON.stringify(stream.events)).not.toContain('secret prompt');
  });
});

async function postQueued(conversation: OpenConversation) {
  const {postWebConversationMessage} = await import('./conversations.js');
  return await postWebConversationMessage({
    conversation: {...conversation, sealedTitle: null},
    authorUserId: conversation.ownerUserId as string,
    clientMessageId: crypto.randomUUID(),
    body: 'Another question',
  });
}
