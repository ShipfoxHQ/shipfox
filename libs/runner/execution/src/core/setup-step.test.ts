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

function checkoutResponse(auth?: unknown) {
  return {
    repository_url: 'https://github.com/acme/repo.git',
    ref: 'main',
    auth,
  };
}

function run() {
  return executeSetupStep({cwd: CWD, leaseClient, signal});
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
  assertGitAvailableMock.mockResolvedValue(undefined);
  createJobDirMock.mockResolvedValue(undefined);
  requestCheckoutTokenMock.mockResolvedValue(checkoutResponse());
  checkoutRepositoryMock.mockResolvedValue(undefined);
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
    expect(checkoutRepositoryMock).toHaveBeenCalledWith({
      repositoryUrl: 'https://github.com/acme/repo.git',
      ref: 'main',
      auth: {kind: 'bearer', token: 't', expires_at: '2026-01-01T00:00:00Z'},
      cwd: CWD,
      signal,
    });
    expect(result).toEqual({success: true, error: null, exit_code: 0});
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
  ])('maps a $kind clone failure to $reason', async ({kind, reason}) => {
    checkoutRepositoryMock.mockRejectedValue(new CheckoutError(kind, 'boom'));

    const result = await run();

    expect(result.success).toBe(false);
    expect(result.error?.reason).toBe(reason);
  });

  it('maps an unexpected clone error to checkout_failed', async () => {
    checkoutRepositoryMock.mockRejectedValue(new Error('weird'));

    const result = await run();

    expect(result.error).toEqual({message: 'weird', reason: 'checkout_failed'});
  });
});
