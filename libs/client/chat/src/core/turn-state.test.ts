import type {ConversationTurn} from './conversation.js';
import {
  currentTurn,
  partialTextOf,
  replyActivity,
  shippyStateOf,
  turnFailure,
} from './turn-state.js';

const stored: ConversationTurn = {
  id: 'turn-1',
  status: 'running',
  failureCode: null,
  stopRequested: false,
  model: 'claude-opus-5-5',
  provider: 'anthropic',
};

const idle = {
  turn: undefined,
  awaitingTurn: false,
  slowStart: false,
  partialText: '',
  stopRequested: false,
  reconnecting: false,
};

describe('currentTurn', () => {
  test('takes the end of the turn from the stream before the next read', () => {
    const turn = currentTurn({
      stored,
      live: {turnId: 'turn-1', status: 'failed', failureCode: 'step_limit'},
    });

    expect(turn).toMatchObject({
      status: 'failed',
      failureCode: 'step_limit',
      model: 'claude-opus-5-5',
    });
  });

  test('keeps a newer running turn the stream has not reached', () => {
    const turn = currentTurn({
      stored: {...stored, id: 'turn-2'},
      live: {turnId: 'turn-1', status: 'succeeded', failureCode: null},
    });

    expect(turn?.id).toBe('turn-2');
  });
});

describe('partialTextOf', () => {
  const live = {
    turn: {turnId: 'turn-1', status: 'running' as const, failureCode: null},
    partialText: 'The tests',
  };

  test('keeps the text of a dropped stream while its turn runs', () => {
    expect(partialTextOf({live, turn: stored})).toBe('The tests');
  });

  test('drops the text once another turn runs, or the turn ends', () => {
    expect(partialTextOf({live, turn: {...stored, id: 'turn-2'}})).toBe('');
    expect(partialTextOf({live, turn: {...stored, status: 'failed'}})).toBe('');
  });
});

describe('replyActivity', () => {
  test('reads thinking until text streams, then replying', () => {
    expect(replyActivity({...idle, turn: stored})).toEqual({kind: 'thinking'});
    expect(replyActivity({...idle, turn: stored, partialText: 'The'})).toEqual({kind: 'replying'});
  });

  test('reads stopping once a stop is requested, and before a reconnect', () => {
    expect(replyActivity({...idle, turn: stored, stopRequested: true, reconnecting: true})).toEqual(
      {
        kind: 'stopping',
      },
    );
    expect(replyActivity({...idle, turn: {...stored, stopRequested: true}})).toEqual({
      kind: 'stopping',
    });
  });

  test('reads reconnecting only while a turn runs', () => {
    expect(replyActivity({...idle, turn: stored, reconnecting: true})).toEqual({
      kind: 'reconnecting',
    });
    expect(replyActivity({...idle, reconnecting: true})).toEqual({kind: 'idle'});
  });

  test('reads a slow start while a message waits for a turn', () => {
    expect(replyActivity({...idle, awaitingTurn: true})).toEqual({kind: 'thinking'});
    expect(replyActivity({...idle, awaitingTurn: true, slowStart: true})).toEqual({
      kind: 'slow-start',
    });
  });
});

describe('shippyStateOf', () => {
  const succeeded: ConversationTurn = {...stored, status: 'succeeded'};

  test('works while a reply runs or a message waits for its turn', () => {
    expect(
      shippyStateOf({
        activity: {kind: 'replying'},
        turn: stored,
        unread: false,
        unreadElsewhere: false,
      }),
    ).toBe('working');
    expect(
      shippyStateOf({
        activity: {kind: 'thinking'},
        turn: succeeded,
        unread: true,
        unreadElsewhere: false,
      }),
    ).toBe('working');
  });

  test('shows a reply as ready only while it is unread', () => {
    expect(
      shippyStateOf({
        activity: {kind: 'idle'},
        turn: succeeded,
        unread: true,
        unreadElsewhere: false,
      }),
    ).toBe('reply_ready');
    expect(
      shippyStateOf({
        activity: {kind: 'idle'},
        turn: succeeded,
        unread: false,
        unreadElsewhere: false,
      }),
    ).toBe('idle');
  });

  test('stays still after a failed turn, even when it is unread', () => {
    const failed: ConversationTurn = {...stored, status: 'failed', failureCode: 'timeout'};

    expect(
      shippyStateOf({activity: {kind: 'idle'}, turn: failed, unread: true, unreadElsewhere: false}),
    ).toBe('failed');
  });

  test('shows a reply as ready when another conversation has one unread', () => {
    expect(
      shippyStateOf({
        activity: {kind: 'idle'},
        turn: undefined,
        unread: false,
        unreadElsewhere: true,
      }),
    ).toBe('reply_ready');
  });

  test('rests after a stopped turn or with no conversation', () => {
    const stopped: ConversationTurn = {...stored, status: 'stopped'};

    expect(
      shippyStateOf({
        activity: {kind: 'idle'},
        turn: stopped,
        unread: true,
        unreadElsewhere: false,
      }),
    ).toBe('idle');
    expect(
      shippyStateOf({
        activity: {kind: 'idle'},
        turn: undefined,
        unread: false,
        unreadElsewhere: false,
      }),
    ).toBe('idle');
  });
});

describe('turnFailure', () => {
  test('continues a turn stopped at the step limit', () => {
    expect(turnFailure('step_limit')).toMatchObject({
      title: 'Stopped after 25 steps.',
      actions: ['continue'],
    });
  });

  test('offers a new conversation when the conversation is too long', () => {
    expect(turnFailure('context_overflow')).toMatchObject({
      kind: 'too-long',
      title: 'This conversation is too long to continue.',
      actions: ['new-conversation'],
    });
  });

  test('names the provider failure and offers Retry', () => {
    expect(turnFailure('provider_unavailable')).toMatchObject({
      kind: 'failed',
      description: "The model provider didn't respond.",
      actions: ['retry'],
    });
    expect(turnFailure(null)).toMatchObject({description: undefined, actions: ['retry']});
  });
});
