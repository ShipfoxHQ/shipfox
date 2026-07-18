import {HTTPError, TimeoutError} from 'ky';
import {
  SlackEnterpriseInstallUnsupportedError,
  SlackIntegrationProviderError,
} from '#core/errors.js';
import {createSlackApiClient} from './client.js';

const mocks = vi.hoisted(() => ({post: vi.fn(), warn: vi.fn()}));

vi.mock('@shipfox/node-opentelemetry', () => ({logger: () => ({warn: mocks.warn})}));
vi.mock('ky', () => {
  class HTTPError extends Error {
    constructor(public response: {status: number; statusText?: string; headers: Headers}) {
      super('http');
      this.name = 'HTTPError';
    }
  }
  class TimeoutError extends Error {
    constructor() {
      super('timeout');
      this.name = 'TimeoutError';
    }
  }
  return {default: {post: mocks.post}, HTTPError, TimeoutError};
});

function resolves(data: unknown) {
  return {json: () => Promise.resolve(data)};
}

function rejects(error: unknown) {
  return {json: () => Promise.reject(error)};
}

function httpError(status: number, headers: Record<string, string> = {}): HTTPError {
  return new HTTPError(
    {status, statusText: 'Rejected', headers: new Headers(headers)} as never,
    {} as never,
    {} as never,
  );
}

function oauthSuccess(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    access_token: 'xoxb-token',
    bot_user_id: 'U123',
    app_id: 'A123',
    team: {id: 'T123', name: 'Acme'},
    scope: 'app_mentions:read,chat:write',
    ...overrides,
  };
}

describe('createSlackApiClient', () => {
  beforeEach(() => {
    mocks.post.mockReset();
    mocks.warn.mockReset();
  });

  it('posts a form-encoded OAuth exchange and parses the Slack installation', async () => {
    mocks.post.mockReturnValue(resolves(oauthSuccess()));

    const result = await createSlackApiClient().exchangeAuthorizationCode({code: 'oauth-code'});

    const [url, options] = mocks.post.mock.calls[0] as [string, {body: URLSearchParams}];
    expect(url).toBe('http://127.0.0.1:0/oauth.v2.access');
    expect(options.body).toEqual(
      new URLSearchParams({
        client_id: 'test-client-id',
        client_secret: 'test-client-secret',
        code: 'oauth-code',
        redirect_uri: 'https://shipfox.example.com/integrations/slack/callback',
      }),
    );
    expect(result).toEqual({
      accessToken: 'xoxb-token',
      botUserId: 'U123',
      appId: 'A123',
      teamId: 'T123',
      teamName: 'Acme',
      scopes: ['app_mentions:read', 'chat:write'],
    });
  });

  it.each([
    ['invalid_code', 'access-denied'],
    ['service_unavailable', 'provider-unavailable'],
    ['ratelimited', 'rate-limited'],
  ])('maps Slack application error %s to %s', async (error, reason) => {
    mocks.post.mockReturnValue(resolves({ok: false, error}));

    const result = createSlackApiClient().exchangeAuthorizationCode({code: 'oauth-code'});

    await expect(result).rejects.toMatchObject({reason});
  });

  it.each([
    oauthSuccess({is_enterprise_install: true}),
    oauthSuccess({team: null}),
  ])('rejects unsupported Enterprise Grid installs', async (body) => {
    mocks.post.mockReturnValue(resolves(body));

    const result = createSlackApiClient().exchangeAuthorizationCode({code: 'oauth-code'});

    await expect(result).rejects.toBeInstanceOf(SlackEnterpriseInstallUnsupportedError);
  });

  it.each([
    [rejects(httpError(503)), 'provider-unavailable'],
    [rejects(httpError(403)), 'access-denied'],
    [rejects(new TimeoutError({} as never)), 'timeout'],
  ])('maps transport failures without leaking OAuth secrets', async (response, reason) => {
    mocks.post.mockReturnValue(response);

    const error = await createSlackApiClient()
      .exchangeAuthorizationCode({code: 'super-secret-code'})
      .catch((thrown: unknown) => thrown);

    expect(error).toMatchObject({reason});
    expect(JSON.stringify([error, mocks.warn.mock.calls])).not.toContain('super-secret-code');
    expect(JSON.stringify([error, mocks.warn.mock.calls])).not.toContain('test-client-secret');
  });

  it('rejects malformed success payloads', async () => {
    mocks.post.mockReturnValue(resolves(oauthSuccess({access_token: undefined})));

    const result = createSlackApiClient().exchangeAuthorizationCode({code: 'oauth-code'});

    await expect(result).rejects.toBeInstanceOf(SlackIntegrationProviderError);
    await expect(result).rejects.toMatchObject({reason: 'malformed-provider-response'});
  });

  it('revokes with a bearer token and never logs it', async () => {
    mocks.post.mockResolvedValue(undefined);

    await createSlackApiClient().revokeToken({token: 'secret-token'});

    expect(mocks.post).toHaveBeenCalledWith('http://127.0.0.1:0/auth.revoke', {
      headers: {authorization: 'Bearer secret-token'},
      timeout: 10_000,
    });
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain('secret-token');
  });
});
