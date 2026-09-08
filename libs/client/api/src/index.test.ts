import {z} from 'zod';
import * as clientApi from './index.js';
import {
  ADOPTED_SESSION_ENDED_CODE,
  ADOPTED_SESSION_PAUSED_CODE,
  ApiError,
  checkedApiRequest,
  configureApiClient,
  createAdoptedSessionEndedError,
  createAdoptedSessionPausedError,
  getErrorCode,
  isErrorWithCode,
  isInvalidApiResponseError,
  resetApiClient,
  resolveApiUrl,
} from './index.js';

function transportRequest<T>(path: string, options: Parameters<typeof checkedApiRequest>[2] = {}) {
  return checkedApiRequest(z.unknown(), path, options) as Promise<T>;
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: {'content-type': 'application/json'},
    status: 200,
    ...init,
  });
}

describe('checked API transport', () => {
  test.each([
    ['https://api.example.test', 'https://api.example.test/mcp'],
    ['https://api.example.test/proxy/', 'https://api.example.test/proxy/mcp'],
    ['', '/mcp'],
  ])('resolves MCP URLs with API base %s', (baseUrl, expected) => {
    configureApiClient({baseUrl});

    expect(resolveApiUrl('/mcp')).toBe(expected);
  });
  beforeEach(() => {
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: undefined,
      getAccessToken: undefined,
      prepareAccessToken: undefined,
      refreshAccessToken: undefined,
    });
  });

  test('does not expose the raw transport primitive from the public client surface', () => {
    expect('apiRequest' in clientApi).toBe(false);
  });

  test('preserves the native fetch receiver', async () => {
    const originalFetch = globalThis.fetch;
    let receiver: unknown;
    globalThis.fetch = vi.fn(function (this: unknown) {
      receiver = this;
      return Promise.resolve(jsonResponse({ok: true}));
    }) as typeof fetch;

    try {
      const result = await transportRequest<{ok: boolean}>('/auth/refresh', {method: 'POST'});

      expect(result.ok).toBe(true);
      expect(receiver).toBe(globalThis);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('sends credentials and bearer token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ok: true}));
    configureApiClient({fetchImpl, getAccessToken: () => 'access-token'});

    const result = await transportRequest<{ok: boolean}>('/auth/refresh', {method: 'POST'});

    expect(result.ok).toBe(true);
    const request = fetchImpl.mock.calls[0]?.[0] as Request;
    expect(request.url).toBe('https://api.example.test/auth/refresh');
    expect(request.credentials).toBe('include');
    expect(request.method).toBe('POST');
    expect(request.headers.get('authorization')).toBe('Bearer access-token');
  });

  test('normalizes json API errors', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({message: 'Invalid credentials', code: 'invalid-credentials'}, {status: 401}),
      );
    configureApiClient({fetchImpl});

    const result = transportRequest('/auth/login', {method: 'POST'});

    await expect(result).rejects.toMatchObject({
      code: 'invalid-credentials',
      message: 'Invalid credentials',
      status: 401,
    });
  });

  test('refreshes and retries authenticated 401s once', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({message: 'Unauthorized', code: 'unauthorized'}, {status: 401}),
      )
      .mockResolvedValueOnce(jsonResponse({ok: true}));
    const refreshAccessToken = vi.fn().mockResolvedValue('fresh-token');
    configureApiClient({
      fetchImpl,
      getAccessToken: () => 'expired-token',
      refreshAccessToken,
    });

    const result = await transportRequest<{ok: boolean}>('/workspaces');

    expect(result.ok).toBe(true);
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    const firstRequest = fetchImpl.mock.calls[0]?.[0] as Request;
    const secondRequest = fetchImpl.mock.calls[1]?.[0] as Request;
    expect(firstRequest.headers.get('authorization')).toBe('Bearer expired-token');
    expect(secondRequest.headers.get('authorization')).toBe('Bearer fresh-token');
  });

  test('prepares configured access tokens asynchronously before sending them', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ok: true}));
    const signal = new AbortController().signal;
    const getAccessToken = vi.fn().mockReturnValue('configured-token');
    const prepareAccessToken = vi.fn().mockResolvedValue('prepared-token');
    configureApiClient({fetchImpl, getAccessToken, prepareAccessToken});

    await transportRequest('/workspaces', {signal});

    expect(getAccessToken).toHaveBeenCalledOnce();
    expect(prepareAccessToken).toHaveBeenCalledWith({
      accessToken: 'configured-token',
      signal,
    });
    const request = fetchImpl.mock.calls[0]?.[0] as Request;
    expect(request.headers.get('authorization')).toBe('Bearer prepared-token');
  });

  test('routes a 401 retry through prepared access tokens instead of the legacy refresh hook', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({message: 'Unauthorized', code: 'unauthorized'}, {status: 401}),
      )
      .mockResolvedValueOnce(jsonResponse({ok: true}));
    const prepareAccessToken = vi
      .fn()
      .mockResolvedValueOnce('expired-target-token')
      .mockResolvedValueOnce('renewed-target-token');
    const refreshAccessToken = vi.fn().mockResolvedValue('administrator-token');
    configureApiClient({
      fetchImpl,
      getAccessToken: () => 'configured-token',
      prepareAccessToken,
      refreshAccessToken,
    });

    const result = await transportRequest<{ok: boolean}>('/workspaces');

    expect(result.ok).toBe(true);
    expect(refreshAccessToken).not.toHaveBeenCalled();
    expect(prepareAccessToken).toHaveBeenNthCalledWith(2, {
      accessToken: 'expired-target-token',
      signal: undefined,
    });
    const firstRequest = fetchImpl.mock.calls[0]?.[0] as Request;
    const secondRequest = fetchImpl.mock.calls[1]?.[0] as Request;
    expect(firstRequest.headers.get('authorization')).toBe('Bearer expired-target-token');
    expect(secondRequest.headers.get('authorization')).toBe('Bearer renewed-target-token');
  });

  test('preserves an unauthorized error when preparing a retry token fails', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({message: 'Unauthorized', code: 'unauthorized'}, {status: 401}),
      );
    const prepareAccessToken = vi
      .fn()
      .mockResolvedValueOnce('expired-target-token')
      .mockRejectedValueOnce(new Error('renewal failed'));
    const refreshAccessToken = vi.fn().mockResolvedValue('administrator-token');
    configureApiClient({
      fetchImpl,
      getAccessToken: () => 'configured-token',
      prepareAccessToken,
      refreshAccessToken,
    });

    const result = transportRequest('/workspaces');

    await expect(result).rejects.toMatchObject({code: 'unauthorized', status: 401});
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(refreshAccessToken).not.toHaveBeenCalled();
    const request = fetchImpl.mock.calls[0]?.[0] as Request;
    expect(request.headers.get('authorization')).toBe('Bearer expired-target-token');
  });

  test('does not prepare, replace, or retry an explicit caller authorization header', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({message: 'Unauthorized', code: 'unauthorized'}, {status: 401}),
      );
    const getAccessToken = vi.fn().mockReturnValue('adopted-token');
    const prepareAccessToken = vi.fn().mockResolvedValue('prepared-token');
    const refreshAccessToken = vi.fn().mockResolvedValue('refreshed-token');
    configureApiClient({fetchImpl, getAccessToken, prepareAccessToken, refreshAccessToken});

    const result = transportRequest('/admin/continue', {
      headers: {authorization: 'Bearer administrator-token'},
    });

    await expect(result).rejects.toMatchObject({code: 'unauthorized', status: 401});
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(getAccessToken).toHaveBeenCalledOnce();
    expect(prepareAccessToken).not.toHaveBeenCalled();
    expect(refreshAccessToken).not.toHaveBeenCalled();
    const request = fetchImpl.mock.calls[0]?.[0] as Request;
    expect(request.headers.get('authorization')).toBe('Bearer administrator-token');
  });

  test('cookie-only requests use cookies without reading or preparing a configured bearer', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({message: 'Unauthorized', code: 'unauthorized'}, {status: 401}),
      );
    const getAccessToken = vi.fn().mockReturnValue('adopted-token');
    const prepareAccessToken = vi.fn().mockResolvedValue('prepared-token');
    const refreshAccessToken = vi.fn().mockResolvedValue('refreshed-token');
    configureApiClient({fetchImpl, getAccessToken, prepareAccessToken, refreshAccessToken});

    const result = transportRequest('/auth/refresh', {
      method: 'POST',
      authentication: 'cookie-only',
    });

    await expect(result).rejects.toMatchObject({code: 'unauthorized', status: 401});
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(prepareAccessToken).not.toHaveBeenCalled();
    expect(refreshAccessToken).not.toHaveBeenCalled();
    const request = fetchImpl.mock.calls[0]?.[0] as Request;
    expect(request.credentials).toBe('include');
    expect(request.headers.get('authorization')).toBeNull();
  });

  test('rejects cookie-only requests that include an explicit authorization header', async () => {
    const fetchImpl = vi.fn();
    const getAccessToken = vi.fn().mockReturnValue('adopted-token');
    const prepareAccessToken = vi.fn().mockResolvedValue('prepared-token');
    configureApiClient({fetchImpl, getAccessToken, prepareAccessToken});

    const result = transportRequest('/auth/refresh', {
      authentication: 'cookie-only',
      headers: {Authorization: 'Bearer administrator-token'},
    });

    await expect(result).rejects.toMatchObject({code: 'invalid-request', status: 0});
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(prepareAccessToken).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('does not refresh unauthenticated 401s', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({message: 'Invalid credentials', code: 'invalid-credentials'}, {status: 401}),
      );
    const refreshAccessToken = vi.fn().mockResolvedValue('fresh-token');
    configureApiClient({fetchImpl, refreshAccessToken});

    const result = transportRequest('/auth/login', {method: 'POST'});

    await expect(result).rejects.toMatchObject({
      code: 'invalid-credentials',
      status: 401,
    });
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  test('normalizes network failures', async () => {
    configureApiClient({fetchImpl: vi.fn().mockRejectedValue(new Error('offline'))});

    const result = transportRequest('/auth/login', {method: 'POST'});

    await expect(result).rejects.toBeInstanceOf(ApiError);
    await expect(result).rejects.toMatchObject({code: 'network-error', status: 0});
  });

  test('creates safe adopted-session gate errors', () => {
    const paused = createAdoptedSessionPausedError();
    const ended = createAdoptedSessionEndedError('manual-stop');
    const unsafeEnded = createAdoptedSessionEndedError('administrator-token');

    expect(paused).toMatchObject({
      code: ADOPTED_SESSION_PAUSED_CODE,
      message: 'Adopted session renewal is paused.',
      status: 0,
      details: undefined,
    });
    expect(ended).toMatchObject({
      code: ADOPTED_SESSION_ENDED_CODE,
      message: 'The adopted session has ended.',
      status: 0,
      details: {reason: 'manual-stop'},
    });
    expect(unsafeEnded.details).toBeUndefined();
    expect(JSON.stringify(unsafeEnded)).not.toContain('administrator-token');
  });

  test('matches error codes', () => {
    const error = new ApiError({message: 'Nope', code: 'nope', status: 400});

    const code = getErrorCode(error);
    const matches = isErrorWithCode(error, 'nope');

    expect(code).toBe('nope');
    expect(matches).toBe(true);
  });
});

describe('resetApiClient', () => {
  test('drops previously configured base url, auth, and fetch override', async () => {
    const staleFetch = vi.fn().mockResolvedValue(jsonResponse({ok: true}));
    configureApiClient({
      baseUrl: 'https://stale.example.test',
      fetchImpl: staleFetch,
      getAccessToken: () => 'stale-token',
    });

    resetApiClient();

    const freshFetch = vi.fn().mockResolvedValue(jsonResponse({ok: true}));
    configureApiClient({baseUrl: 'https://fresh.example.test', fetchImpl: freshFetch});
    await transportRequest('/workspaces');

    expect(staleFetch).not.toHaveBeenCalled();
    const request = freshFetch.mock.calls[0]?.[0] as Request;
    expect(request.url).toBe('https://fresh.example.test/workspaces');
    expect(request.headers.get('authorization')).toBeNull();
  });
});

describe('checkedApiRequest', () => {
  test('returns the schema output', async () => {
    configureApiClient({fetchImpl: vi.fn().mockResolvedValue(jsonResponse({id: 'workspace-1'}))});
    const schema = z.object({id: z.string()});

    const result = await checkedApiRequest(schema, '/workspaces/workspace-1');

    expect(result).toEqual({id: 'workspace-1'});
  });

  test('accepts a Standard Schema success result with an undefined issues property', async () => {
    configureApiClient({fetchImpl: vi.fn().mockResolvedValue(jsonResponse({id: 'workspace-1'}))});
    const schema = {
      '~standard': {
        version: 1 as const,
        vendor: 'test',
        validate: (value: unknown) => ({value: value as {id: string}, issues: undefined}),
      },
    };

    const result = await checkedApiRequest(schema, '/workspaces/workspace-1');

    expect(result).toEqual({id: 'workspace-1'});
  });

  test('keeps invalid responses distinct from transport errors without retaining the payload', async () => {
    configureApiClient({
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse({secret: 'do-not-expose'})),
    });
    const schema = z.object({id: z.string()});

    const result = checkedApiRequest(schema, '/workspaces/workspace-1');

    await expect(result).rejects.toMatchObject({code: 'invalid-response'});
    await expect(result).rejects.not.toThrow('do-not-expose');
    await expect(result.catch(isInvalidApiResponseError)).resolves.toBe(true);
  });

  test('does not classify unrelated errors as invalid API responses', () => {
    const result = isInvalidApiResponseError(new Error('unrelated'));

    expect(result).toBe(false);
  });
});
