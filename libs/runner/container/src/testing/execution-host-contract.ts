import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import type {ExecutionHost, HostProcess, SpawnRequest} from '#execution-host.js';

export interface ExecutionHostContractSetup {
  host: ExecutionHost;
  /** An existing directory the host can read and write, at the same path for the test. */
  directory: string;
  dispose?: () => Promise<void>;
}

const BASE_ENV = {PATH: process.env.PATH ?? '/usr/bin:/bin'};
const WAIT_STEP_MS = 50;
const WAIT_LIMIT_MS = 5000;

/**
 * The behavior every `ExecutionHost` must have. The local host runs it today, and the container
 * host runs the same suite. It only needs `sh` and coreutils in the host.
 */
export function describeExecutionHostContract(
  name: string,
  setup: () => Promise<ExecutionHostContractSetup>,
): void {
  describe(`ExecutionHost contract: ${name}`, () => {
    let context: ExecutionHostContractSetup;
    let sandbox: string;

    beforeAll(async () => {
      context = await setup();
    });

    afterAll(async () => {
      await context.dispose?.();
    });

    beforeEach(async () => {
      sandbox = join(context.directory, randomUUID());
      await context.host.mkdir(sandbox, {recursive: true});
    });

    function run(script: string, request: Partial<SpawnRequest> = {}): HostProcess {
      return context.host.spawn({
        argv: ['sh', '-c', script],
        cwd: sandbox,
        env: BASE_ENV,
        ...request,
      });
    }

    describe('spawn', () => {
      it('keeps the two output pipes apart and reports the exit code', async () => {
        const child = run('echo out; echo err >&2; exit 3');

        const [stdout, stderr, exit] = await Promise.all([
          readAll(child.stdout),
          readAll(child.stderr),
          child.exited,
        ]);

        expect(stdout).toBe('out\n');
        expect(stderr).toBe('err\n');
        expect(exit.exitCode).toBe(3);
      });

      it('starts the process in the working directory', async () => {
        const child = run('echo here > marker');

        await child.exited;

        expect((await context.host.readFile(join(sandbox, 'marker'))).toString()).toBe('here\n');
      });

      it('passes the requested environment and nothing from the runner', async () => {
        process.env.SHIPFOX_CONTRACT_RUNNER_ONLY = 'leaked';
        try {
          const child = run('echo "$GREETING/$SHIPFOX_CONTRACT_RUNNER_ONLY"', {
            env: {...BASE_ENV, GREETING: 'hello'},
          });

          const [stdout] = await Promise.all([readAll(child.stdout), child.exited]);

          expect(stdout).toBe('hello/\n');
        } finally {
          delete process.env.SHIPFOX_CONTRACT_RUNNER_ONLY;
        }
      });

      it('connects stdin when asked to', async () => {
        const child = run('cat', {stdin: 'pipe'});
        child.stdin?.end('from stdin');

        const [stdout] = await Promise.all([readAll(child.stdout), child.exited]);

        expect(stdout).toBe('from stdin');
      });

      it('kills the whole process tree', async () => {
        const child = run('sleep 60 & echo $!; wait');
        const output = readAll(child.stdout);
        const pid = await firstLine(child.stdout, output);

        await child.killTree();
        await child.exited;

        await waitFor(async () => !(await isAlive(pid)));
      });

      it('kills background processes when the process exits, if asked to', async () => {
        const child = run('sleep 60 & echo $!', {killTreeOnExit: true});

        const [stdout] = await Promise.all([readAll(child.stdout), child.exited]);

        await waitFor(async () => !(await isAlive(stdout.trim())));
      });

      it('reports the process exit while a background process holds the output pipes', async () => {
        const child = run('sleep 60 & echo $!; exit 4');
        const output = readAll(child.stdout);
        const pid = await firstLine(child.stdout, output);

        const exit = await child.processExited;

        expect(exit.exitCode).toBe(4);
        expect(await isAlive(pid)).toBe(true);
        await child.killTree();
        await child.exited;
        await waitFor(async () => !(await isAlive(pid)));
      });

      it('can kill a process that already exited', async () => {
        const child = run('true');
        await child.exited;

        await expect(child.killTree()).resolves.toBeUndefined();
      });
    });

    describe('files', () => {
      it('writes and reads a buffer', async () => {
        const path = join(sandbox, 'buffer.txt');

        await context.host.writeFile(path, Buffer.from('content'));

        expect((await context.host.readFile(path)).toString()).toBe('content');
      });

      it('reads only the first bytes of a file when given a length', async () => {
        const path = join(sandbox, 'head.txt');
        await context.host.writeFile(path, Buffer.from('0123456789'));

        expect((await context.host.readFile(path, {length: 4})).toString()).toBe('0123');
        expect((await context.host.readFile(path, {length: 100})).toString()).toBe('0123456789');
        expect((await context.host.readFile(path, {length: 0})).length).toBe(0);
      });

      it('streams a readable into a file', async () => {
        const path = join(sandbox, 'stream.txt');

        await context.host.writeFile(path, Readable.from([Buffer.from('ab'), Buffer.from('cd')]));

        expect((await context.host.readFile(path)).toString()).toBe('abcd');
      });

      it('creates the file with the requested mode', async () => {
        const path = join(sandbox, 'private.txt');

        await context.host.writeFile(path, Buffer.from('secret'), {mode: 0o600});

        expect((await context.host.stat(path)).mode & 0o777).toBe(0o600);
      });

      it('replaces a file, unless the write is exclusive', async () => {
        const path = join(sandbox, 'replace.txt');
        await context.host.writeFile(path, Buffer.from('first'));

        await expect(
          context.host.writeFile(path, Buffer.from('second'), {exclusive: true}),
        ).rejects.toThrow();
        expect((await context.host.readFile(path)).toString()).toBe('first');

        await context.host.writeFile(path, Buffer.from('second'));
        expect((await context.host.readFile(path)).toString()).toBe('second');
      });

      it('stops a streamed write when the signal aborts', async () => {
        const controller = new AbortController();
        const never = new Readable({
          read() {
            // Never produces data, so only the signal can end the write.
          },
        });
        const write = context.host.writeFile(join(sandbox, 'aborted.txt'), never, {
          signal: controller.signal,
        });

        controller.abort(new Error('stop'));

        await expect(write).rejects.toThrow();
      });

      it('reports files, directories, and sizes', async () => {
        await context.host.writeFile(join(sandbox, 'file.txt'), Buffer.from('12345'));
        await context.host.mkdir(join(sandbox, 'nested', 'deep'), {recursive: true});

        expect(await context.host.stat(join(sandbox, 'file.txt'))).toMatchObject({
          type: 'file',
          size: 5,
        });
        expect(await context.host.stat(join(sandbox, 'nested', 'deep'))).toMatchObject({
          type: 'directory',
        });
        await expect(context.host.stat(join(sandbox, 'missing'))).rejects.toThrow();
      });

      it('lists the entries of a directory with their types', async () => {
        await context.host.writeFile(join(sandbox, 'a.txt'), Buffer.from('a'));
        await context.host.mkdir(join(sandbox, 'b'));

        const entries = await context.host.readdir(sandbox);

        expect([...entries].sort((x, y) => x.name.localeCompare(y.name))).toEqual([
          {name: 'a.txt', type: 'file'},
          {name: 'b', type: 'directory'},
        ]);
      });

      it('tells whether a path exists', async () => {
        await context.host.writeFile(join(sandbox, 'present.txt'), Buffer.from('x'));

        expect(await context.host.exists(join(sandbox, 'present.txt'))).toBe(true);
        expect(await context.host.exists(join(sandbox, 'absent.txt'))).toBe(false);
      });

      it('refuses to create a missing parent unless recursive', async () => {
        await expect(context.host.mkdir(join(sandbox, 'x', 'y'))).rejects.toThrow();

        await context.host.mkdir(join(sandbox, 'x', 'y'), {recursive: true});

        expect(await context.host.exists(join(sandbox, 'x', 'y'))).toBe(true);
      });
    });

    async function isAlive(pid: string): Promise<boolean> {
      const probe = run(`kill -0 ${pid}`);
      const exit = await probe.exited;
      return exit.exitCode === 0;
    }
  });
}

async function readAll(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString();
}

// Resolves with the first line the stream printed, while `rest` keeps draining it.
async function firstLine(stream: NodeJS.ReadableStream, rest: Promise<string>): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    let seen = '';
    stream.on('data', (chunk: Buffer) => {
      seen += chunk.toString();
      const end = seen.indexOf('\n');
      if (end !== -1) resolve(seen.slice(0, end));
    });
    rest.then(() => reject(new Error('The process ended before it printed a line.')), reject);
  });
}

async function waitFor(condition: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + WAIT_LIMIT_MS;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error('The condition was not met in time.');
    await new Promise((resolve) => setTimeout(resolve, WAIT_STEP_MS));
  }
}
