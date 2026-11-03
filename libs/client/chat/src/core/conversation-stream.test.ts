import {
  type ConversationStreamEvent,
  type ConversationStreamState,
  createConversationStreamState,
  isFinalTurnStatus,
  reconnectDelayMs,
  reduceConversationStream,
  type StreamedItem,
} from './conversation-stream.js';

type Item = StreamedItem & {label: string};

const turnId = 'turn-1';

function item(params: {id: string; seq: number | null; turnId?: string | null}): Item {
  return {id: params.id, seq: params.seq, turnId: params.turnId ?? null, label: params.id};
}

function reduceAll(events: ConversationStreamEvent<Item>[], from?: ConversationStreamState<Item>) {
  return events.reduce(reduceConversationStream, from ?? createConversationStreamState<Item>());
}

describe('reduceConversationStream', () => {
  it('builds the reply from text in order', () => {
    const state = reduceAll([
      {kind: 'text', text: 'Hel'},
      {kind: 'text', text: 'lo'},
    ]);

    expect(state.partialText).toBe('Hello');
  });

  it('clears partial text when a retried model call resets', () => {
    const state = reduceAll([
      {kind: 'text', text: 'Partial text from a failed call'},
      {kind: 'reset'},
      {kind: 'text', text: 'Fresh'},
    ]);

    expect(state.partialText).toBe('Fresh');
  });

  it('replaces partial text with the stored reply of the turn', () => {
    const state = reduceAll([
      {kind: 'text', text: 'Hello'},
      {kind: 'item', item: item({id: 'reply', seq: 2, turnId})},
    ]);

    expect(state.partialText).toBe('');
    expect(state.items.map((stored) => stored.id)).toEqual(['reply']);
  });

  it('keeps partial text when an input arrives', () => {
    const state = reduceAll([
      {kind: 'text', text: 'Hello'},
      {kind: 'item', item: item({id: 'next-question', seq: 3})},
    ]);

    expect(state.partialText).toBe('Hello');
  });

  it('moves an input from queued to items once the agent claims it', () => {
    const queued = item({id: 'q', seq: null});

    const state = reduceAll([
      {kind: 'queued', item: queued},
      {kind: 'item', item: {...queued, seq: 4}},
    ]);

    expect(state.queued).toEqual([]);
    expect(state.items).toEqual([{...queued, seq: 4}]);
    expect(state.lastSeq).toBe(4);
  });

  it('keeps items once and in order when a reconnect sends them again', () => {
    const events: ConversationStreamEvent<Item>[] = [
      {kind: 'item', item: item({id: 'b', seq: 2})},
      {kind: 'item', item: item({id: 'a', seq: 1})},
      {kind: 'queued', item: item({id: 'q', seq: null})},
    ];

    const state = reduceAll([...events, ...events]);

    expect(state.items.map((stored) => stored.id)).toEqual(['a', 'b']);
    expect(state.queued.map((stored) => stored.id)).toEqual(['q']);
  });

  it('does not queue an input it already holds as an item', () => {
    const state = reduceAll([
      {kind: 'item', item: item({id: 'a', seq: 1})},
      {kind: 'queued', item: item({id: 'a', seq: null})},
    ]);

    expect(state.queued).toEqual([]);
  });

  it('tracks the highest seq for the next reconnect', () => {
    const state = reduceAll(
      [{kind: 'item', item: item({id: 'a', seq: 8})}],
      createConversationStreamState<Item>(5),
    );

    expect(state.lastSeq).toBe(8);
  });

  it('drops partial text when the turn ends without storing a reply', () => {
    const state = reduceAll([
      {kind: 'turn', turnId, status: 'running', failureCode: null},
      {kind: 'text', text: 'Partial'},
      {kind: 'turn', turnId, status: 'failed', failureCode: 'provider_unavailable'},
    ]);

    expect(state.partialText).toBe('');
    expect(state.turn).toEqual({
      turnId,
      status: 'failed',
      failureCode: 'provider_unavailable',
    });
  });
});

describe('isFinalTurnStatus', () => {
  it.each([
    {status: 'running' as const, expected: false},
    {status: 'succeeded' as const, expected: true},
    {status: 'failed' as const, expected: true},
    {status: 'stopped' as const, expected: true},
  ])('is $expected for $status', ({status, expected}) => {
    expect(isFinalTurnStatus(status)).toBe(expected);
  });
});

describe('reconnectDelayMs', () => {
  it('doubles after each failure in a row, up to a cap', () => {
    const delays = [1, 2, 3, 4, 5, 6, 7].map(reconnectDelayMs);

    expect(delays).toEqual([500, 1000, 2000, 4000, 8000, 8000, 8000]);
  });
});
