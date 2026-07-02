import {type ApiFetch, createApiClient, type E2eApiError} from './client.js';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return Response.json(body, init);
}

describe('createApiClient', () => {
  test('builds URLs from the configured API URL and sends the bearer token', async () => {
    let input: URL | undefined;
    let init: RequestInit | undefined;
    const fetchImpl: ApiFetch = (url, requestInit) => {
      input = url;
      init = requestInit;
      return jsonResponse({ok: true});
    };
    const client = createApiClient({
      apiUrl: 'https://api.example.test/base/',
      fetch: fetchImpl,
      token: 'user-token',
    });

    const result = await client.requestJson<{ok: boolean}>('get', '/workflows/runs?limit=1');

    expect(result).toEqual({ok: true});
    expect(input?.toString()).toBe('https://api.example.test/workflows/runs?limit=1');
    expect(init?.method).toBe('GET');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer user-token');
  });

  test('serializes JSON bodies', async () => {
    let init: RequestInit | undefined;
    const fetchImpl: ApiFetch = (_url, requestInit) => {
      init = requestInit;
      return jsonResponse({ok: true});
    };
    const client = createApiClient({fetch: fetchImpl, token: 'user-token'});

    await client.requestJson('post', '/workflow-definitions/id/fire-manual', {
      json: {inputs: {name: 'Ada'}},
    });

    expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
    expect(init?.body).toBe(JSON.stringify({inputs: {name: 'Ada'}}));
  });

  test('wraps non-2xx responses with parsed details', async () => {
    const client = createApiClient({
      fetch: async () => jsonResponse({code: 'not-found'}, {status: 404}),
      token: 'user-token',
    });

    await expect(client.requestJson('get', '/workflows/runs/nope')).rejects.toMatchObject({
      name: 'E2eApiError',
      message: 'E2E API request failed for GET /workflows/runs/nope: 404',
      status: 404,
      details: {code: 'not-found'},
    } satisfies Partial<E2eApiError>);
  });

  test('wraps fetch failures with request context', async () => {
    const client = createApiClient({
      fetch: () => {
        throw new Error('socket closed');
      },
      token: 'user-token',
    });

    await expect(client.requestJson('get', '/definitions?limit=1')).rejects.toMatchObject({
      name: 'E2eApiError',
      message: 'E2E API request failed for GET /definitions?limit=1: socket closed',
      status: 0,
    } satisfies Partial<E2eApiError>);
  });

  test('passes abort signals to fetch', async () => {
    let signal: AbortSignal | null | undefined;
    const controller = new AbortController();
    const client = createApiClient({
      fetch: (_url, requestInit) => {
        signal = requestInit?.signal;
        return jsonResponse({ok: true});
      },
      token: 'user-token',
    });

    await client.requestJson('get', '/definitions', {signal: controller.signal});

    expect(signal).toBe(controller.signal);
  });

  test('does not wrap fetch abort errors', async () => {
    const abortError = new DOMException('Cancelled', 'AbortError');
    const client = createApiClient({
      fetch: () => {
        throw abortError;
      },
      token: 'user-token',
    });

    await expect(client.requestJson('get', '/definitions')).rejects.toBe(abortError);
  });
});
