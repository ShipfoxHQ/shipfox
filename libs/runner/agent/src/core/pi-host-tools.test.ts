import {mkdir, mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {ToolDefinition} from '@earendil-works/pi-coding-agent';
import {LocalExecutionHost} from '@shipfox/runner-container';
import type {CarriedEnv} from '@shipfox/runner-execution/carried-env';
import {createBashOperations, createPiHostToolDefinitions} from '#core/pi-host-tools.js';

const SETTINGS = {autoResizeImages: false, shellCommandPrefix: undefined, shellPath: undefined};
const ENV = {PATH: process.env.PATH};
const MISSING_FILE = /ENOENT|not found/i;

describe('Pi host tools', () => {
  let root: string;
  const host = new LocalExecutionHost();

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'shipfox-pi-host-tools-'));
  });

  afterEach(async () => {
    await rm(root, {recursive: true, force: true});
  });

  function definitions(selectedTools?: readonly string[]) {
    return createPiHostToolDefinitions({
      host,
      cwd: root,
      selectedTools,
      settings: SETTINGS,
      gitConfigGlobal: undefined,
    });
  }

  function tool(name: string): ToolDefinition {
    const found = definitions(['read', 'bash', 'edit', 'write', 'ls']).find(
      (definition) => definition.name === name,
    );
    if (found === undefined) throw new Error(`Missing tool ${name}`);
    return found;
  }

  async function call(name: string, params: Record<string, unknown>) {
    const result = await tool(name).execute(
      'call-1',
      params as never,
      new AbortController().signal,
      undefined,
      undefined as never,
    );
    return result.content.map((part) => ('text' in part ? part.text : '')).join('');
  }

  describe('selection', () => {
    it('replaces the tools pi activates by default', () => {
      expect(definitions().map((definition) => definition.name)).toEqual([
        'read',
        'bash',
        'edit',
        'write',
      ]);
    });

    it('replaces only the selected tools it can back', () => {
      expect(definitions(['ls', 'read', 'grep', 'set_output']).map((d) => d.name)).toEqual([
        'read',
        'ls',
      ]);
    });

    it('replaces nothing when the step selects no tool', () => {
      expect(definitions([])).toEqual([]);
    });
  });

  describe('file tools', () => {
    it('writes a file with its missing parent directories and reads it back', async () => {
      const path = join(root, 'nested', 'dir', 'note.txt');

      await call('write', {path, content: 'first\nsecond\n'});

      expect(await readFile(path, 'utf8')).toBe('first\nsecond\n');
      expect(await call('read', {path})).toContain('second');
    });

    it('edits a file by exact text', async () => {
      const path = join(root, 'edit.txt');
      await writeFile(path, 'alpha\nbeta\n');

      await call('edit', {path, edits: [{oldText: 'beta', newText: 'gamma'}]});

      expect(await readFile(path, 'utf8')).toBe('alpha\ngamma\n');
    });

    it('lists a directory with a slash on its subdirectories', async () => {
      await mkdir(join(root, 'sub'));
      await writeFile(join(root, 'a.txt'), '');

      expect(await call('ls', {path: root})).toBe('a.txt\nsub/');
    });

    it('reports a missing file', async () => {
      await expect(call('read', {path: join(root, 'missing.txt')})).rejects.toThrow(MISSING_FILE);
    });

    it('reads a PNG as an image and a lookalike text file as text', async () => {
      const png = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.from([0, 0, 0, 13]),
        Buffer.from('IHDR'),
        Buffer.alloc(13),
        Buffer.alloc(4),
        Buffer.from([0, 0, 0, 0]),
        Buffer.from('IDAT'),
        Buffer.alloc(4),
      ]);
      await writeFile(join(root, 'pixel.png'), png);
      await writeFile(join(root, 'ranking.txt'), 'BM25 ranking is a retrieval function.\n');

      const image = await tool('read').execute(
        'call-1',
        {path: join(root, 'pixel.png')} as never,
        new AbortController().signal,
        undefined,
        undefined as never,
      );

      expect(image.content.some((part) => part.type === 'image')).toBe(true);
      expect(await call('read', {path: join(root, 'ranking.txt')})).toContain('BM25 ranking');
    });
  });

  it('sniffs only the head of a large file for an image', async () => {
    const path = join(root, 'large.txt');
    await writeFile(path, 'x'.repeat(100_000));
    const readFileSpy = vi.spyOn(host, 'readFile');

    await call('read', {path});

    expect(readFileSpy).toHaveBeenCalledWith(path, {length: 4100});
    readFileSpy.mockRestore();
  });

  describe('bash operations', () => {
    function exec(
      command: string,
      options: {
        gitConfigGlobal?: string;
        carriedEnv?: CarriedEnv;
        signal?: AbortSignal;
        timeout?: number;
        env?: NodeJS.ProcessEnv;
        cwd?: string;
      } = {},
    ) {
      const chunks: Buffer[] = [];
      const operations = createBashOperations(host, {
        shellPath: undefined,
        gitConfigGlobal: options.gitConfigGlobal,
        carriedEnv: options.carriedEnv,
      });
      const result = operations.exec(command, options.cwd ?? root, {
        onData: (data) => chunks.push(data),
        env: options.env ?? ENV,
        ...(options.signal === undefined ? {} : {signal: options.signal}),
        ...(options.timeout === undefined ? {} : {timeout: options.timeout}),
      });
      return {result, output: () => Buffer.concat(chunks).toString()};
    }

    it('streams both output pipes and reports the exit code', async () => {
      const run = exec('echo out; echo err >&2; exit 3');

      expect(await run.result).toEqual({exitCode: 3});
      expect(run.output()).toContain('out');
      expect(run.output()).toContain('err');
    });

    it('runs in the requested directory with exactly the requested environment', async () => {
      const run = exec('pwd; echo "$GREETING/$(printenv HOME || echo unset)"', {
        env: {...ENV, GREETING: 'hi'},
      });

      await run.result;

      expect(run.output()).toContain(`${root}\n`.replace('/private', ''));
      expect(run.output()).toContain('hi/unset');
    });

    it('adds the job Git config to the shell environment only', async () => {
      const run = exec('echo "$GIT_CONFIG_GLOBAL"', {gitConfigGlobal: '/job/git.config'});

      await run.result;

      expect(run.output()).toBe('/job/git.config\n');
      expect(process.env.GIT_CONFIG_GLOBAL).not.toBe('/job/git.config');
    });

    it('layers the carried env above the requested environment and below the job Git config', async () => {
      const run = exec('echo "$SHARED/$CARRIED_ONLY/$GIT_CONFIG_GLOBAL"; echo "$PATH"', {
        env: {...ENV, SHARED: 'runner', PATH: '/usr/bin:/bin'},
        gitConfigGlobal: '/job/git.config',
        carriedEnv: {
          env: {SHARED: 'carried', CARRIED_ONLY: 'yes', GIT_CONFIG_GLOBAL: '/carried/git.config'},
          path: ['/carried/a', '/carried/b'],
        },
      });

      await run.result;

      expect(run.output()).toBe(
        'carried/yes//job/git.config\n/carried/a:/carried/b:/usr/bin:/bin\n',
      );
    });

    describe('in a container', () => {
      const container = {shell: '/bin/sh', env: {PATH: ENV.PATH ?? '', IMAGE_ONLY: 'yes'}};

      function execInContainer(command: string, env: NodeJS.ProcessEnv) {
        const chunks: Buffer[] = [];
        const operations = createBashOperations(host, {
          shellPath: '/runner/only/bash',
          gitConfigGlobal: undefined,
          carriedEnv: {env: {CARRIED: 'yes'}, path: ['/carried/bin']},
          container,
        });
        return {
          result: operations.exec(command, root, {onData: (data) => chunks.push(data), env}),
          output: () => Buffer.concat(chunks).toString(),
        };
      }

      it('runs the command with the container shell and never the shell path of the runner', async () => {
        const spawn = vi.spyOn(host, 'spawn');

        await execInContainer('true', ENV).result;

        expect(spawn.mock.calls.at(-1)?.[0].argv).toEqual(['/bin/sh', '-c', 'true']);
        spawn.mockRestore();
      });

      it('starts from the container environment, not from the one pi hands over', async () => {
        const run = execInContainer('echo "$IMAGE_ONLY/$RUNNER_ONLY/$CARRIED"; echo "$PATH"', {
          ...ENV,
          RUNNER_ONLY: 'leaked',
        });

        await run.result;

        expect(run.output()).toBe(`yes//yes\n/carried/bin:${ENV.PATH}\n`);
      });
    });

    it('returns when the shell exits although a background process holds the pipes', async () => {
      const startedAt = Date.now();
      const run = exec('sleep 30 & echo $!');

      expect(await run.result).toEqual({exitCode: 0});
      expect(Date.now() - startedAt).toBeLessThan(5000);

      process.kill(Number(run.output().trim()), 'SIGKILL');
    });

    it('kills the process tree and rejects on timeout', async () => {
      const run = exec('sleep 60 & wait', {timeout: 0.2});

      await expect(run.result).rejects.toThrow('timeout:0.2');
    });

    it('kills the process tree and rejects when the signal aborts', async () => {
      const controller = new AbortController();
      const run = exec('sleep 60', {signal: controller.signal});

      controller.abort();

      await expect(run.result).rejects.toThrow('aborted');
    });

    it('rejects an aborted signal before spawning', async () => {
      const run = exec('echo hi', {signal: AbortSignal.abort()});

      await expect(run.result).rejects.toThrow('aborted');
      expect(run.output()).toBe('');
    });

    it('rejects an invalid timeout', async () => {
      await expect(exec('true', {timeout: -1}).result).rejects.toThrow('Invalid timeout');
    });

    it('rejects a working directory that does not exist', async () => {
      const run = exec('true', {cwd: join(root, 'gone')});

      await expect(run.result).rejects.toThrow('Working directory does not exist');
    });
  });

  it('follows symlinks when it lists a directory', async () => {
    await mkdir(join(root, 'real'));
    await symlink(join(root, 'real'), join(root, 'link'));

    expect(await call('ls', {path: root})).toBe('link/\nreal/');
  });
});
