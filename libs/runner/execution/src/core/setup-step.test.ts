import {HTTPError} from 'ky';

const requestCheckoutTokenMock = vi.fn();
const assertGitAvailableMock = vi.fn();
const createJobDirMock = vi.fn();
const checkoutRepositoryMock = vi.fn();

vi.mock('@shipfox/runner-protocol', () => ({
  requestCheckoutToken: (...args: unknown[]) => requestCheckoutTokenMock(...args),
  HTTPError,
}));

// CheckoutError is a real class (setup-step branches on instanceof), so keep the actual
// implementation and only stub the side-effecting functions.
vi.mock('@shipfox/runner-workspace', async () => {
  const actual = await vi.importActual<typeof import('@shipfox/runner-workspace')>(
    '@shipfox/runner-workspace',
  );
  return {
    ...actual,
    assertGitAvailable: (...args: unknown[]) => assertGitAvailableMock(...args),
    createJobDir: (...args: unknown[]) => createJobDirMock(...args),
    checkoutRepository: (...args: unknown[]) => checkoutRepositoryMock(...args),
  };
});

const {executeSetupStep} = await import('#core/setup-step.js');
const {CheckoutError} = await import('@shipfox/runner-workspace');

const CWD = '/tmp/shipfox-test-root/job-1';
const leaseClient = {} as never;
const signal = new AbortController().signal;
const jobContext = {
  jobId: '00000000-0000-0000-0000-0000000000aa',
  runId: '00000000-0000-0000-0000-0000000000ab',
};

function checkoutResponse(auth?: unknown) {
  return {
    repository_url: 'https://github.com/acme/repo.git',
    ref: 'main',
    auth,
  };
}

function run(log?: ReturnType<typeof fakeLog>) {
  return executeSetupStep({cwd: CWD, leaseClient, signal, ...(log ? {log, jobContext} : {})});
}

function fakeLog() {
  return {
    writeGroup: vi.fn(),
    writeOutputLine: vi.fn(),
    write: vi.fn(),
    addSecrets: vi.fn(),
  };
}

// ky populates `error.data` with the pre-parsed body and consumes `error.response`, so
// the production classifier reads `error.data` — mirror that here rather than faking a
// re-readable `response.clone().json()`, which production can never do.
function httpError(status: number, body?: unknown): HTTPError {
  const response = {status} as unknown as Response;
  const error = new HTTPError(
    response,
    {} as Request,
    {} as ConstructorParameters<typeof HTTPError>[2],
  );
  error.data = body;
  return error;
}

beforeEach(() => {
  vi.clearAllMocks();
  assertGitAvailableMock.mockResolvedValue('git version 2.51.0');
  createJobDirMock.mockResolvedValue(undefined);
  requestCheckoutTokenMock.mockResolvedValue(checkoutResponse());
  checkoutRepositoryMock.mockResolvedValue('abc123');
});

describe('executeSetupStep', () => {
  it('prepares the workspace, checks out the repo, and succeeds', async () => {
    requestCheckoutTokenMock.mockResolvedValue(
      checkoutResponse({kind: 'bearer', token: 't', expires_at: '2026-01-01T00:00:00Z'}),
    );

    const result = await run();

    expect(assertGitAvailableMock).toHaveBeenCalledOnce();
    expect(createJobDirMock).toHaveBeenCalledWith(CWD);
    expect(requestCheckoutTokenMock).toHaveBeenCalledWith(leaseClient, {signal});
    expect(checkoutRepositoryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        repositoryUrl: 'https://github.com/acme/repo.git',
        ref: 'main',
        auth: {kind: 'bearer', token: 't', expires_at: '2026-01-01T00:00:00Z'},
        cwd: CWD,
        signal,
        onSecrets: expect.any(Function),
        onCommandStart: expect.any(Function),
      }),
    );
    expect(result).toEqual({success: true, error: null, exit_code: 0});
  });

  it('writes setup groups and the final checked-out commit', async () => {
    const log = fakeLog();

    const result = await run(log);

    expect(result.success).toBe(true);
    expect(log.writeGroup).toHaveBeenCalledWith({
      name: 'Job context',
      lines: [`job id: ${jobContext.jobId}`, `run id: ${jobContext.runId}`],
    });
    expect(log.writeGroup).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Runner environment',
        lines: expect.arrayContaining(['git: git version 2.51.0']),
      }),
    );
    expect(log.writeGroup).toHaveBeenCalledWith({
      name: 'Checkout complete',
      lines: ['checked-out commit: abc123'],
    });
    expect(log.writeOutputLine).toHaveBeenCalledWith('Setup completed successfully.');
  });

  it('routes checkout callbacks to the setup log sink', async () => {
    const log = fakeLog();

    await run(log);
    const [{onSecrets, onCommandStart, onOutput}] = checkoutRepositoryMock.mock.calls[0] as [
      {
        onSecrets: (secrets: string[]) => void;
        onCommandStart: (metadata: {phase: 'fetch'; command: string; cwd: string}) => void;
        onOutput: (chunk: Buffer, source: 'stdout') => void;
      },
    ];
    onSecrets(['tok-123']);
    onCommandStart({phase: 'fetch', command: 'git fetch origin main', cwd: CWD});
    onOutput(Buffer.from('remote output'), 'stdout');

    expect(log.addSecrets).toHaveBeenCalledWith(['tok-123']);
    expect(log.writeGroup).toHaveBeenCalledWith({
      name: 'Checkout fetch',
      lines: ['git fetch origin main', `working-directory: ${CWD}`],
    });
    expect(log.write).toHaveBeenCalledWith(Buffer.from('remote output'), 'stdout');
  });

  it('checks git before minting a credential', async () => {
    assertGitAvailableMock.mockRejectedValue(new Error('git is not available on the runner host'));

    const result = await run();

    expect(requestCheckoutTokenMock).not.toHaveBeenCalled();
    expect(createJobDirMock).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error?.reason).toBe('git_unavailable');
  });

  it('reports workspace_prep_failed when creating the directory fails', async () => {
    createJobDirMock.mockRejectedValue(new Error('mkdir denied'));

    const result = await run();

    expect(requestCheckoutTokenMock).not.toHaveBeenCalled();
    expect(result.error).toEqual({message: 'mkdir denied', reason: 'workspace_prep_failed'});
  });

  it.each([
    {status: 401, reason: 'checkout_auth_failed'},
    {status: 403, reason: 'checkout_auth_failed'},
    {status: 429, reason: 'checkout_unavailable'},
    {status: 503, reason: 'checkout_unavailable'},
    {status: 404, reason: 'checkout_failed'},
    {status: 409, reason: 'checkout_failed'},
    {status: 422, reason: 'checkout_failed'},
  ])('maps a $status checkout-token error to $reason', async ({status, reason}) => {
    requestCheckoutTokenMock.mockRejectedValue(httpError(status));

    const result = await run();

    expect(checkoutRepositoryMock).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error?.reason).toBe(reason);
  });

  it.each([
    {code: 'access-denied', reason: 'checkout_auth_failed'},
    {code: 'rate-limited', reason: 'checkout_unavailable'},
    {code: 'provider-unavailable', reason: 'checkout_unavailable'},
  ])('maps a 422 with code $code to $reason', async ({code, reason}) => {
    requestCheckoutTokenMock.mockRejectedValue(httpError(422, {code}));

    const result = await run();

    expect(result.error?.reason).toBe(reason);
  });

  it('maps a non-HTTP checkout-token error to checkout_failed', async () => {
    requestCheckoutTokenMock.mockRejectedValue(new Error('socket hang up'));

    const result = await run();

    expect(result.error).toEqual({message: 'socket hang up', reason: 'checkout_failed'});
  });

  it.each([
    {kind: 'auth' as const, reason: 'checkout_auth_failed'},
    {kind: 'unavailable' as const, reason: 'checkout_unavailable'},
    {kind: 'failed' as const, reason: 'checkout_failed'},
    {kind: 'aborted' as const, reason: 'setup_aborted'},
  ])('maps a $kind checkout failure to $reason', async ({kind, reason}) => {
    checkoutRepositoryMock.mockRejectedValue(new CheckoutError(kind, 'boom'));

    const result = await run();

    expect(result.success).toBe(false);
    expect(result.error?.reason).toBe(reason);
  });

  it('logs the checkout phase that failed', async () => {
    const log = fakeLog();
    checkoutRepositoryMock.mockRejectedValue(
      new CheckoutError('failed', 'remote rejected', {phase: 'fetch'}),
    );

    const result = await run(log);

    expect(result.error?.reason).toBe('checkout_failed');
    expect(log.writeOutputLine).toHaveBeenCalledWith(
      'Setup failed during checkout fetch: remote rejected',
      'stderr',
    );
  });

  it('maps an unexpected checkout error to checkout_failed', async () => {
    checkoutRepositoryMock.mockRejectedValue(new Error('weird'));

    const result = await run();

    expect(result.error).toEqual({message: 'weird', reason: 'checkout_failed'});
  });
});
