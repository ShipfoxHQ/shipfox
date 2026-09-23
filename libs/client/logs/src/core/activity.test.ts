import {buildActivityNodes, pairSessionRows} from './activity.js';
import type {LogRecord, SessionViewRow} from './log-model.js';
import {buildLogSearchIndex, filterActivityNodes} from './log-search.js';
import {buildLogTree} from './log-tree.js';

const toolCall = (
  seq: number,
  id: string | null,
  name = `tool-${seq}`,
): {seq: number; lineNumber: number; row: SessionViewRow} => ({
  seq,
  lineNumber: seq + 1,
  row: {kind: 'tool-call', timestamp: seq * 10, id, name, input: `input-${seq}`},
});

const toolResult = (
  seq: number,
  toolCallId: string | null,
  isError = false,
): {seq: number; lineNumber: number; row: SessionViewRow} => ({
  seq,
  lineNumber: seq + 1,
  row: {
    kind: 'tool-result',
    timestamp: seq * 10,
    toolCallId,
    toolName: 'tool',
    output: `output-${seq}`,
    isError,
  },
});

describe('pairSessionRows', () => {
  test('pairs parallel results at each request position and computes duration', () => {
    const items = pairSessionRows([
      toolCall(1, 'first'),
      toolCall(2, 'second'),
      toolResult(3, 'second'),
      toolResult(4, 'first'),
    ]);

    expect(items.map((item) => item.kind)).toEqual(['action', 'action']);
    expect(items[0]).toMatchObject({
      kind: 'action',
      action: {requestSeq: 1, resultSeq: 4, state: 'succeeded', durationMs: 30},
    });
    expect(items[1]).toMatchObject({
      kind: 'action',
      action: {requestSeq: 2, resultSeq: 3, state: 'succeeded', durationMs: 10},
    });
  });

  test('uses each request sequence when an ID is reused', () => {
    const items = pairSessionRows([
      toolCall(1, 'same'),
      toolResult(2, 'same'),
      toolCall(3, 'same'),
      toolResult(4, 'same'),
    ]);

    expect(items.map((item) => (item.kind === 'action' ? item.action.sourceSeqs : []))).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  test('keeps null IDs and unmatched results as expandable standalone actions', () => {
    const items = pairSessionRows([toolCall(1, null), toolResult(2, 'missing', true)]);

    expect(items).toMatchObject([
      {kind: 'action', action: {requestSeq: 1, result: null, state: 'running'}},
      {kind: 'action', action: {request: null, resultSeq: 2, state: 'failed'}},
    ]);
  });

  test('stops unresolved calls with no result after termination', () => {
    const [item] = pairSessionRows([toolCall(1, 'pending')], true);

    expect(item).toMatchObject({kind: 'action', action: {state: 'no-result'}});
  });

  test('does not calculate duration from invalid timestamp order', () => {
    const result = toolResult(2, 'call');
    result.row = {...result.row, timestamp: 0};
    const items = pairSessionRows([toolCall(1, 'call'), result]);

    expect(items[0]).toMatchObject({kind: 'action', action: {durationMs: null}});
  });
});

describe('Activity search', () => {
  test('keeps a paired action when only its result matches', () => {
    const records: LogRecord[] = [
      {v: 1, ts: 10, type: 'agent_session', row: toolCall(0, 'call').row},
      {v: 1, ts: 20, type: 'agent_session', row: toolResult(1, 'call').row},
    ];
    const tree = buildLogTree(records);
    const activityNodes = buildActivityNodes(tree.nodes);
    const filtered = filterActivityNodes(
      activityNodes,
      'output-1',
      buildLogSearchIndex(tree.nodes),
    );

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.kind).toBe('action');
  });
});
