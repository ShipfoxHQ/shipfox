import {createServer, type Server} from 'node:http';
import type {AddressInfo} from 'node:net';
import {
  ACTION_TOKEN,
  type ActionSandbox,
  createActionSandbox,
  runActionProcess,
  writeFiles,
} from '#test/fixtures/action-process.js';

const PROVIDER_ERROR_STACK_RE = /Error: provider said no\n\s+at /;
const REJECTION_STACK_RE = /Error: forgotten promise\n\s+at /;

describe('bootstrap', () => {
  let sandbox: ActionSandbox;

  beforeEach(async () => {
    sandbox = await createActionSandbox();
  });

  afterEach(async () => {
    await sandbox.cleanup();
  });

  it('runs a TypeScript action with its inputs and writes the outputs and a succeeded result', async () => {
    await writeFiles(sandbox.bundle, {
      'index.ts': `
        import {defineAction} from '@shipfox/actions';
        import {greet} from './lib/greet.ts';

        export default defineAction(({inputs, setOutput, context}) => {
          setOutput('step', context.stepKey);
          return {greeting: greet(inputs.name as string), count: 2};
        });
      `,
      'lib/greet.ts': `export const greet = (name: string): string => 'Hello ' + name;`,
    });

    const run = await runActionProcess({
      sandbox,
      main: 'index.ts',
      inputs: {name: 'Ada'},
      outputs: {greeting: {type: 'string'}, count: {type: 'number'}, step: {type: 'json'}},
    });

    expect(run).toMatchObject({
      exitCode: 0,
      result: {status: 'succeeded'},
      outputs: {greeting: 'Hello Ada', count: '2', step: '"act"'},
    });
  });

  it('removes the endpoint token and the inputs path from process.env before user code loads', async () => {
    await writeFiles(sandbox.bundle, {
      'index.js': `
        import {defineAction} from '@shipfox/actions';

        const seenAtImport = Object.keys(process.env).filter((key) => key.startsWith('SHIPFOX_'));

        export default defineAction(({inputs}) => ({
          seen_at_import: seenAtImport,
          seen_in_handler: Object.keys(process.env).filter((key) => key.startsWith('SHIPFOX_')),
          input: inputs.value,
        }));
      `,
    });
    const visible = [
      'SHIPFOX_ACTIONS_URL',
      'SHIPFOX_ACTION_CONTEXT',
      'SHIPFOX_ACTION_MAIN',
      'SHIPFOX_ACTION_PATH',
      'SHIPFOX_ACTION_RESULT',
      'SHIPFOX_OUTPUT',
      'SHIPFOX_WORKSPACE',
    ];

    const run = await runActionProcess({
      sandbox,
      inputs: {value: 'kept in memory'},
      outputs: {
        seen_at_import: {type: 'json'},
        seen_in_handler: {type: 'json'},
        input: {type: 'string'},
      },
    });

    expect(run.result).toEqual({status: 'succeeded'});
    expect(JSON.parse(run.outputs.seen_at_import ?? '').sort()).toEqual(visible);
    expect(JSON.parse(run.outputs.seen_in_handler ?? '').sort()).toEqual(visible);
    expect(run.outputs.input).toBe('kept in memory');
  });

  it.runIf(process.platform === 'linux')(
    'raises its OOM score before user code loads',
    async () => {
      await writeFiles(sandbox.bundle, {
        'index.js': `
        import {readFileSync} from 'node:fs';
        import {defineAction} from '@shipfox/actions';

        export default defineAction(() => ({
          score: readFileSync('/proc/self/oom_score_adj', 'utf8').trim(),
        }));
      `,
      });

      const run = await runActionProcess({sandbox, outputs: {score: {type: 'string'}}});

      expect(run.outputs.score).toBe('1000');
    },
  );

  it('explains the expected shape when the entry does not default-export defineAction', async () => {
    await writeFiles(sandbox.bundle, {'index.js': 'export default async () => ({});'});

    const run = await runActionProcess({sandbox});

    expect(run.exitCode).toBe(1);
    expect(run.result).toEqual({status: 'failed'});
    expect(run.stderr).toContain(
      'The action entry index.js must default-export an action made by defineAction, but it default-exports a plain function.',
    );
    expect(run.stderr).toContain('export default defineAction(async ({inputs, tools}) => {');
  });

  it('fails with the stack when the handler throws, keeping outputs set before the throw', async () => {
    await writeFiles(sandbox.bundle, {
      'index.js': `
        import {defineAction} from '@shipfox/actions';

        export default defineAction(({setOutput}) => {
          setOutput('progress', 'halfway');
          throw new Error('provider said no');
        });
      `,
    });

    const run = await runActionProcess({
      sandbox,
      outputs: {progress: {type: 'string'}, done: {type: 'boolean'}},
    });

    expect(run).toMatchObject({
      exitCode: 1,
      result: {status: 'failed'},
      outputs: {progress: 'halfway'},
    });
    expect(run.stderr).toMatch(PROVIDER_ERROR_STACK_RE);
  });

  it('fails on an unhandled rejection without waiting for the handler', async () => {
    await writeFiles(sandbox.bundle, {
      'index.js': `
        import {defineAction} from '@shipfox/actions';

        export default defineAction(async () => {
          Promise.reject(new Error('forgotten promise'));
          await new Promise((resolve) => setTimeout(resolve, 30_000));
        });
      `,
    });

    const run = await runActionProcess({sandbox});

    expect(run.exitCode).toBe(1);
    expect(run.result).toEqual({status: 'failed'});
    expect(run.stderr).toMatch(REJECTION_STACK_RE);
  });

  it('writes no result when the action exits before the handler settles', async () => {
    await writeFiles(sandbox.bundle, {
      'index.js': `
        import {defineAction} from '@shipfox/actions';

        export default defineAction(async () => {
          process.exit(0);
        });
      `,
    });

    const run = await runActionProcess({sandbox});

    expect(run.exitCode).toBe(0);
    expect(run.result).toBeNull();
  });

  it('fails when the handler waits on a promise that nothing can settle', async () => {
    await writeFiles(sandbox.bundle, {
      'index.js': `
        import {defineAction} from '@shipfox/actions';

        export default defineAction(() => new Promise(() => undefined));
      `,
    });

    const run = await runActionProcess({sandbox});

    expect(run.exitCode).toBe(1);
    expect(run.result).toEqual({status: 'failed'});
    expect(run.stderr.trim()).toBe(
      'The action handler never settled: it awaits a promise that nothing will resolve.',
    );
  });

  it('fails when the returned outputs do not match their declarations', async () => {
    await writeFiles(sandbox.bundle, {
      'index.js': `
        import {defineAction} from '@shipfox/actions';

        export default defineAction(() => ({count: 'three'}));
      `,
    });

    const run = await runActionProcess({sandbox, outputs: {count: {type: 'number'}}});

    expect(run.exitCode).toBe(1);
    expect(run.result).toEqual({status: 'failed'});
    expect(run.stderr.trim()).toBe('Output "count" is declared as number but got a string.');
  });

  it('aborts the handler signal on SIGTERM', async () => {
    await writeFiles(sandbox.bundle, {
      'index.js': `
        import {defineAction} from '@shipfox/actions';

        export default defineAction(async ({signal, log}) => {
          const work = setInterval(() => undefined, 1000);
          const aborted = new Promise((_, reject) => {
            signal.addEventListener('abort', () => reject(new Error('stopped by cancellation')));
          });
          log.info('ready');
          try {
            await aborted;
          } finally {
            clearInterval(work);
          }
        });
      `,
    });

    const run = await runActionProcess({
      sandbox,
      onStdout: (chunk, child) => {
        if (chunk.includes('ready')) child.kill('SIGTERM');
      },
    });

    expect(run.exitCode).toBe(1);
    expect(run.result).toEqual({status: 'failed'});
    expect(run.stderr).toContain('stopped by cancellation');
  });

  describe('with a local tool endpoint', () => {
    let server: Server;
    let url: string;
    let authorizations: (string | undefined)[];

    beforeEach(async () => {
      authorizations = [];
      server = createServer((request, response) => {
        authorizations.push(request.headers.authorization);
        request.resume();
        if (request.url !== '/v1/tools/call') return;
        request.on('end', () => {
          response.setHeader('content-type', 'application/json');
          response.end(
            JSON.stringify({
              ok: true,
              call_id: 'call-1',
              result: {structured: {ok: true}, content: []},
            }),
          );
        });
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterEach(async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    });

    it('calls tools with the token it kept in memory', async () => {
      await writeFiles(sandbox.bundle, {
        'index.js': `
          import {defineAction} from '@shipfox/actions';

          export default defineAction(async ({tools}) => {
            const result = await tools.slack.call('read_thread', {channel_id: 'C1'});
            return {structured: result.structured};
          });
        `,
      });

      const run = await runActionProcess({
        sandbox,
        actionsUrl: url,
        outputs: {structured: {type: 'json'}},
      });

      expect(run.result).toEqual({status: 'succeeded'});
      expect(run.outputs.structured).toBe('{"ok":true}');
      expect(authorizations).toEqual([`Bearer ${ACTION_TOKEN}`]);
    });

    it('fails and names the tool calls still running when the handler returns', async () => {
      server.removeAllListeners('request');
      server.on('request', () => undefined);
      await writeFiles(sandbox.bundle, {
        'index.js': `
          import {defineAction} from '@shipfox/actions';

          export default defineAction(async ({tools}) => {
            void tools.slack.call('read_thread', {}).catch(() => undefined);
            void tools.github.call('create_commit', {}).catch(() => undefined);
            await new Promise((resolve) => setTimeout(resolve, 50));
          });
        `,
      });

      const run = await runActionProcess({sandbox, actionsUrl: url});

      expect(run.exitCode).toBe(1);
      expect(run.result).toEqual({status: 'failed'});
      expect(run.stderr.trim()).toBe(
        'The action finished while tool calls were still running: slack.read_thread, github.create_commit. Await every tool call before the handler returns.',
      );
    });
  });
});
