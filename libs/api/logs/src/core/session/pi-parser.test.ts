import {parsePiSessionRecord} from './pi-parser.js';

const record = (data: unknown, ts = 1) => ({
  ts,
  data: typeof data === 'string' ? data : JSON.stringify(data),
});
const meta = (label: string, value: string, inline?: boolean) =>
  inline == null ? {label, value} : {label, value, inline};

describe('parsePiSessionRecord', () => {
  test('returns a raw row for malformed JSON', () => {
    const rows = parsePiSessionRecord(record('{not json'));

    expect(rows).toEqual([
      {kind: 'raw', timestamp: 1, label: 'Malformed session entry', raw: '{not json'},
    ]);
  });

  test('returns a raw row for an unknown entry type', () => {
    const rows = parsePiSessionRecord(record({type: 'future_entry', payload: {x: 1}}));

    expect(rows).toEqual([
      {
        kind: 'raw',
        timestamp: 1,
        label: 'Unknown session entry: future_entry',
        raw: '{"type":"future_entry","payload":{"x":1}}',
      },
    ]);
  });

  test('expands assistant text, thinking, and tool calls into ordered rows', () => {
    const rows = parsePiSessionRecord(
      record({
        type: 'message',
        message: {
          role: 'assistant',
          model: 'claude-opus-4',
          content: [
            {type: 'text', text: 'I will edit the file.'},
            {type: 'thinking', text: 'Need to inspect the module.'},
            {type: 'toolCall', id: 'call-1', name: 'read_file', arguments: {path: 'src/a.ts'}},
          ],
        },
      }),
    );

    expect(rows).toEqual([
      {
        kind: 'message',
        timestamp: 1,
        role: 'assistant',
        label: 'assistant',
        meta: [meta('model', 'claude-opus-4')],
        text: 'I will edit the file.',
        terminalFailure: false,
      },
      {kind: 'thinking', timestamp: 1, text: 'Need to inspect the module.'},
      {
        kind: 'tool-call',
        timestamp: 1,
        id: 'call-1',
        name: 'read_file',
        input: '{\n  "path": "src/a.ts"\n}',
      },
    ]);
  });

  test('preserves interleaved assistant text and thinking block order', () => {
    const rows = parsePiSessionRecord(
      record({
        type: 'message',
        message: {
          role: 'assistant',
          content: [
            {type: 'text', text: 'First visible update.'},
            {type: 'thinking', text: 'First private thought.'},
            {type: 'text', text: 'Second visible update.'},
            {type: 'toolCall', id: 'call-1', name: 'read_file', arguments: {path: 'src/a.ts'}},
            {type: 'thinking', text: 'Thought after tool call.'},
            {type: 'text', text: 'Final visible update.'},
          ],
        },
      }),
    );

    expect(rows).toEqual([
      {
        kind: 'message',
        timestamp: 1,
        role: 'assistant',
        label: 'assistant',
        meta: [],
        text: 'First visible update.',
        terminalFailure: false,
      },
      {kind: 'thinking', timestamp: 1, text: 'First private thought.'},
      {
        kind: 'message',
        timestamp: 1,
        role: 'assistant',
        label: 'assistant',
        meta: [],
        text: 'Second visible update.',
        terminalFailure: false,
      },
      {
        kind: 'tool-call',
        timestamp: 1,
        id: 'call-1',
        name: 'read_file',
        input: '{\n  "path": "src/a.ts"\n}',
      },
      {kind: 'thinking', timestamp: 1, text: 'Thought after tool call.'},
      {
        kind: 'message',
        timestamp: 1,
        role: 'assistant',
        label: 'assistant',
        meta: [],
        text: 'Final visible update.',
        terminalFailure: false,
      },
    ]);
  });

  test.each([
    ['success', false],
    ['error', true],
  ])('expands a tool result with %s state', (_label, isError) => {
    const rows = parsePiSessionRecord(
      record({
        type: 'message',
        message: {
          toolCallId: 'call-1',
          toolName: 'read_file',
          content: [{type: 'text', text: 'file contents'}],
          isError,
        },
      }),
    );

    expect(rows).toEqual([
      {
        kind: 'tool-result',
        timestamp: 1,
        toolCallId: 'call-1',
        toolName: 'read_file',
        output: 'file contents',
        isError,
      },
    ]);
  });

  test.each([
    [{type: 'session', id: 'session-1'}, 'Session started', 'session-1', []],
    [
      {type: 'session', version: 2, id: 'session-1', cwd: '/workspace'},
      'Session started',
      'v2 · session-1 · /workspace',
      [],
    ],
    [{type: 'thinking_level_change', thinkingLevel: 'high'}, 'Thinking level changed', 'high', []],
    [
      {type: 'model_change', modelId: 'gpt-5-codex', provider: 'openai'},
      'Model changed',
      'gpt-5-codex · openai',
      [],
    ],
    [
      {type: 'compaction', summary: 'summarized old context', tokensBefore: 12_345},
      'Context compacted',
      'summarized old context',
      [meta('tokens before', '12.3K tokens')],
    ],
    [
      {type: 'label', label: 'Implement tests', targetId: 'entry-1'},
      'Label',
      'Implement tests',
      [meta('target', 'entry-1', false)],
    ],
  ])('expands lifecycle entry %#', (entry, label, detail, meta) => {
    const rows = parsePiSessionRecord(record(entry));

    expect(rows).toEqual([
      {
        kind: 'lifecycle',
        timestamp: 1,
        label,
        detail,
        meta,
        tone: 'default',
        terminalFailure: false,
      },
    ]);
  });

  test('renders message content blocks without exposing image data', () => {
    const rows = parsePiSessionRecord(
      record({
        type: 'message',
        message: {
          role: 'user',
          content: [
            {type: 'text', text: 'Inspect this screenshot.'},
            {type: 'image', mimeType: 'image/png', data: 'base64-payload'},
          ],
        },
      }),
    );

    expect(rows).toEqual([
      {
        kind: 'message',
        timestamp: 1,
        role: 'user',
        label: 'user',
        meta: [],
        text: 'Inspect this screenshot.\n\n[image/png image]',
        terminalFailure: false,
      },
    ]);
  });

  test('renders bash execution messages without falling back to raw JSON', () => {
    const rows = parsePiSessionRecord(
      record({
        type: 'message',
        message: {
          role: 'bashExecution',
          command: 'pnpm test',
          output: '1 failed',
          exitCode: 1,
          cancelled: false,
          truncated: true,
          fullOutputPath: '/tmp/output.log',
        },
      }),
    );

    expect(rows).toEqual([
      {
        kind: 'message',
        timestamp: 1,
        role: 'bash-execution',
        label: 'bash execution',
        meta: [
          meta('exit', '1'),
          meta('truncated', 'yes'),
          meta('full output', '/tmp/output.log', false),
        ],
        text: '$ pnpm test\n1 failed',
        terminalFailure: false,
      },
    ]);
  });

  test.each([
    [
      {role: 'branchSummary', summary: 'branched for fix', fromId: 'entry-1'},
      'branch-summary',
      'branch summary',
      [meta('from', 'entry-1')],
      'branched for fix',
    ],
    [
      {role: 'compactionSummary', summary: 'summarized history', tokensBefore: 42_000},
      'compaction-summary',
      'compaction summary',
      [meta('tokens before', '42K tokens')],
      'summarized history',
    ],
    [
      {role: 'custom', customType: 'extension', content: 'extension output', display: true},
      'custom',
      'custom',
      [meta('type', 'extension'), meta('display', 'on')],
      'extension output',
    ],
  ])('renders extended message role %#', (message, role, label, meta, text) => {
    const rows = parsePiSessionRecord(record({type: 'message', message}));

    expect(rows).toEqual([
      {kind: 'message', timestamp: 1, role, label, meta, text, terminalFailure: false},
    ]);
  });

  test('marks assistant terminal errors as failure anchors', () => {
    const rows = parsePiSessionRecord(
      record({
        type: 'message',
        message: {
          role: 'assistant',
          content: [{type: 'text', text: 'I cannot continue.'}],
          stopReason: 'error',
        },
      }),
    );

    expect(rows[0]).toMatchObject({kind: 'message', terminalFailure: true});
  });

  test('adds a failure anchor for thinking-only assistant terminal errors', () => {
    const rows = parsePiSessionRecord(
      record({
        type: 'message',
        message: {
          role: 'assistant',
          content: [{type: 'thinking', text: 'No visible response before failure.'}],
          stopReason: 'error',
        },
      }),
    );

    expect(rows).toEqual([
      {kind: 'thinking', timestamp: 1, text: 'No visible response before failure.'},
      {
        kind: 'message',
        timestamp: 1,
        role: 'assistant',
        label: 'assistant',
        meta: [meta('stop', 'error')],
        text: 'Assistant stopped with an error.',
        terminalFailure: true,
      },
    ]);
  });

  test('expands a tool result with no id', () => {
    const rows = parsePiSessionRecord(
      record({
        type: 'message',
        message: {role: 'tool', toolName: 'read_file', content: [{type: 'text', text: 'data'}]},
      }),
    );

    expect(rows).toEqual([
      {
        kind: 'tool-result',
        timestamp: 1,
        toolCallId: null,
        toolName: 'read_file',
        output: 'data',
        isError: false,
      },
    ]);
  });

  test('expands a tool call with no id', () => {
    const rows = parsePiSessionRecord(
      record({
        type: 'message',
        message: {
          role: 'assistant',
          content: [{type: 'tool_call', name: 'run', arguments: {cmd: 'ls'}}],
        },
      }),
    );

    expect(rows).toEqual([
      {kind: 'tool-call', timestamp: 1, id: null, name: 'run', input: '{\n  "cmd": "ls"\n}'},
    ]);
  });

  test('falls back to the raw message when assistant content has no renderable blocks', () => {
    const rows = parsePiSessionRecord(
      record({type: 'message', message: {role: 'assistant', content: [{type: 'image'}]}}),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({kind: 'message', role: 'assistant'});
  });

  test('renders a branch summary as a system message row', () => {
    const rows = parsePiSessionRecord(
      record({type: 'branch_summary', summary: 'merged main', fromId: 'entry-1'}),
    );

    expect(rows).toEqual([
      {
        kind: 'message',
        timestamp: 1,
        role: 'system',
        label: 'branch summary',
        meta: [meta('from', 'entry-1')],
        text: 'merged main',
        terminalFailure: false,
      },
    ]);
  });

  test('renders a custom entry as a message row', () => {
    const rows = parsePiSessionRecord(
      record({type: 'custom', customType: 'extension', data: {ok: true}}),
    );

    expect(rows).toEqual([
      {
        kind: 'message',
        timestamp: 1,
        role: 'custom',
        label: 'custom',
        meta: [meta('type', 'extension')],
        text: '{\n  "ok": true\n}',
        terminalFailure: false,
      },
    ]);
  });

  test('renders a custom message entry from content', () => {
    const rows = parsePiSessionRecord(
      record({type: 'custom_message', customType: 'extension', content: 'hello there'}),
    );

    expect(rows).toEqual([
      {
        kind: 'message',
        timestamp: 1,
        role: 'custom',
        label: 'custom message',
        meta: [meta('type', 'extension')],
        text: 'hello there',
        terminalFailure: false,
      },
    ]);
  });

  test('renders a session_info entry as a lifecycle row', () => {
    const rows = parsePiSessionRecord(record({type: 'session_info', message: 'resumed'}));

    expect(rows).toEqual([
      {
        kind: 'lifecycle',
        timestamp: 1,
        label: 'Session info',
        detail: 'resumed',
        meta: [],
        tone: 'default',
        terminalFailure: false,
      },
    ]);
  });

  test('returns an unsupported raw row when the entry has no type', () => {
    const rows = parsePiSessionRecord(record({payload: {x: 1}}));

    expect(rows).toEqual([
      {kind: 'raw', timestamp: 1, label: 'Unsupported entry', raw: '{"payload":{"x":1}}'},
    ]);
  });
});
