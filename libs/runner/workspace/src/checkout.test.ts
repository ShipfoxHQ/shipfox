// Mocked-execFile tests: assert the exact git argv, failure classification, and redaction
// without spawning git. The real-git happy path lives in checkout.realgit.test.ts.
const execFileMock = vi.fn();

vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
}));

const {checkoutRepository, CheckoutError, redactSecrets} = await import('#checkout.js');

type ExecCallback = (error: unknown, result?: {stdout: string; stderr: string}) => void;

function callbackOf(args: unknown[]): ExecCallback {
  return args[args.length - 1] as ExecCallback;
}

function resolveExec() {
  execFileMock.mockImplementation((...args: unknown[]) =>
    callbackOf(args)(null, {stdout: '', stderr: ''}),
  );
}

function rejectExec(error: unknown) {
  execFileMock.mockImplementation((...args: unknown[]) => callbackOf(args)(error));
}

function gitError(stderr: string): Error & {stderr: string} {
  return Object.assign(new Error('Command failed'), {stderr});
}

const BASE = {repositoryUrl: 'https://github.com/acme/repo.git', ref: 'main', cwd: '/work/job-1'};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('checkoutRepository argv', () => {
  it('shallow-clones the single branch with no -c when there is no auth', async () => {
    resolveExec();

    await checkoutRepository(BASE);

    expect(execFileMock).toHaveBeenCalledOnce();
    const [file, args] = execFileMock.mock.calls[0] as [string, string[]];
    expect(file).toBe('git');
    expect(args).toEqual([
      'clone',
      '--depth=1',
      '--single-branch',
      '--branch',
      'main',
      'https://github.com/acme/repo.git',
      '/work/job-1',
    ]);
  });

  it('injects a bearer credential via a one-shot http.extraHeader', async () => {
    resolveExec();

    await checkoutRepository({
      ...BASE,
      auth: {kind: 'bearer', token: 'tok-123', expires_at: '2026-01-01T00:00:00Z'},
    });

    const [, args] = execFileMock.mock.calls[0] as [string, string[]];
    expect(args.slice(0, 3)).toEqual([
      '-c',
      'http.extraHeader=Authorization: Bearer tok-123',
      'clone',
    ]);
  });

  it('injects a basic credential as a base64 Authorization header', async () => {
    resolveExec();

    await checkoutRepository({
      ...BASE,
      auth: {
        kind: 'basic',
        username: 'x-token',
        token: 'tok-123',
        expires_at: '2026-01-01T00:00:00Z',
      },
    });

    const [, args] = execFileMock.mock.calls[0] as [string, string[]];
    const expected = Buffer.from('x-token:tok-123').toString('base64');
    expect(args[1]).toBe(`http.extraHeader=Authorization: Basic ${expected}`);
  });

  it('disables interactive credential prompts', async () => {
    resolveExec();

    await checkoutRepository(BASE);

    const options = execFileMock.mock.calls[0]?.[2] as {env: Record<string, string>};
    expect(options.env.GIT_TERMINAL_PROMPT).toBe('0');
  });
});

describe('checkoutRepository failure classification', () => {
  it('classifies a rejected credential as an auth failure', async () => {
    rejectExec(gitError("fatal: Authentication failed for 'https://github.com/acme/repo.git/'"));

    await expect(checkoutRepository(BASE)).rejects.toMatchObject({
      name: 'CheckoutError',
      kind: 'auth',
    });
  });

  it('classifies an unreachable provider as unavailable', async () => {
    rejectExec(gitError('fatal: unable to access: Could not resolve host: github.com'));

    await expect(checkoutRepository(BASE)).rejects.toMatchObject({kind: 'unavailable'});
  });

  it('classifies a git-side 403 as an auth failure', async () => {
    rejectExec(
      gitError(
        "fatal: unable to access 'https://github.com/acme/repo.git/': The requested URL returned error: 403",
      ),
    );

    await expect(checkoutRepository(BASE)).rejects.toMatchObject({kind: 'auth'});
  });

  it('classifies a git-side 5xx as unavailable', async () => {
    rejectExec(
      gitError(
        "fatal: unable to access 'https://github.com/acme/repo.git/': The requested URL returned error: 503",
      ),
    );

    await expect(checkoutRepository(BASE)).rejects.toMatchObject({kind: 'unavailable'});
  });

  it('classifies a git-side 429 (rate limit) as unavailable', async () => {
    rejectExec(
      gitError(
        "fatal: unable to access 'https://github.com/acme/repo.git/': The requested URL returned error: 429",
      ),
    );

    await expect(checkoutRepository(BASE)).rejects.toMatchObject({kind: 'unavailable'});
  });

  it('classifies an unknown clone failure as a generic failure', async () => {
    rejectExec(gitError('fatal: Remote branch main not found in upstream origin'));

    await expect(checkoutRepository(BASE)).rejects.toMatchObject({kind: 'failed'});
  });

  it('classifies an aborted clone as aborted', async () => {
    rejectExec(Object.assign(new Error('The operation was aborted'), {name: 'AbortError'}));

    await expect(checkoutRepository(BASE)).rejects.toMatchObject({kind: 'aborted'});
  });

  it('redacts the token from a failure message', async () => {
    rejectExec(gitError('fatal: bad request sending tok-123 to remote'));

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
    rejectExec(gitError(`fatal: bad request sending ${base64} to remote`));

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

  it('redacts a basic credential when stderr is empty and the argv leaks into error.message', async () => {
    const base64 = Buffer.from('x-token:tok-123').toString('base64');
    // No stderr: classifyCloneError falls back to the execFile error.message, which on
    // Node carries the full argv including the Authorization header value.
    rejectExec(
      Object.assign(
        new Error(
          `Command failed: git -c http.extraHeader=Authorization: Basic ${base64} clone --depth=1`,
        ),
        {stderr: ''},
      ),
    );

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
    expect((error as Error).message).not.toContain('tok-123');
    expect((error as Error).message).toContain('***');
  });

  it('scrubs the token from the error cause so it cannot ride the cause chain into a log', async () => {
    const raw = Object.assign(
      new Error('Command failed: git -c http.extraHeader=Authorization: Bearer tok-123 clone ...'),
      {stderr: 'fatal: Authentication failed'},
    );
    rejectExec(raw);

    const error = await checkoutRepository({
      ...BASE,
      auth: {kind: 'bearer', token: 'tok-123', expires_at: '2026-01-01T00:00:00Z'},
    }).catch((e: unknown) => e);

    const cause = (error as Error).cause as Error;
    expect(cause.message).not.toContain('tok-123');
    expect(cause.message).toContain('***');
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
