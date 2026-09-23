import {pairSessionRows} from './activity.js';
import type {SessionViewRow} from './log-model.js';
import {nativeActionPresentation} from './native-tools.js';

function action(name: string, input: unknown, output = 'recorded result', isError = false) {
  const rows: {seq: number; lineNumber: number; row: SessionViewRow}[] = [
    {
      seq: 1,
      lineNumber: 1,
      row: {kind: 'tool-call', timestamp: 10, id: 'call', name, input: JSON.stringify(input)},
    },
    {
      seq: 2,
      lineNumber: 2,
      row: {
        kind: 'tool-result',
        timestamp: 20,
        toolCallId: 'call',
        toolName: 'tool',
        output,
        isError,
      },
    },
  ];
  const [item] = pairSessionRows(rows);
  if (item?.kind !== 'action') throw new Error('expected paired action');
  return item.action;
}

describe('nativeActionPresentation', () => {
  test.each([
    ['read', {path: 'src/a.ts', offset: 5, limit: 3}, 'Read File', 'src/a.ts (lines 5–7)', 'read'],
    ['Read', {file_path: 'src/a.ts'}, 'Read File', 'src/a.ts', 'read'],
    [
      'edit',
      {path: 'src/a.ts', oldText: 'before', newText: 'after'},
      'Edit File',
      'src/a.ts',
      'write',
    ],
    [
      'Edit',
      {file_path: 'src/a.ts', old_string: 'before', new_string: 'after'},
      'Edit File',
      'src/a.ts',
      'write',
    ],
    ['write', {path: 'src/new.ts', content: 'hello'}, 'Write File', 'src/new.ts', 'write'],
    ['Write', {file_path: 'src/new.ts', content: 'hello'}, 'Write File', 'src/new.ts', 'write'],
    ['bash', {command: 'pnpm test'}, 'Run Command', 'pnpm test', 'unknown'],
    ['Bash', {command: 'pnpm test'}, 'Run Command', 'pnpm test', 'unknown'],
    ['grep', {pattern: 'TODO'}, 'Search Files', 'TODO', 'read'],
    ['Grep', {pattern: 'TODO'}, 'Search Files', 'TODO', 'read'],
    ['find', {pattern: '*.ts'}, 'Search Files', '*.ts', 'read'],
    ['Glob', {pattern: '*.ts'}, 'Search Files', '*.ts', 'read'],
    ['ls', {path: 'src'}, 'List Files', 'src', 'read'],
    ['LS', {path: 'src'}, 'List Files', 'src', 'read'],
    ['LS', {directory: 'src'}, 'List Files', 'src', 'read'],
    ['web_search', {query: 'shipfox runners'}, 'Search Web', 'shipfox runners', 'read'],
    ['web_search', {queries: ['first', 'second']}, 'Search Web', 'first', 'read'],
    ['WebSearch', {query: 'shipfox runners'}, 'Search Web', 'shipfox runners', 'read'],
    ['fetch_content', {url: 'https://shipfox.io'}, 'Fetch Page', 'https://shipfox.io', 'read'],
    [
      'fetch_content',
      {urls: ['https://a.io', 'https://b.io']},
      'Fetch Page',
      'https://a.io',
      'read',
    ],
    [
      'WebFetch',
      {url: 'https://shipfox.io', prompt: 'x'},
      'Fetch Page',
      'https://shipfox.io',
      'read',
    ],
    ['get_search_content', {responseId: 'r1', query: 'shipfox'}, 'Fetch Page', 'shipfox', 'read'],
    ['get_search_content', {responseId: 'r1'}, 'Fetch Page', 'r1', 'read'],
  ] as const)('%s uses the recorded target and effect', (name, input, label, target, effect) => {
    expect(nativeActionPresentation(action(name, input))).toMatchObject({
      label,
      target,
      readClassification: effect,
    });
  });

  test('falls back when the input is malformed, lacks its target, or uses an unsupported name', () => {
    expect(nativeActionPresentation(action('Read', {}, 'data'))).toBeUndefined();
    expect(nativeActionPresentation(action('read', {}, 'data'))).toBeUndefined();
    expect(nativeActionPresentation(action('Edit', {directory: 'src'}, 'data'))).toBeUndefined();
    expect(nativeActionPresentation(action('Bash', {command: ''}, 'data'))).toBeUndefined();
    expect(
      nativeActionPresentation(action('custom_read', {path: 'src/a.ts'}, 'data')),
    ).toBeUndefined();
    const malformed = action('Read', {file_path: 'src/a.ts'});
    if (!malformed.request) throw new Error('expected request');
    malformed.request.input = '{invalid';
    expect(nativeActionPresentation(malformed)).toBeUndefined();
  });

  test('shows recorded shell output and explicit exit status, including failure', () => {
    const failed = action('Bash', {command: 'pnpm test'}, 'Exit code: 2\nOutput:\nfailed');
    expect(failed.state).toBe('failed');
    expect(nativeActionPresentation(failed)).toMatchObject({
      statusDetail: 'exit 2',
      detail: {label: 'Output', value: 'failed'},
    });
    const pi = action('bash', {command: 'pnpm test'}, '{"stdout":"ok","exitCode":0}');
    expect(pi.state).toBe('succeeded');
    expect(nativeActionPresentation(pi)).toMatchObject({
      statusDetail: 'exit 0',
      detail: {value: 'ok'},
    });
    const piFailure = action('bash', {command: 'pnpm test'}, '{"stderr":"failed","exitCode":1}');
    expect(piFailure.state).toBe('failed');
    expect(nativeActionPresentation(piFailure)).toMatchObject({
      statusDetail: 'exit 1',
      detail: {value: 'failed'},
    });
    expect(
      nativeActionPresentation(
        action('bash', {command: 'cat file'}, '{"stdout":"  indented\\n","exitCode":0}'),
      ),
    ).toMatchObject({detail: {value: '  indented\n'}});
    expect(
      nativeActionPresentation(action('Bash', {command: 'pnpm test'}, 'plain output'))
        ?.statusDetail,
    ).toBeUndefined();
  });

  test('uses only recorded counts and keeps edit source out of the useful detail', () => {
    expect(
      nativeActionPresentation(action('Grep', {pattern: 'error'}, '{"matches":[1,2]}'))
        ?.statusDetail,
    ).toBe('2 matches');
    expect(
      nativeActionPresentation(action('LS', {path: 'src'}, '{"files":["a.ts"]}'))?.statusDetail,
    ).toBe('1 file');
    expect(
      nativeActionPresentation(action('Grep', {pattern: 'error'}, 'two lines'))?.statusDetail,
    ).toBeUndefined();
    expect(
      nativeActionPresentation(
        action('Edit', {file_path: 'src/a.ts', old_string: 'secret source'}, 'replaced'),
      )?.detail,
    ).toEqual({
      label: 'File',
      value: 'src/a.ts',
      kind: 'code',
    });
  });
});
