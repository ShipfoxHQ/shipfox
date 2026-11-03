import type {ConversationTurn} from './conversation.js';
import {currentTurn, replyActivity, turnFailure} from './turn-state.js';

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
