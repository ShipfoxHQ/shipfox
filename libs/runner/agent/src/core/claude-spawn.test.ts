import {LocalExecutionHost} from '@shipfox/runner-container';
import {createClaudeProcessSpawner, withProcessStderr} from '#core/claude-spawn.js';

const ENV = {PATH: process.env.PATH};

function spawnOptions(script: string, overrides: {signal?: AbortSignal; env?: typeof ENV} = {}) {
  return {
    command: 'sh',
    args: ['-c', script],
    env: overrides.env ?? ENV,
    signal: overrides.signal ?? new AbortController().signal,
  };
}

function exitOf(process: {
  once: (
    event: 'exit',
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ) => void;
}) {
  return new Promise<{code: number | null; signal: NodeJS.Signals | null}>((resolve) => {
    process.once('exit', (code, signal) => resolve({code, signal}));
  });
}

// Killing a process group before the shell started leaves it running, so wait for its first output.
async function started(stream: NodeJS.ReadableStream): Promise<void> {
  await new Promise<void>((resolve) => stream.once('data', () => resolve()));
}

async function readAll(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString();
}

describe('createClaudeProcessSpawner', () => {
  it('connects stdin and stdout and reports the exit', async () => {
    const {spawn} = createClaudeProcessSpawner(new LocalExecutionHost());

    const child = spawn(spawnOptions('cat; exit 3'));
    const exit = exitOf(child);
    child.stdin.end('ping');

    expect(await readAll(child.stdout)).toBe('ping');
    expect(await exit).toEqual({code: 3, signal: null});
    expect(child.exitCode).toBe(3);
    expect(child.killed).toBe(false);
  });

  it('passes only the defined environment variables', async () => {
    const {spawn} = createClaudeProcessSpawner(new LocalExecutionHost());

    const child = spawn(
      spawnOptions('echo "$A/$(printenv B || echo unset)"', {
        env: {...ENV, A: '1', B: undefined} as never,
      }),
    );

    expect(await readAll(child.stdout)).toBe('1/unset\n');
  });

  it('kills the process tree when the SDK kills the process', async () => {
    const {spawn} = createClaudeProcessSpawner(new LocalExecutionHost());
    const child = spawn(spawnOptions('sleep 60 & echo ready; wait'));
    const exit = exitOf(child);
    await started(child.stdout);

    expect(child.kill('SIGTERM')).toBe(true);

    // The exit settles only once the background process that holds the pipes is gone too.
    await exit;
    expect(child.killed).toBe(true);
  });

  it('kills the process when the forwarded signal aborts', async () => {
    const {spawn} = createClaudeProcessSpawner(new LocalExecutionHost());
    const controller = new AbortController();
    const child = spawn(spawnOptions('echo ready; sleep 60', {signal: controller.signal}));
    const exit = exitOf(child);
    await started(child.stdout);

    controller.abort();

    expect(await exit).toMatchObject({signal: 'SIGKILL'});
  });

  it('keeps the end of stderr', async () => {
    const spawner = createClaudeProcessSpawner(new LocalExecutionHost());
    const child = spawner.spawn(spawnOptions('printf "%3000s" x >&2; echo boom >&2'));

    await exitOf(child);

    const tail = spawner.stderrTail();
    expect(tail).toHaveLength(2048);
    expect(tail.endsWith('xboom\n')).toBe(true);
  });

  it('reports a process that could not start', async () => {
    const host = new LocalExecutionHost();
    const real = host.spawn.bind(host);
    const failure = new Error('spawn failed');
    vi.spyOn(host, 'spawn').mockImplementation((request) => ({
      ...real(request),
      exited: Promise.reject(failure),
    }));
    const child = createClaudeProcessSpawner(host).spawn(spawnOptions('true'));
    const reported = new Promise<Error>((resolve) => {
      (child as unknown as NodeJS.EventEmitter).once('error', resolve);
    });

    expect(await reported).toBe(failure);
  });

  it('kills background processes once Claude Code exits', async () => {
    const host = new LocalExecutionHost();
    const spawn = vi.spyOn(host, 'spawn');

    const child = createClaudeProcessSpawner(host).spawn(spawnOptions('true'));
    await exitOf(child);

    expect(spawn).toHaveBeenCalledWith(expect.objectContaining({killTreeOnExit: true}));
  });
});

describe('withProcessStderr', () => {
  it('appends stderr to an exit error, like the SDK does for a process it spawned', () => {
    const error = withProcessStderr(
      new Error('Claude Code process exited with code 1'),
      'bad flag\n',
    );

    expect(error).toHaveProperty(
      'message',
      'Claude Code process exited with code 1. stderr: bad flag',
    );
  });

  it('keeps an exit error that already has it', () => {
    const error = new Error('Claude Code process exited with code 1. stderr: bad flag');

    expect(withProcessStderr(error, 'bad flag')).toHaveProperty('message', error.message);
  });

  it.each([
    ['an abort', new Error('Claude Code process aborted by user')],
    ['another failure', new Error('Rate limited')],
    ['a non-error', 'oops'],
  ])('leaves %s alone', (_name, error) => {
    expect(withProcessStderr(error, 'bad flag')).toBe(error);
  });

  it('leaves an error alone when stderr is empty', () => {
    const error = new Error('Claude Code process exited with code 1');

    expect(withProcessStderr(error, ' \n')).toHaveProperty('message', error.message);
  });
});
