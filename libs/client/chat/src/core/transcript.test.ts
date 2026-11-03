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

const STARTED_RUN_ID = '44444444-4444-4444-8444-444444444444';

function startResult(toolCallId: string, result: Record<string, unknown>, isError = false) {
  return {
    kind: 'tool-result' as const,
    timestamp: 4,
    toolCallId,
    toolName: 'start_workflow_run',
    output: `<untrusted_data source="start_workflow_run">\n${JSON.stringify(result)}\n</untrusted_data>`,
    isError,
  };
}

describe('buildTranscript', () => {
  test('shows a started run on its own row, apart from the reads around it', () => {
    const entries = buildTranscript({
      items: [
        userItem(1, 'Deploy it'),
        rowsItem({
          seq: 2,
          turnId: TURN_ID,
          rows: [
            toolCall('read-1', 'list_workflow_runs'),
            toolResult('read-1', 'list_workflow_runs'),
            toolCall('start-1', 'start_workflow_run', '{"workflow":"deploy.yml"}'),
            startResult('start-1', {run_id: STARTED_RUN_ID, run_number: 12, name: 'Deploy'}),
            toolCall('read-2', 'list_workflow_runs'),
            toolResult('read-2', 'list_workflow_runs'),
          ],
        }),
      ],
      queued: [],
      partialText: '',
      runningTurnId: undefined,
    });

    expect(kinds(entries)).toEqual(['user', 'tools', 'run-started', 'tools']);
    expect(entries[2]).toMatchObject({
      kind: 'run-started',
      run: {runId: STARTED_RUN_ID, number: 12, name: 'Deploy'},
    });
  });

  test('keeps a refused start as an ordinary failed tool row', () => {
    const entries = buildTranscript({
      items: [
        rowsItem({
          seq: 1,
          turnId: TURN_ID,
          rows: [
            toolCall('start-1', 'start_workflow_run'),
            startResult('start-1', {code: 'run-budget-exhausted'}, true),
          ],
        }),
      ],
      queued: [],
      partialText: '',
      runningTurnId: undefined,
    });

    expect(kinds(entries)).toEqual(['tools']);
    expect(toolStates(entries[0])).toEqual(['failed']);
  });

  test('does not trust a result that is not a run', () => {
    const entries = buildTranscript({
      items: [
        rowsItem({
          seq: 1,
          turnId: TURN_ID,
          rows: [
            toolCall('start-1', 'start_workflow_run'),
            startResult('start-1', {run_id: 'not-a-uuid', run_number: 1, name: 'x'}),
          ],
        }),
      ],
      queued: [],
      partialText: '',
      runningTurnId: undefined,
    });

    expect(kinds(entries)).toEqual(['tools']);
  });

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
