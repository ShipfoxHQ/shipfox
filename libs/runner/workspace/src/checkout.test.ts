// Mocked-execFile tests: assert the git argv, env-based credential injection, version gate,
// failure classification, and redaction without spawning git. The real-git happy path lives
// in checkout.realgit.test.ts.
const execFileMock = vi.fn();

vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
}));

const {assertGitAvailable, checkoutRepository, CheckoutError, GitUnavailableError} = await import(
  '#checkout.js'
);

type ExecCallback = (error: unknown, result?: {stdout: string; stderr: string}) => void;
type ExecOptions = {env: Record<string, string | undefined>};

function callbackOf(args: unknown[]): ExecCallback {
  return args[args.length - 1] as ExecCallback;
}

function resolveExec() {
  execFileMock.mockImplementation((...args: unknown[]) =>
    callbackOf(args)(null, {stdout: '', stderr: ''}),
  );
}

function resolveExecWith(stdout: string) {
  execFileMock.mockImplementation((...args: unknown[]) =>
    callbackOf(args)(null, {stdout, stderr: ''}),
  );
}

function rejectExec(error: unknown) {
  execFileMock.mockImplementation((...args: unknown[]) => callbackOf(args)(error));
}

function gitError(stderr: string): Error & {stderr: string} {
  return Object.assign(new Error('Command failed'), {stderr});
}

function optionsOf(callIndex = 0): ExecOptions {
  return execFileMock.mock.calls[callIndex]?.[2] as ExecOptions;
}

const BASE = {repositoryUrl: 'https://github.com/acme/repo.git', ref: 'main', cwd: '/work/job-1'};
const CLONE_ARGS = [
  'clone',
  '--depth=1',
  '--single-branch',
  '--branch',
  'main',
  'https://github.com/acme/repo.git',
  '/work/job-1',
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('checkoutRepository argv and env injection', () => {
  it('shallow-clones the single branch with no credential when there is no auth', async () => {
    resolveExec();

    await checkoutRepository(BASE);

    expect(execFileMock).toHaveBeenCalledOnce();
    const [file, args] = execFileMock.mock.calls[0] as [string, string[]];
    expect(file).toBe('git');
    expect(args).toEqual(CLONE_ARGS);
    expect(optionsOf().env.GIT_CONFIG_COUNT).toBeUndefined();
  });

  it('keeps the bearer token out of argv and injects it via env GIT_CONFIG_*', async () => {
    resolveExec();

    await checkoutRepository({
      ...BASE,
      auth: {kind: 'bearer', token: 'tok-123', expires_at: '2026-01-01T00:00:00Z'},
    });

    const [, args] = execFileMock.mock.calls[0] as [string, string[]];
    expect(args).toEqual(CLONE_ARGS);
    expect(args.join(' ')).not.toContain('tok-123');

    const {env} = optionsOf();
    expect(env.GIT_CONFIG_COUNT).toBe('1');
    expect(env.GIT_CONFIG_KEY_0).toBe('http.extraHeader');
    expect(env.GIT_CONFIG_VALUE_0).toBe('Authorization: Bearer tok-123');
  });

  it('keeps the basic token and its base64 form out of argv and injects via env', async () => {
    resolveExec();
    const base64 = Buffer.from('x-token:tok-123').toString('base64');

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
    expect(args).toEqual(CLONE_ARGS);
    expect(args.join(' ')).not.toContain('tok-123');
    expect(args.join(' ')).not.toContain(base64);

    expect(optionsOf().env.GIT_CONFIG_VALUE_0).toBe(`Authorization: Basic ${base64}`);
  });

  it('disables interactive credential prompts', async () => {
    resolveExec();

    await checkoutRepository(BASE);

    expect(optionsOf().env.GIT_TERMINAL_PROMPT).toBe('0');
  });
});

describe('checkoutRepository git env sanitization', () => {
  // Git reads injected config from GIT_CONFIG_COUNT/KEY_n/VALUE_n and GIT_CONFIG_PARAMETERS.
  // A hostile or stale host environment must not leak into the clone.
  const POISON: Record<string, string> = {
    GIT_CONFIG_COUNT: '2',
    GIT_CONFIG_KEY_0: 'core.sshCommand',
    GIT_CONFIG_VALUE_0: 'ssh -i /tmp/evil',
    GIT_CONFIG_KEY_1: 'http.proxy',
    GIT_CONFIG_VALUE_1: 'http://evil',
    GIT_CONFIG_PARAMETERS: "'core.pager=evil'",
  };
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const [key, value] of Object.entries(POISON)) {
      saved[key] = process.env[key];
      process.env[key] = value;
    }
  });

  afterEach(() => {
    for (const key of Object.keys(POISON)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('strips inherited GIT_CONFIG_* and GIT_CONFIG_PARAMETERS, keeping only our injected pair', async () => {
    resolveExec();

    await checkoutRepository({
      ...BASE,
      auth: {kind: 'bearer', token: 'tok-123', expires_at: '2026-01-01T00:00:00Z'},
    });

    const {env} = optionsOf();
    expect(env.GIT_CONFIG_COUNT).toBe('1');
    expect(env.GIT_CONFIG_KEY_0).toBe('http.extraHeader');
    expect(env.GIT_CONFIG_VALUE_0).toBe('Authorization: Bearer tok-123');
    expect(env.GIT_CONFIG_KEY_1).toBeUndefined();
    expect(env.GIT_CONFIG_VALUE_1).toBeUndefined();
    expect(env.GIT_CONFIG_PARAMETERS).toBeUndefined();
  });

  it('strips inherited git config-injection env on the no-auth path too', async () => {
    resolveExec();

    await checkoutRepository(BASE);

    const {env} = optionsOf();
    expect(env.GIT_CONFIG_COUNT).toBeUndefined();
    expect(env.GIT_CONFIG_KEY_0).toBeUndefined();
    expect(env.GIT_CONFIG_PARAMETERS).toBeUndefined();
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

  it('redacts a basic credential that leaks into error.message when stderr is empty', async () => {
    const base64 = Buffer.from('x-token:tok-123').toString('base64');
    // Defense in depth: even if a credential reaches error.message (e.g. git echoing it back),
    // classifyCloneError scrubs it before the message rides into a logged step result.
    rejectExec(
      Object.assign(new Error(`Command failed: git clone with Basic ${base64}`), {stderr: ''}),
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
    const raw = Object.assign(new Error('Command failed: git clone with Bearer tok-123'), {
      stderr: 'fatal: Authentication failed',
    });
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

describe('assertGitAvailable', () => {
  it.each([
    'git version 2.39.2',
    'git version 2.31.0',
    'git version 2.39.5 (Apple Git-154)',
    'git version 2.45.1.windows.1',
  ])('resolves for git >= 2.31 (%s)', async (stdout) => {
    resolveExecWith(stdout);

    await expect(assertGitAvailable()).resolves.toBeUndefined();
  });

  it.each([
    'git version 2.30.9',
    'git version 2.20.1',
    'git version 1.9.5',
  ])('rejects git older than 2.31 (%s)', async (stdout) => {
    resolveExecWith(stdout);

    const error = await assertGitAvailable().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(GitUnavailableError);
    expect((error as Error).message).toContain('2.31');
  });

  it('rejects when git is not on PATH', async () => {
    rejectExec(Object.assign(new Error('spawn git ENOENT'), {code: 'ENOENT'}));

    const error = await assertGitAvailable().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(GitUnavailableError);
    expect((error as Error).cause).toBeDefined();
  });

  it('fails closed when the version output is unparseable', async () => {
    resolveExecWith('not a version string');

    const error = await assertGitAvailable().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(GitUnavailableError);
    expect((error as Error).message).toContain('2.31');
  });

  it('bounds and sanitizes hostile version output in the error message', async () => {
    // Control bytes (NUL, BEL, ESC) built programmatically so the source carries no literal
    // control characters; a wrapper `git` could emit these on its --version line.
    const controls = String.fromCharCode(0, 7, 27);
    const hostile = `git version ${controls}garbage ${'A'.repeat(200)}`;
    resolveExecWith(hostile);

    const error = await assertGitAvailable().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(GitUnavailableError);
    const message = (error as Error).message;
    for (const code of [0, 7, 27]) {
      expect(message).not.toContain(String.fromCharCode(code));
    }
    // The embedded snippet is bounded, so a 200-char run cannot flood the logged step error.
    expect(message).not.toContain('A'.repeat(120));
  });
});
