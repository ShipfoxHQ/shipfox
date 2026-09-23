import {buildActivityNodes, groupActivityReads, pairSessionRows} from './activity.js';
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

function recordedAction(
  id: string,
  name: string,
  input: string,
  output: string | null = 'read result',
  isError = false,
): LogRecord[] {
  const rows: LogRecord[] = [
    {v: 1, ts: 10, type: 'agent_session', row: {kind: 'tool-call', timestamp: 10, id, name, input}},
  ];
  if (output !== null) {
    rows.push({
      v: 1,
      ts: 11,
      type: 'agent_session',
      row: {kind: 'tool-result', timestamp: 11, toolCallId: id, toolName: name, output, isError},
    });
  }
  return rows;
}

describe('groupActivityReads', () => {
  test('groups Pi and Claude reads but stops at messages, output, writes, and gaps', () => {
    const records: LogRecord[] = [
      ...recordedAction('pi-1', 'read', '{"path":"one.ts"}'),
      ...recordedAction('pi-2', 'read', '{"path":"two.ts"}'),
      {
        v: 1,
        ts: 12,
        type: 'agent_session',
        row: {
          kind: 'message',
          timestamp: 12,
          role: 'assistant',
          label: 'assistant',
          text: 'Next',
          meta: [],
          terminalFailure: false,
        },
      },
      ...recordedAction('claude-1', 'Read', '{"file_path":"one.ts"}'),
      ...recordedAction('claude-2', 'Read', '{"file_path":"two.ts"}'),
      {v: 1, ts: 13, type: 'output', stream: 'stdout', data: 'build output'},
      ...recordedAction('write', 'Write', '{"file_path":"out.ts","content":"x"}'),
      ...recordedAction('claude-3', 'Read', '{"file_path":"three.ts"}'),
      {v: 1, ts: 14, type: 'gap', droppedBytes: 10},
      ...recordedAction('claude-4', 'Read', '{"file_path":"four.ts"}'),
    ];

    const nodes = groupActivityReads(buildActivityNodes(buildLogTree(records).nodes, true));

    expect(nodes.map((node) => node.kind)).toEqual([
      'read-group',
      'session',
      'read-group',
      'output',
      'action',
      'read-group',
      'marker',
      'read-group',
    ]);
    expect(nodes[0]).toMatchObject({kind: 'read-group', totalCount: 2});
    expect(nodes[2]).toMatchObject({kind: 'read-group', totalCount: 2});
    expect(nodes[5]).toMatchObject({kind: 'read-group', totalCount: 1});
  });

  test('keeps failed, running, and unclassified actions outside read groups', () => {
    const records: LogRecord[] = [
      ...recordedAction('first', 'Read', '{"file_path":"one.ts"}'),
      ...recordedAction('failed', 'Read', '{"file_path":"two.ts"}', 'failure', true),
      ...recordedAction('running', 'Read', '{"file_path":"three.ts"}', null),
      ...recordedAction('unknown', 'future_tool', '{}'),
      ...recordedAction('last', 'Read', '{"file_path":"four.ts"}'),
    ];

    const nodes = groupActivityReads(buildActivityNodes(buildLogTree(records).nodes));

    expect(nodes.map((node) => node.kind)).toEqual([
      'read-group',
      'action',
      'action',
      'action',
      'read-group',
    ]);
    expect(nodes[2]).toMatchObject({kind: 'action', action: {state: 'running'}});
  });

  test('requires the same exact integration tool and connection', () => {
    const records: LogRecord[] = [
      ...recordedAction('one', 'tickets__get_issue', '{"connection":"main"}'),
      ...recordedAction('two', 'tickets__get_issue', '{"connection":"main"}'),
      ...recordedAction('three', 'tickets__get_issue', '{"connection":"other"}'),
      ...recordedAction('four', 'tickets__list_issues', '{"connection":"other"}'),
    ];
    const nodes = groupActivityReads(buildActivityNodes(buildLogTree(records).nodes), (action) => ({
      label: 'Get issue',
      target: null,
      iconKind: 'integration',
      detailKind: 'structured',
      readClassification: 'read',
      integration: {
        provider: 'linear',
        connectionId: action.request?.input.includes('other') ? 'other' : 'main',
        connectionSlug: 'tickets',
        toolId: 'get_issue',
        methodId: null,
      },
    }));

    expect(nodes.map((node) => (node.kind === 'read-group' ? node.totalCount : 0))).toEqual([
      2, 1, 1,
    ]);
  });

  test('search exposes a result match inside its original group', () => {
    const records = [
      ...recordedAction('one', 'Read', '{"file_path":"one.ts"}', 'ordinary'),
      ...recordedAction('two', 'Read', '{"file_path":"two.ts"}', 'needle'),
    ];
    const tree = buildLogTree(records);
    const groups = groupActivityReads(buildActivityNodes(tree.nodes));

    const filtered = filterActivityNodes(groups, 'needle', buildLogSearchIndex(tree.nodes));

    expect(filtered).toMatchObject([
      {
        kind: 'read-group',
        totalCount: 2,
        children: [{kind: 'action', action: {request: {input: '{"file_path":"two.ts"}'}}}],
      },
    ]);
  });
});
