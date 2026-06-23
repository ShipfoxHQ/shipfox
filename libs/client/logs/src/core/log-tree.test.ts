import type {LogRecord} from '@shipfox/api-logs-dto';
import {buildLogTree, type GroupLogNode, type LogNode, stripTrailingNewline} from './log-tree.js';

const out = (data: string, stream: 'stdout' | 'stderr' = 'stdout', ts = 0): LogRecord => ({
  v: 1,
  ts,
  type: 'output',
  stream,
  data,
});
const gstart = (
  groupId: string,
  name: string,
  parentGroupId: string | null = null,
  ts = 0,
): LogRecord => ({
  v: 1,
  ts,
  type: 'group_start',
  group_id: groupId,
  parent_group_id: parentGroupId,
  name,
});
const gend = (groupId: string, ts = 0): LogRecord => ({
  v: 1,
  ts,
  type: 'group_end',
  group_id: groupId,
});
const end = (totalBytes = 0, ts = 0): LogRecord => ({
  v: 1,
  ts,
  type: 'end',
  total_bytes: totalBytes,
});
const gap = (droppedBytes = 0, ts = 0): LogRecord => ({
  v: 1,
  ts,
  type: 'gap',
  dropped_bytes: droppedBytes,
});
const capped = (ts = 0): LogRecord => ({v: 1, ts, type: 'capped'});
const runnerLost = (ts = 0): LogRecord => ({v: 1, ts, type: 'runner_lost'});
const agentSession = (data = 'entry', ts = 0): LogRecord => ({
  v: 1,
  ts,
  type: 'agent_session',
  data,
});

const asGroup = (node: LogNode | undefined): GroupLogNode => {
  if (node?.kind !== 'group') throw new Error(`expected a group node, got ${node?.kind}`);
  return node;
};

describe('buildLogTree', () => {
  test('numbers flat output lines and counts them', () => {
    const records = [out('a'), out('b'), out('c')];

    const tree = buildLogTree(records);

    expect(tree.nodes.map((n) => (n.kind === 'output' ? n.lineNumber : null))).toEqual([1, 2, 3]);
    expect(tree.lineCount).toBe(3);
    expect(tree.terminated).toBe(false);
  });

  test('reads originTs from the first record and null when empty', () => {
    const withRecords = buildLogTree([out('a', 'stdout', 42)]);
    const empty = buildLogTree([]);

    expect(withRecords.originTs).toBe(42);
    expect(empty.originTs).toBeNull();
    expect(empty.nodes).toEqual([]);
    expect(empty.lineCount).toBe(0);
  });

  test('anchors originTs on the first render-relevant record, skipping a leading agent_session', () => {
    const tree = buildLogTree([agentSession('entry', 5), out('a', 'stdout', 9)]);

    expect(tree.originTs).toBe(9);
  });

  test('nests output inside a closed group', () => {
    const records = [gstart('g1', 'Build'), out('compiling'), gend('g1', 9)];

    const tree = buildLogTree(records);
    const group = asGroup(tree.nodes[0]);

    expect(tree.nodes).toHaveLength(1);
    expect(group.record.name).toBe('Build');
    expect(group.closed).toBe(true);
    expect(group.endTs).toBe(9);
    expect(group.children).toHaveLength(1);
  });

  test('builds a multi-level group tree', () => {
    const records = [
      gstart('g1', 'Build'),
      gstart('g2', 'Compile', 'g1'),
      out('cc'),
      gend('g2'),
      gend('g1'),
    ];

    const tree = buildLogTree(records);
    const g1 = asGroup(tree.nodes[0]);
    const g2 = asGroup(g1.children[0]);

    expect(g1.record.group_id).toBe('g1');
    expect(g2.record.group_id).toBe('g2');
    expect(g2.children[0]?.kind).toBe('output');
  });

  test('precomputes the subtree output-line count per group', () => {
    const records = [
      gstart('g1', 'Build'),
      out('a'),
      gstart('g2', 'Compile', 'g1'),
      out('b'),
      out('c'),
      gend('g2'),
      gend('g1'),
    ];

    const g1 = asGroup(buildLogTree(records).nodes[0]);
    const g2 = asGroup(g1.children[1]);

    expect(g1.lineCount).toBe(3);
    expect(g2.lineCount).toBe(2);
  });

  test('leaves a group open when its end never arrives', () => {
    const records = [gstart('g1', 'Build'), out('still going')];

    const tree = buildLogTree(records);
    const group = asGroup(tree.nodes[0]);

    expect(group.closed).toBe(false);
    expect(group.endTs).toBeNull();
  });

  test('ignores an unbalanced group_end with no open group', () => {
    const records = [out('a'), gend('ghost'), out('b')];

    const tree = buildLogTree(records);

    expect(tree.nodes.map((n) => n.kind)).toEqual(['output', 'output']);
  });

  test('closes the matching group_id when a group_start was dropped (C1)', () => {
    const records = [gstart('g1', 'Build'), out('inside g1'), gend('g2'), gend('g1', 5)];

    const tree = buildLogTree(records);
    const g1 = asGroup(tree.nodes[0]);

    expect(tree.nodes).toHaveLength(1);
    expect(g1.closed).toBe(true);
    expect(g1.endTs).toBe(5);
    expect(g1.children.map((n) => n.kind)).toEqual(['output']);
  });

  test('orphaned inner groups close with their matched ancestor', () => {
    const records = [gstart('g1', 'Build'), gstart('g2', 'Compile', 'g1'), out('x'), gend('g1', 7)];

    const tree = buildLogTree(records);
    const g1 = asGroup(tree.nodes[0]);
    const g2 = asGroup(g1.children[0]);

    expect(g1.closed).toBe(true);
    expect(g1.endTs).toBe(7);
    expect(g2.closed).toBe(true);
    expect(g2.endTs).toBeNull();
  });

  test('a dropped root group_end does not nest or taint the next root group', () => {
    // g1's group_end is dropped under backlog pressure (a gap stands in for it); g2 declares
    // parent_group_id null, so it lands at root, not inside still-open g1. g1 is orphan-closed
    // when g2 opens, so a runner_lost inside g2 must not bubble into the already-closed g1.
    const records = [
      gstart('g1', 'first'),
      out('a'),
      gap(64),
      gstart('g2', 'second'),
      runnerLost(),
      gend('g2'),
    ];

    const tree = buildLogTree(records);
    const g1 = asGroup(tree.nodes[0]);
    const g2 = asGroup(tree.nodes[1]);

    expect(tree.nodes).toHaveLength(2);
    expect(g1.closed).toBe(true);
    expect(g1.endTs).toBeNull();
    expect(g1.lineCount).toBe(1);
    expect(g1.hasError).toBe(false);
    expect(g2.hasError).toBe(true);
  });

  test('a dropped inner group_end reparents the next sibling via parent_group_id', () => {
    // g2's group_end is dropped; g3 declares parent g1, so it is a sibling of g2 under g1,
    // not nested inside the still-open g2.
    const records = [
      gstart('g1', 'outer'),
      gstart('g2', 'inner-a', 'g1'),
      out('x'),
      gstart('g3', 'inner-b', 'g1'),
      out('y'),
      gend('g3'),
      gend('g1', 9),
    ];

    const tree = buildLogTree(records);
    const g1 = asGroup(tree.nodes[0]);

    expect(g1.children.map((n) => n.kind)).toEqual(['group', 'group']);
    const g2 = asGroup(g1.children[0]);
    const g3 = asGroup(g1.children[1]);
    expect(g2.record.group_id).toBe('g2');
    expect(g2.closed).toBe(true);
    expect(g2.endTs).toBeNull();
    expect(g3.record.group_id).toBe('g3');
    expect(g3.closed).toBe(true);
  });

  test('places markers at the current nesting level', () => {
    const records = [gstart('g1', 'Build'), gap(128), gend('g1'), end(2048)];

    const tree = buildLogTree(records);
    const g1 = asGroup(tree.nodes[0]);

    expect(g1.children[0]?.kind).toBe('marker');
    expect(tree.nodes[1]?.kind).toBe('marker');
  });

  test('assigns a unique seq across siblings that reuse a group_id or marker ts', () => {
    // A concatenated multi-step/retry stream reuses g1 and can repeat a marker (type, ts);
    // seq stays unique so the React keys in LogView never collide.
    const records = [
      gstart('g1', 'first'),
      gend('g1'),
      gstart('g1', 'second'),
      gend('g1'),
      gap(1, 5),
      gap(2, 5),
    ];

    const seqs = buildLogTree(records).nodes.map((n) => n.seq);

    expect(seqs).toEqual([0, 1, 2, 3]);
  });

  test('skips agent_session without consuming a line number', () => {
    const records = [out('a'), agentSession('{"role":"assistant"}'), out('b')];

    const tree = buildLogTree(records);

    expect(tree.nodes).toHaveLength(2);
    expect(tree.nodes.map((n) => (n.kind === 'output' ? n.lineNumber : null))).toEqual([1, 2]);
  });

  test.each([
    ['end', [end()], true],
    ['runner_lost', [runnerLost()], true],
    ['capped', [capped()], false],
    ['none', [out('a')], false],
  ])('terminated is %s-driven', (_label, records, expected) => {
    const tree = buildLogTree(records as LogRecord[]);

    expect(tree.terminated).toBe(expected);
  });

  describe('hasError annotation', () => {
    test('a runner_lost marker in a group sets hasError', () => {
      const records = [gstart('g1', 'Run'), runnerLost(), gend('g1')];

      const group = asGroup(buildLogTree(records).nodes[0]);

      expect(group.hasError).toBe(true);
    });

    test('stderr does NOT set hasError (a channel, not a failure)', () => {
      const records = [gstart('g1', 'Run'), out('boom', 'stderr'), gend('g1')];

      const group = asGroup(buildLogTree(records).nodes[0]);

      expect(group.hasError).toBe(false);
    });

    test('gap and capped are warnings, not errors', () => {
      const records = [gstart('g1', 'Run'), gap(64), capped(), gend('g1')];

      const group = asGroup(buildLogTree(records).nodes[0]);

      expect(group.hasError).toBe(false);
    });

    test('a runner_lost bubbles up through nested ancestors', () => {
      const records = [
        gstart('g1', 'Build'),
        gstart('g2', 'Compile', 'g1'),
        runnerLost(),
        gend('g2'),
        gend('g1'),
      ];

      const g1 = asGroup(buildLogTree(records).nodes[0]);
      const g2 = asGroup(g1.children[0]);

      expect(g1.hasError).toBe(true);
      expect(g2.hasError).toBe(true);
    });

    test('a closed sibling is not marked by a later runner_lost', () => {
      const records = [
        gstart('g1', 'first'),
        out('ok'),
        gend('g1'),
        gstart('g2', 'second'),
        runnerLost(),
        gend('g2'),
      ];

      const tree = buildLogTree(records);
      const g1 = asGroup(tree.nodes[0]);
      const g2 = asGroup(tree.nodes[1]);

      expect(g1.hasError).toBe(false);
      expect(g2.hasError).toBe(true);
    });
  });
});

describe('stripTrailingNewline', () => {
  test('removes a single trailing newline', () => {
    expect(stripTrailingNewline('line\n')).toBe('line');
  });

  test('leaves a line without a trailing newline untouched', () => {
    expect(stripTrailingNewline('line')).toBe('line');
  });

  test('removes only one of several trailing newlines', () => {
    expect(stripTrailingNewline('line\n\n')).toBe('line\n');
  });

  test('strips a trailing CRLF, leaving no carriage return', () => {
    expect(stripTrailingNewline('line\r\n')).toBe('line');
  });
});
