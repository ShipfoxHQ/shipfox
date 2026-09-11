import {HTTPError} from 'ky';
import type {ClickUpIntegrationProviderError} from '#core/errors.js';
import {createClickUpApiClient, mapClickUpError} from './client.js';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
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
    default: {get: mocks.get, post: mocks.post},
    HTTPError: MockHTTPError,
    TimeoutError: MockTimeoutError,
  };
});

function resolves(data: unknown) {
  return {json: () => Promise.resolve(data)};
}

function rejectedRequest(status: number, headers?: Record<string, string>): () => Promise<never> {
  return () => {
    const response = new Response(null, {status, ...(headers === undefined ? {} : {headers})});
    const error = new HTTPError(response, new Request('https://clickup.example.test'), {} as never);
    return Promise.reject(error);
  };
}

describe('ClickUp API client', () => {
  beforeEach(() => {
    mocks.get.mockReset();
    mocks.post.mockReset();
    mocks.warn.mockReset();
  });

  it('exchanges a code and reads authorized workspaces and user', async () => {
    mocks.post.mockReturnValue(resolves({access_token: 'access-token'}));
    mocks.get
      .mockReturnValueOnce(resolves({teams: [{id: 123, name: 'Acme'}]}))
      .mockReturnValueOnce(resolves({user: {id: 456, username: 'ada', email: 'ada@example.test'}}));

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

  it.each([
    [401, 'access-denied'],
    [403, 'access-denied'],
    [429, 'rate-limited'],
    [500, 'provider-unavailable'],
    [400, 'malformed-provider-response'],
  ] as const)('maps HTTP %i to %s', async (status, reason) => {
    const result = mapClickUpError(
      'test',
      rejectedRequest(status, status === 429 ? {'x-ratelimit-reset': '2000000000'} : undefined),
    );

    await expect(result).rejects.toMatchObject({
      reason,
    } satisfies Partial<ClickUpIntegrationProviderError>);
  });

  it('maps the rate-limit reset epoch to retry seconds', async () => {
    const now = Math.floor(Date.now() / 1000);
    await expect(
      mapClickUpError('test', rejectedRequest(429, {'x-ratelimit-reset': String(now + 15)})),
    ).rejects.toMatchObject({reason: 'rate-limited', retryAfterSeconds: 15});
  });
});
