import {EventEmitter} from 'node:events';

const execFileMock = vi.fn();
const spawnMock = vi.fn();

vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

const {checkoutRepository, CheckoutError, redactSecrets} = await import('#checkout.js');

type SpawnResult =
  | {kind: 'success'; stdout?: string; stderr?: string}
  | {kind: 'failure'; stderr: string; code?: number; signal?: NodeJS.Signals | null}
  | {kind: 'error'; error: Error};

function queueGitResults(results: SpawnResult[]) {
  const queue = [...results];
  spawnMock.mockImplementation(() => {
    const result = queue.shift();
    if (!result) throw new Error('Unexpected git command');

    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();

    queueMicrotask(() => {
      if (result.kind === 'error') {
        child.emit('error', result.error);
        return;
      }
      if (result.kind === 'success' && result.stdout) {
        child.stdout.emit('data', Buffer.from(result.stdout));
      }
      if (result.stderr) child.stderr.emit('data', Buffer.from(result.stderr));
      if (result.kind === 'success') {
        child.emit('close', 0, null);
        return;
      }
      child.emit('close', result.code ?? 1, result.signal ?? null);
    });

    return child;
  });
}

function queueSuccessfulCheckout(commit = 'abc123') {
  queueGitResults([
    {kind: 'success'},
    {kind: 'success'},
    {kind: 'success', stderr: 'fetch progress\n'},
    {kind: 'success', stderr: 'checkout progress\n'},
    {kind: 'success', stdout: `${commit}\n`},
  ]);
}

function queueFetchFailure(stderr: string) {
  queueGitResults([{kind: 'success'}, {kind: 'success'}, {kind: 'failure', stderr}]);
}

const BASE = {repositoryUrl: 'https://github.com/acme/repo.git', ref: 'main', cwd: '/work/job-1'};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('checkoutRepository argv', () => {
  it('runs explicit checkout phases without auth when there is no auth', async () => {
    queueSuccessfulCheckout();

    const commit = await checkoutRepository(BASE);

    expect(commit).toBe('abc123');
    expect(spawnMock.mock.calls.map((call) => call[1])).toEqual([
      ['init'],
      ['remote', 'add', 'origin', 'https://github.com/acme/repo.git'],
      ['fetch', '--progress', '--no-tags', '--prune', '--depth=1', 'origin', 'main'],
      ['checkout', '--progress', '--force', 'FETCH_HEAD'],
      ['rev-parse', 'HEAD'],
    ]);
  });

  it('injects a bearer credential only on fetch and excludes it from displayed commands', async () => {
    queueSuccessfulCheckout();
    const onCommandStart = vi.fn();
    const onSecrets = vi.fn();

    await checkoutRepository({
      ...BASE,
      auth: {kind: 'bearer', token: 'tok-123', expires_at: '2026-01-01T00:00:00Z'},
      onCommandStart,
      onSecrets,
    });

    const fetchArgs = spawnMock.mock.calls[2]?.[1] as string[];
    expect(fetchArgs.slice(0, 3)).toEqual([
      '-c',
      'http.extraHeader=Authorization: Bearer tok-123',
      'fetch',
    ]);
    expect(onSecrets).toHaveBeenCalledWith(['tok-123']);
    expect(onCommandStart.mock.calls.map((call) => call[0].command).join('\n')).not.toContain(
      'tok-123',
    );
  });

  it('injects a basic credential as a base64 Authorization header and registers both secrets', async () => {
    queueSuccessfulCheckout();
    const onSecrets = vi.fn();
    const expected = Buffer.from('x-token:tok-123').toString('base64');

    await checkoutRepository({
      ...BASE,
      auth: {
        kind: 'basic',
        username: 'x-token',
        token: 'tok-123',
        expires_at: '2026-01-01T00:00:00Z',
      },
      onSecrets,
    });

    const fetchArgs = spawnMock.mock.calls[2]?.[1] as string[];
    expect(fetchArgs[1]).toBe(`http.extraHeader=Authorization: Basic ${expected}`);
    expect(onSecrets).toHaveBeenCalledWith(['tok-123', expected]);
  });

  it('disables interactive credential prompts on every git process', async () => {
    queueSuccessfulCheckout();

    await checkoutRepository(BASE);

    for (const call of spawnMock.mock.calls) {
      const options = call[2] as {env: Record<string, string>};
      expect(options.env.GIT_TERMINAL_PROMPT).toBe('0');
    }
  });

  it('streams git output through the provided sink', async () => {
    queueSuccessfulCheckout();
    const onOutput = vi.fn();

    await checkoutRepository({...BASE, onOutput});

    expect(onOutput).toHaveBeenCalledWith(Buffer.from('fetch progress\n'), 'stderr');
    expect(onOutput).toHaveBeenCalledWith(Buffer.from('checkout progress\n'), 'stderr');
    expect(onOutput).toHaveBeenCalledWith(Buffer.from('abc123\n'), 'stdout');
  });
});

describe('checkoutRepository failure classification', () => {
  it('classifies a rejected credential as an auth failure', async () => {
    queueFetchFailure("fatal: Authentication failed for 'https://github.com/acme/repo.git/'");

    await expect(checkoutRepository(BASE)).rejects.toMatchObject({
      name: 'CheckoutError',
      kind: 'auth',
      phase: 'fetch',
    });
  });

  it('classifies an unreachable provider as unavailable', async () => {
    queueFetchFailure('fatal: unable to access: Could not resolve host: github.com');

    await expect(checkoutRepository(BASE)).rejects.toMatchObject({kind: 'unavailable'});
  });

  it('classifies a git-side 403 as an auth failure', async () => {
    queueFetchFailure(
      "fatal: unable to access 'https://github.com/acme/repo.git/': The requested URL returned error: 403",
    );

    await expect(checkoutRepository(BASE)).rejects.toMatchObject({kind: 'auth'});
  });

  it('classifies a git-side 5xx as unavailable', async () => {
    queueFetchFailure(
      "fatal: unable to access 'https://github.com/acme/repo.git/': The requested URL returned error: 503",
    );

    await expect(checkoutRepository(BASE)).rejects.toMatchObject({kind: 'unavailable'});
  });

  it('classifies a git-side 429 as unavailable', async () => {
    queueFetchFailure(
      "fatal: unable to access 'https://github.com/acme/repo.git/': The requested URL returned error: 429",
    );

    await expect(checkoutRepository(BASE)).rejects.toMatchObject({kind: 'unavailable'});
  });

  it('classifies an unknown checkout failure as a generic failure', async () => {
    queueFetchFailure('fatal: Remote branch main not found in upstream origin');

    await expect(checkoutRepository(BASE)).rejects.toMatchObject({kind: 'failed'});
  });

  it('classifies an aborted checkout as aborted with its phase', async () => {
    queueGitResults([
      {kind: 'success'},
      {kind: 'success'},
      {
        kind: 'error',
        error: Object.assign(new Error('The operation was aborted'), {name: 'AbortError'}),
      },
    ]);

    await expect(checkoutRepository(BASE)).rejects.toMatchObject({kind: 'aborted', phase: 'fetch'});
  });

  it('redacts the token from a failure message', async () => {
    queueFetchFailure('fatal: bad request sending tok-123 to remote');

    const error = await checkoutRepository({
      ...BASE,
      auth: {kind: 'bearer', token: 'tok-123', expires_at: '2026-01-01T00:00:00Z'},
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CheckoutError);
    expect((error as Error).message).not.toContain('tok-123');
    expect((error as Error).message).toContain('***');
  });

  it('redacts the base64 form of a basic credential from a failure message', async () => {
    const base64 = Buffer.from('x-token:tok-123').toString('base64');
    queueFetchFailure(`fatal: bad request sending ${base64} to remote`);

    const error = await checkoutRepository({
      ...BASE,
      auth: {
        kind: 'basic',
        username: 'x-token',
        token: 'tok-123',
        expires_at: '2026-01-01T00:00:00Z',
      },
    }).catch((e: unknown) => e);

    expect((error as Error).message).not.toContain(base64);
    expect((error as Error).message).toContain('***');
  });

  it('scrubs the token from the error cause so it cannot ride the cause chain into a log', async () => {
    queueFetchFailure('fatal: Authentication failed for token tok-123');

    const error = await checkoutRepository({
      ...BASE,
      auth: {kind: 'bearer', token: 'tok-123', expires_at: '2026-01-01T00:00:00Z'},
    }).catch((e: unknown) => e);

    const cause = (error as Error).cause as Error;
    expect(cause.message).not.toContain('tok-123');
  });
});

describe('redactSecrets', () => {
  it('removes every occurrence of each secret', () => {
    expect(redactSecrets('token=abc and again abc', ['abc'])).toBe('token=*** and again ***');
  });

  it('strips URL-embedded credentials', () => {
    expect(redactSecrets('clone https://user:pass@github.com/x.git failed', [])).toBe(
      'clone https://***@github.com/x.git failed',
    );
  });

  it('ignores empty secrets', () => {
    expect(redactSecrets('unchanged', [''])).toBe('unchanged');
  });
});
