import {HTTPError, TimeoutError} from 'ky';
import {config} from '#config.js';
import type {ClickUpIntegrationProviderError} from '#core/errors.js';
import {createClickUpAgentToolsClient, mapClickUpError} from './client.js';

const mocks = vi.hoisted(() => ({request: vi.fn(), warn: vi.fn()}));

vi.mock('@shipfox/node-opentelemetry', () => ({
  logger: () => ({warn: mocks.warn}),
}));

vi.mock('ky', () => {
  class MockHTTPError extends Error {
    constructor(public response: Response) {
      super('http');
      this.name = 'HTTPError';
    }
  }
  class MockTimeoutError extends Error {
    constructor() {
      super('timeout');
      this.name = 'TimeoutError';
    }
  }
  return {default: mocks.request, HTTPError: MockHTTPError, TimeoutError: MockTimeoutError};
});

function rejectedRequest(
  status: number,
  headers: Record<string, string> = {},
): () => Promise<never> {
  return () =>
    Promise.reject(
      new HTTPError(
        new Response(null, {status, headers}),
        new Request('https://clickup.example.test'),
        {} as never,
      ),
    );
}

function resolves(body: unknown, status = 200) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: {'content-type': 'application/json'},
  });
}

describe('ClickUp agent-tools REST client', () => {
  beforeEach(() => {
    mocks.request.mockReset();
    mocks.warn.mockReset();
  });

  it('sends a REST v2 request with the configured bearer token and array filters', async () => {
    mocks.request.mockResolvedValue(resolves({id: 'task-1', name: 'Task'}));

    const result = await createClickUpAgentToolsClient().request({
      accessToken: 'access-token',
      teamId: 'team-1',
      method: 'GET',
      path: '/team/team-1/task',
      query: {'list_ids[]': ['list-1', 'list-2'], include_closed: false},
      operation: 'search_tasks',
    });

    expect(result).toEqual({status: 200, body: {id: 'task-1', name: 'Task'}});
    const [url, options] = mocks.request.mock.calls[0] as [
      string,
      {headers: Record<string, string>; searchParams: URLSearchParams},
    ];
    expect(url).toBe(`${config.CLICKUP_API_BASE_URL}/api/v2/team/team-1/task`);
    expect(options.headers).toEqual({authorization: 'Bearer access-token'});
    expect([...options.searchParams.entries()]).toEqual([
      ['list_ids[]', 'list-1'],
      ['list_ids[]', 'list-2'],
      ['include_closed', 'false'],
    ]);
  });

  it('returns ClickUp validation and not-found responses to the adapter', async () => {
    mocks.request.mockRejectedValue(
      new HTTPError(
        new Response(JSON.stringify({err: 'Invalid task', ECODE: 'TASK_001'}), {status: 400}),
        new Request('https://clickup.example.test'),
        {} as never,
      ),
    );

    await expect(
      createClickUpAgentToolsClient().request({
        accessToken: 'access-token',
        teamId: 'team-1',
        method: 'GET',
        path: '/task/bad',
        operation: 'get_task',
      }),
    ).resolves.toEqual({status: 400, body: {err: 'Invalid task', ECODE: 'TASK_001'}});
  });

  it.each([
    [401, 'access-denied'],
    [403, 'access-denied'],
    [429, 'rate-limited'],
    [500, 'provider-unavailable'],
  ] as const)('maps HTTP %i to %s', async (status, reason) => {
    const result = mapClickUpError(
      'test',
      rejectedRequest(status, {'x-ratelimit-reset': '9999999999'}),
    );

    await expect(result).rejects.toMatchObject({
      reason,
    } satisfies Partial<ClickUpIntegrationProviderError>);
  });

  it('maps rate limits from the provider reset timestamp', async () => {
    const now = 1_700_000_000_000;
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(now);

    try {
      const reset = Math.floor(now / 1000) + 19;
      const result = mapClickUpError(
        'test',
        rejectedRequest(429, {'x-ratelimit-reset': String(reset)}),
      );

      await expect(result).rejects.toMatchObject({reason: 'rate-limited', retryAfterSeconds: 19});
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('maps client timeouts to timeout errors', async () => {
    const result = mapClickUpError('test', () => Promise.reject(new TimeoutError({} as never)));

    await expect(result).rejects.toMatchObject({reason: 'timeout'});
  });
});
