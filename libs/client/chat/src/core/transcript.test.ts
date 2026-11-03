import {
  agentRow,
  itemId,
  noticeItem,
  OLD_TURN_ID,
  rowsItem,
  TURN_ID,
  toolCall,
  toolResult,
  userItem,
} from '#test/fixtures/conversation-items.js';
import {buildTranscript, type TranscriptEntry} from './transcript.js';

function kinds(entries: TranscriptEntry[]) {
  return entries.map((entry) => entry.kind);
}

function toolStates(entry: TranscriptEntry | undefined) {
  if (entry?.kind !== 'tools') throw new Error('Expected tool rows');
  return entry.nodes.flatMap((node) =>
    node.kind === 'action' ? [node.action.state] : node.children.map((child) => child.action.state),
  );
}

describe('buildTranscript', () => {
  test('pairs a tool call with its result across items, between the bubbles', () => {
    const entries = buildTranscript({
      items: [
        userItem(1, 'Why did this fail?'),
        rowsItem({seq: 2, turnId: TURN_ID, rows: [toolCall('call-1', 'list_workflow_runs')]}),
        rowsItem({seq: 3, turnId: TURN_ID, rows: [toolResult('call-1', 'list_workflow_runs')]}),
        rowsItem({seq: 4, turnId: TURN_ID, rows: [agentRow('The tests timed out.')]}),
      ],
      queued: [],
      partialText: '',
      runningTurnId: undefined,
    });

    expect(kinds(entries)).toEqual(['user', 'tools', 'agent']);
    expect(toolStates(entries[1])).toEqual(['succeeded']);
  });

  test('reads a call with no result as running only in the running turn', () => {
    const items = [
      rowsItem({seq: 1, turnId: OLD_TURN_ID, rows: [toolCall('old', 'get_workflow_run')]}),
      rowsItem({seq: 2, turnId: TURN_ID, rows: [agentRow('Reading again.')]}),
      rowsItem({seq: 3, turnId: TURN_ID, rows: [toolCall('new', 'get_step_logs')]}),
    ];

    const entries = buildTranscript({items, queued: [], partialText: '', runningTurnId: TURN_ID});

    expect(toolStates(entries[0])).toEqual(['no-result']);
    expect(toolStates(entries[2])).toEqual(['running']);
  });

  test('marks a stopped reply and drops the abort placeholder text', () => {
    const entries = buildTranscript({
      items: [
        rowsItem({seq: 1, turnId: TURN_ID, rows: [agentRow('The run fail', 'aborted')]}),
        rowsItem({
          seq: 2,
          turnId: OLD_TURN_ID,
          rows: [agentRow('Assistant run was aborted.', 'aborted')],
        }),
      ],
      queued: [],
      partialText: '',
      runningTurnId: undefined,
    });

    expect(entries).toMatchObject([
      {kind: 'agent', text: 'The run fail', stopped: true},
      {kind: 'agent', text: '', stopped: true},
    ]);
  });

  test('hides thinking, lifecycle, and raw rows', () => {
    const entries = buildTranscript({
      items: [
        rowsItem({
          seq: 1,
          turnId: TURN_ID,
          rows: [
            {kind: 'thinking', timestamp: 1, text: 'hmm'},
            {
              kind: 'lifecycle',
              timestamp: 1,
              label: 'Context compacted',
              detail: null,
              meta: [],
              tone: 'default',
              terminalFailure: false,
            },
            {kind: 'raw', timestamp: 1, label: 'Unsupported entry', raw: '{}'},
            agentRow('Done.'),
          ],
        }),
      ],
      queued: [],
      partialText: '',
      runningTurnId: undefined,
    });

    expect(kinds(entries)).toEqual(['agent']);
  });

  test('keeps a notice in timeline order', () => {
    const notice = {code: 'admission-denied', message: 'Out of credits', requiredAction: null};
    const entries = buildTranscript({
      items: [userItem(1, 'First'), noticeItem(2, notice), userItem(3, 'Second')],
      queued: [],
      partialText: '',
      runningTurnId: undefined,
    });

    expect(entries.map((entry) => entry.key)).toEqual([itemId(1), itemId(2), itemId(3)]);
    expect(entries[1]).toMatchObject({kind: 'notice', notice});
  });

  test('puts streamed text after the stored items and queued messages last', () => {
    const entries = buildTranscript({
      items: [userItem(1, 'Why?')],
      queued: [userItem(null, 'And the lint job?', 'queued-1')],
      partialText: 'Because',
      runningTurnId: TURN_ID,
    });

    expect(entries).toMatchObject([
      {kind: 'user', text: 'Why?', queued: false},
      {kind: 'agent', text: 'Because', streaming: true},
      {kind: 'user', text: 'And the lint job?', queued: true},
    ]);
  });
});
