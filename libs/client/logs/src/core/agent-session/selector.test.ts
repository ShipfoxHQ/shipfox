import type {LogRecord} from '@shipfox/api-logs-dto';
import {expandSessionRecord} from './selector.js';

const record = (data: unknown, ts = 1): Extract<LogRecord, {type: 'agent_session'}> => ({
  v: 1,
  ts,
  type: 'agent_session',
  data: typeof data === 'string' ? data : JSON.stringify(data),
});

describe('expandSessionRecord', () => {
  test('returns a fallback row for malformed JSON', () => {
    const rows = expandSessionRecord(record('{not json'));

    expect(rows).toEqual([
      {kind: 'fallback', timestamp: 1, label: 'Malformed session entry', raw: '{not json'},
    ]);
  });

  test('returns a fallback row for an unknown entry type', () => {
    const rows = expandSessionRecord(record({type: 'future_entry', payload: {x: 1}}));

    expect(rows).toEqual([
      {
        kind: 'fallback',
        timestamp: 1,
        label: 'Unknown session entry: future_entry',
        raw: '{"type":"future_entry","payload":{"x":1}}',
      },
    ]);
  });

  test('expands assistant text, thinking, and tool calls into ordered rows', () => {
    const rows = expandSessionRecord(
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
        label: 'assistant · claude-opus-4',
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

  test.each([
    ['success', false],
    ['error', true],
  ])('expands a tool result with %s state', (_label, isError) => {
    const rows = expandSessionRecord(
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
    [{type: 'session', id: 'session-1'}, 'Session started', 'session-1'],
    [{type: 'thinking_level_change', thinkingLevel: 'high'}, 'Thinking level changed', 'high'],
    [{type: 'model_change', model: 'gpt-5-codex'}, 'Model changed', 'gpt-5-codex'],
    [
      {type: 'compaction', summary: 'summarized old context'},
      'Context compacted',
      'summarized old context',
    ],
    [{type: 'label', label: 'Implement tests'}, 'Label', 'Implement tests'],
  ])('expands lifecycle entry %#', (entry, label, detail) => {
    const rows = expandSessionRecord(record(entry));

    expect(rows).toEqual([
      {kind: 'lifecycle', timestamp: 1, label, detail, tone: 'default', terminalFailure: false},
    ]);
  });

  test('marks assistant terminal errors as failure anchors', () => {
    const rows = expandSessionRecord(
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

  test('memoizes rows per record object', () => {
    const agentRecord = record({type: 'session', id: 'session-1'});
    const parseSpy = vi.spyOn(JSON, 'parse');

    const first = expandSessionRecord(agentRecord);
    const second = expandSessionRecord(agentRecord);

    expect(first).toBe(second);
    expect(parseSpy).toHaveBeenCalledTimes(1);
  });

  test('expands a tool result with no id', () => {
    const rows = expandSessionRecord(
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
    const rows = expandSessionRecord(
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
    const rows = expandSessionRecord(
      record({type: 'message', message: {role: 'assistant', content: [{type: 'image'}]}}),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({kind: 'message', role: 'assistant'});
  });

  test('renders a branch summary as a system message row', () => {
    const rows = expandSessionRecord(record({type: 'branch_summary', summary: 'merged main'}));

    expect(rows).toEqual([
      {
        kind: 'message',
        timestamp: 1,
        role: 'system',
        label: 'branch summary',
        text: 'merged main',
        terminalFailure: false,
      },
    ]);
  });

  test('renders a custom entry as a message row', () => {
    const rows = expandSessionRecord(record({type: 'custom', message: 'hello there'}));

    expect(rows).toEqual([
      {
        kind: 'message',
        timestamp: 1,
        role: 'custom',
        label: 'custom',
        text: 'hello there',
        terminalFailure: false,
      },
    ]);
  });

  test('renders a session_info entry as a lifecycle row', () => {
    const rows = expandSessionRecord(record({type: 'session_info', message: 'resumed'}));

    expect(rows).toEqual([
      {
        kind: 'lifecycle',
        timestamp: 1,
        label: 'Session info',
        detail: 'resumed',
        tone: 'default',
        terminalFailure: false,
      },
    ]);
  });

  test('returns an unsupported fallback when the entry has no type', () => {
    const rows = expandSessionRecord(record({payload: {x: 1}}));

    expect(rows).toEqual([
      {kind: 'fallback', timestamp: 1, label: 'Unsupported entry', raw: '{"payload":{"x":1}}'},
    ]);
  });
});
