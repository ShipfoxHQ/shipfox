import {HTTPError, TimeoutError} from 'ky';
import {config} from '#config.js';
import type {ClickUpIntegrationProviderError} from '#core/errors.js';
import {createClickUpAgentToolsClient, createClickUpApiClient, mapClickUpError} from './client.js';

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
  delete: vi.fn(),
  warn: vi.fn(),
}));

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
  return {
    default: Object.assign(mocks.request, {
      get: mocks.get,
      post: mocks.post,
      delete: mocks.delete,
    }),
    HTTPError: MockHTTPError,
    TimeoutError: MockTimeoutError,
  };
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

function resolvesResponse(body: unknown, status = 200) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: {'content-type': 'application/json'},
  });
}

function resolvesJson(data: unknown) {
  return {json: () => Promise.resolve(data)};
}

beforeEach(() => {
  mocks.request.mockReset();
  mocks.get.mockReset();
  mocks.post.mockReset();
  mocks.delete.mockReset();
  mocks.warn.mockReset();
});

describe('ClickUp API client', () => {
  it('exchanges a code and reads authorized workspaces and user', async () => {
    mocks.post.mockReturnValue(resolvesJson({access_token: 'access-token'}));
    mocks.get
      .mockReturnValueOnce(resolvesJson({teams: [{id: 123, name: 'Acme'}]}))
      .mockReturnValueOnce(
        resolvesJson({user: {id: 456, username: 'ada', email: 'ada@example.test'}}),
      );

    const client = createClickUpApiClient();

    await expect(client.exchangeAuthorizationCode({code: 'grant-code'})).resolves.toEqual({
      accessToken: 'access-token',
    });
    await expect(client.getAuthorizedWorkspaces({accessToken: 'access-token'})).resolves.toEqual([
      {id: '123', name: 'Acme'},
    ]);
    await expect(client.getAuthorizedUser({accessToken: 'access-token'})).resolves.toEqual({
      id: '456',
      username: 'ada',
      email: 'ada@example.test',
    });

    expect(mocks.post).toHaveBeenCalledWith(
      'https://api.clickup.com/api/v2/oauth/token',
      expect.objectContaining({
        json: {
          client_id: 'test-client-id',
          client_secret: 'test-client-secret',
          code: 'grant-code',
        },
      }),
    );
    expect(mocks.get).toHaveBeenNthCalledWith(
      1,
      'https://api.clickup.com/api/v2/team',
      expect.objectContaining({headers: {authorization: 'Bearer access-token'}}),
    );
  });

  it('creates and deletes a workspace-wide webhook with the curated event list', async () => {
    mocks.post.mockReturnValue(
      resolvesJson({webhook: {id: 'webhook-1', secret: 'webhook-secret'}}),
    );
    mocks.delete.mockResolvedValue(new Response(null, {status: 200}));

    const client = createClickUpApiClient();
    await expect(
      client.createWebhook({
        accessToken: 'access-token',
        teamId: 'team-1',
        endpoint: 'https://shipfox.example.test/webhooks/connection-1',
      }),
    ).resolves.toEqual({id: 'webhook-1', secret: 'webhook-secret'});
    await expect(
      client.deleteWebhook({accessToken: 'access-token', webhookId: 'webhook-1'}),
    ).resolves.toBeUndefined();

    expect(mocks.post).toHaveBeenCalledWith(
      'https://api.clickup.com/api/v2/team/team-1/webhook',
      expect.objectContaining({
        headers: {authorization: 'Bearer access-token'},
        json: {
          endpoint: 'https://shipfox.example.test/webhooks/connection-1',
          events: [
            'taskCreated',
            'taskUpdated',
            'taskDeleted',
            'taskMoved',
            'taskStatusUpdated',
            'taskAssigneeUpdated',
            'taskPriorityUpdated',
            'taskDueDateUpdated',
            'taskTagUpdated',
            'taskCommentPosted',
            'taskCommentUpdated',
          ],
        },
      }),
    );
    expect(mocks.delete).toHaveBeenCalledWith(
      'https://api.clickup.com/api/v2/webhook/webhook-1',
      expect.objectContaining({headers: {authorization: 'Bearer access-token'}}),
    );
  });

  it('logs ClickUp error details for webhook failures', async () => {
    const providerError = new HTTPError(
      new Response(JSON.stringify({err: 'Webhook limit reached', ECODE: 'WEBHOOK_001'}), {
        status: 400,
        headers: {'content-type': 'application/json'},
      }),
      new Request('https://clickup.example.test'),
      {} as never,
    );
    mocks.post.mockReturnValue({json: () => Promise.reject(providerError)});

    await expect(
      createClickUpApiClient().createWebhook({
        accessToken: 'access-token',
        teamId: 'team-1',
        endpoint: 'https://shipfox.example.test/webhooks/connection-1',
      }),
    ).rejects.toMatchObject({reason: 'provider-rejected'});
    expect(mocks.warn).toHaveBeenCalledWith(
      expect.objectContaining({err: 'Webhook limit reached', ECODE: 'WEBHOOK_001'}),
      'ClickUp API request rejected',
    );
  });

  it('maps a null token response to a malformed-provider-response error', async () => {
    mocks.post.mockReturnValue(resolvesJson(null));

    await expect(
      createClickUpApiClient().exchangeAuthorizationCode({code: 'grant-code'}),
    ).rejects.toMatchObject({
      reason: 'malformed-provider-response',
    } satisfies Partial<ClickUpIntegrationProviderError>);
  });
});

describe('ClickUp agent-tools REST client', () => {
  it('sends a REST v2 request with the configured bearer token and array filters', async () => {
    mocks.request.mockResolvedValue(resolvesResponse({id: 'task-1', name: 'Task'}));

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
      {headers: Record<string, string>; retry: number; searchParams: URLSearchParams},
    ];
    expect(url).toBe(`${config.CLICKUP_API_BASE_URL}/api/v2/team/team-1/task`);
    expect(options.headers).toEqual({authorization: 'Bearer access-token'});
    expect(options.retry).toBe(0);
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

  it('leaves provider retry policy to the tool executor', async () => {
    mocks.request.mockRejectedValue(
      new HTTPError(
        new Response(null, {status: 500}),
        new Request('https://clickup.example.test'),
        {} as never,
      ),
    );

    const result = createClickUpAgentToolsClient().request({
      accessToken: 'access-token',
      teamId: 'team-1',
      method: 'PUT',
      path: '/task/task-1',
      operation: 'update_task',
    });

    await expect(result).rejects.toMatchObject({reason: 'provider-unavailable'});
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.request.mock.calls[0]?.[1]).toMatchObject({retry: 0});
  });
});

describe('ClickUp provider error mapping', () => {
  it.each([
    [400, 'provider-rejected'],
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
