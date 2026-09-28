import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  type ActionTestWorkspace,
  runAction as runActionUnderTest,
  toolError,
  toolResult,
} from '#testing/index.js';
import {ActionTestSetupError} from '#testing/manifest.js';

const probe = new URL('../../test/fixtures/actions/probe/', import.meta.url);
const slackThread = new URL('../../test/fixtures/actions/slack-thread/', import.meta.url);

describe('runAction', () => {
  const workspaces: ActionTestWorkspace[] = [];
  const runAction: typeof runActionUnderTest = async (...args) => {
    const result = await runActionUnderTest(...args);
    workspaces.push(result.workspace);
    return result;
  };

  const actionDirs: string[] = [];
  const writeAction = async (files: Record<string, string>) => {
    const dir = await mkdtemp(join(tmpdir(), 'shipfox-action-dir-'));
    actionDirs.push(dir);
    await Promise.all(
      Object.entries(files).map(([name, content]) => writeFile(join(dir, name), content)),
    );
    return dir;
  };

  afterEach(async () => {
    await Promise.all(workspaces.splice(0).map((workspace) => workspace.remove()));
    await Promise.all(actionDirs.splice(0).map((dir) => rm(dir, {recursive: true, force: true})));
  });

  it('runs the action with fakes and types its outputs', async () => {
    const result = await runAction(slackThread, {
      inputs: {channel_id: 'C1', thread_ts: '1.0'},
      tools: {
        slack: {
          read_thread: (args) =>
            toolResult(
              args.cursor
                ? {messages: [{ts: '1.2', text: 'second'}]}
                : {
                    messages: [{ts: '1.1', text: 'first'}],
                    response_metadata: {next_cursor: 'c2'},
                  },
            ),
        },
      },
    });

    expect(result).toMatchObject({
      status: 'succeeded',
      exitCode: 0,
      outputs: {path: 'context/slack-thread.md', message_count: 2},
    });
    expect(result.calls.map((call) => call.args.cursor)).toEqual([undefined, 'c2']);
    expect(await result.workspace.read('context/slack-thread.md')).toBe('- first\n- second\n');
  });

  it('reads an action.yaml manifest', async () => {
    const dir = await writeAction({
      'action.yaml': 'name: Yaml\nmain: index.mjs\noutputs:\n  greeting:\n    required: true\n',
      'index.mjs':
        "import {defineAction} from '@shipfox/actions';\nexport default defineAction(() => ({greeting: 'hi'}));\n",
    });

    const result = await runAction(dir);

    expect(result).toMatchObject({status: 'succeeded', outputs: {greeting: 'hi'}});
  });

  it('fails an output above the runner size limit', async () => {
    const dir = await writeAction({
      'action.yml': 'name: Big\nmain: index.mjs\noutputs:\n  big: {}\n',
      'index.mjs':
        "import {defineAction} from '@shipfox/actions';\nexport default defineAction(() => ({big: 'x'.repeat(65 * 1024)}));\n",
    });

    const result = await runAction(dir);

    expect(result).toMatchObject({
      status: 'failed',
      error: {message: expect.stringContaining('Output "big" exceeds the per-value size limit')},
    });
  });

  it('rejects a missing required input before the action starts', async () => {
    const run = runAction(slackThread, {inputs: {channel_id: 'C1'}});

    await expect(run).rejects.toThrow(ActionTestSetupError);
    await expect(run).rejects.toThrow('Action input "thread_ts" is required.');
  });

  it('refuses a tool the manifest does not grant', async () => {
    const result = await runAction(probe, {
      inputs: {
        calls: [
          {alias: 'slack', tool: 'read_channel'},
          {alias: 'github', tool: 'get_issue'},
        ],
      },
      tools: {slack: {read_channel: () => ({})}},
    });

    expect(result.status).toBe('succeeded');
    expect(result.outputs.results).toEqual([
      {code: 'tool-not-granted', outcomeUnknown: false},
      {code: 'tool-not-granted', outcomeUnknown: false},
    ]);
    expect(result.calls.map((call) => call.error?.code)).toEqual([
      'tool-not-granted',
      'tool-not-granted',
    ]);
  });

  it('refuses a write tool without allow_write', async () => {
    const result = await runAction(probe, {
      inputs: {calls: [{alias: 'slack', tool: 'send_message'}]},
      tools: {slack: {send_message: () => ({ok: true})}},
    });

    expect(result.calls[0]?.error).toMatchObject({
      code: 'tool-not-granted',
      message: expect.stringContaining('allow_write: true'),
    });
  });

  it('fails a granted tool without a fake', async () => {
    const result = await runAction(probe, {
      inputs: {calls: [{alias: 'slack', tool: 'read_thread'}]},
    });

    expect(result.outputs.results).toEqual([{code: 'no-fake-for-tool', outcomeUnknown: false}]);
  });

  it('passes tool errors from fakes to the action', async () => {
    const result = await runAction(probe, {
      inputs: {calls: [{alias: 'slack', tool: 'read_thread'}]},
      tools: {
        slack: {
          read_thread: () => {
            throw toolError({code: 'provider-timeout', outcomeUnknown: true});
          },
        },
      },
    });

    expect(result.outputs.results).toEqual([{code: 'provider-timeout', outcomeUnknown: true}]);
  });

  it('writes downloads into the workspace', async () => {
    const result = await runAction(probe, {
      inputs: {
        calls: [
          {alias: 'linear', tool: 'download_file', args: {url: 'u'}, destination: 'files/'},
          {alias: 'linear', tool: 'download_file'},
        ],
      },
      tools: {
        linear: {
          download_file: () => ({bytes: 'hello', filename: 'notes.txt', mediaType: 'text/plain'}),
        },
      },
    });

    expect(result.outputs.results).toEqual([
      expect.objectContaining({path: 'files/notes.txt', bytes: 5, mediaType: 'text/plain'}),
      {code: 'tool-result-kind-mismatch', outcomeUnknown: false},
    ]);
    expect(await result.workspace.read('files/notes.txt')).toBe('hello');
  });

  it('rejects when a download fake returns something other than a file', async () => {
    const run = runAction(probe, {
      inputs: {
        calls: [{alias: 'linear', tool: 'download_file', args: {}, destination: 'files/'}],
      },
      tools: {linear: {download_file: () => toolResult({url: 'u'})}},
    });

    await expect(run).rejects.toThrow(
      'The fake for linear.download_file must return file bytes or {bytes, filename, mediaType}',
    );
  });

  it('keeps outputs, logs, and the summary of a failed action', async () => {
    const result = await runAction(probe, {inputs: {fail: true}});

    expect(result).toMatchObject({
      status: 'failed',
      exitCode: 1,
      error: {message: 'The action failed with exit code 1.'},
      outputs: {cwd: result.workspace.path, results: []},
      summary: '## Probe\n',
    });
    expect(result.logs).toContain('The probe failed on purpose.');
  });

  it('kills an action that runs past the timeout', async () => {
    const result = await runAction(probe, {inputs: {sleep_ms: 60_000}, timeoutMs: 500});

    expect(result).toMatchObject({
      status: 'failed',
      error: {message: 'The action did not finish within 500 ms.'},
    });
  });

  it('rejects with the error a fake throws', async () => {
    const run = runAction(probe, {
      inputs: {calls: [{alias: 'slack', tool: 'read_thread'}]},
      tools: {
        slack: {
          read_thread: () => {
            throw new Error('unexpected arguments');
          },
        },
      },
    });

    await expect(run).rejects.toThrow('unexpected arguments');
  });

  it('works under node:test', async () => {
    const child = spawn(
      process.execPath,
      [
        '--test',
        '--test-reporter=tap',
        fileURLToPath(new URL('../../test/node-test/run-action.mjs', import.meta.url)),
      ],
      {env: {...process.env, NODE_OPTIONS: undefined}, stdio: ['ignore', 'pipe', 'pipe']},
    );
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });

    const [exitCode] = await once(child, 'close');

    expect(exitCode, output).toBe(0);
    expect(output).toContain('# pass 2');
  });
});
