import {HTTPError, TimeoutError} from 'ky';
import {LinearIntegrationProviderError} from '#core/errors.js';
import {createLinearApiClient} from './client.js';

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('@shipfox/node-opentelemetry', () => ({
  logger: () => ({
    warn: mocks.warn,
  }),
}));

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

function httpError(
  status: number,
  headers: Record<string, string> = {},
  statusText = 'Rejected',
): HTTPError {
  return new HTTPError(
    {status, statusText, headers: new Headers(headers)} as never,
    {} as never,
    {} as never,
  );
}

describe('createLinearApiClient.exchangeAuthorizationCode', () => {
  beforeEach(() => {
    vi.useRealTimers();
    mocks.post.mockReset();
    mocks.warn.mockReset();
  });

  it('posts a form-encoded OAuth exchange and parses tokens, expiry, and scopes', async () => {
    vi.useFakeTimers({now: new Date('2026-07-07T12:00:00.000Z')});
    mocks.post.mockReturnValue(
      resolves({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        expires_in: 3600,
        scope: 'read write app:assignable',
      }),
    );
    const client = createLinearApiClient();

    const result = await client.exchangeAuthorizationCode({code: 'oauth-code'});

    const firstCall = mocks.post.mock.calls[0];
    expect(firstCall).toBeDefined();
    const [, options] = firstCall as [string, {body: URLSearchParams}];
    const body = options.body as URLSearchParams;
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('client_id')).toBe('test-client-id');
    expect(body.get('client_secret')).toBe('test-client-secret');
    expect(body.get('code')).toBe('oauth-code');
    expect(body.get('redirect_uri')).toBe(
      'https://shipfox.example.com/integrations/linear/callback',
    );
    expect(result).toEqual({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: new Date('2026-07-07T13:00:00.000Z'),
      scopes: ['read', 'write', 'app:assignable'],
    });
  });

  it('parses a long-lived token response without refresh or expiry', async () => {
    mocks.post.mockReturnValue(resolves({access_token: 'access-token', scope: ['read']}));
    const client = createLinearApiClient();

    const result = await client.exchangeAuthorizationCode({code: 'oauth-code'});

    expect(result).toEqual({
      accessToken: 'access-token',
      refreshToken: undefined,
      expiresAt: undefined,
      scopes: ['read'],
    });
  });

  it('maps a 429 to rate-limited with retry-after seconds', async () => {
    mocks.post.mockReturnValue(rejects(httpError(429, {'retry-after': '30'})));
    const client = createLinearApiClient();

    const result = client.exchangeAuthorizationCode({code: 'oauth-code'});

    await expect(result).rejects.toMatchObject({reason: 'rate-limited', retryAfterSeconds: 30});
    await expect(result).rejects.toBeInstanceOf(LinearIntegrationProviderError);
  });

  it('maps a 5xx to provider-unavailable', async () => {
    mocks.post.mockReturnValue(rejects(httpError(503)));
    const client = createLinearApiClient();

    const result = client.exchangeAuthorizationCode({code: 'oauth-code'});

    await expect(result).rejects.toMatchObject({reason: 'provider-unavailable'});
  });

  it('maps a 4xx to access-denied', async () => {
    mocks.post.mockReturnValue(rejects(httpError(403)));
    const client = createLinearApiClient();

    const result = client.exchangeAuthorizationCode({code: 'oauth-code'});

    await expect(result).rejects.toMatchObject({reason: 'access-denied'});
  });

  it('maps a timeout to timeout', async () => {
    mocks.post.mockReturnValue(rejects(new TimeoutError({} as never)));
    const client = createLinearApiClient();

    const result = client.exchangeAuthorizationCode({code: 'oauth-code'});

    await expect(result).rejects.toMatchObject({reason: 'timeout'});
  });

  it('maps a response without an access token to malformed-provider-response', async () => {
    mocks.post.mockReturnValue(resolves({refresh_token: 'refresh-token', scope: 'read'}));
    const client = createLinearApiClient();

    const result = client.exchangeAuthorizationCode({code: 'oauth-code'});

    await expect(result).rejects.toMatchObject({reason: 'malformed-provider-response'});
  });

  it('never logs or throws OAuth secrets from rejected requests', async () => {
    mocks.post.mockReturnValue(rejects(httpError(403)));
    const client = createLinearApiClient();

    const error = await client
      .exchangeAuthorizationCode({code: 'super-secret-code'})
      .catch((thrown: unknown) => thrown);

    const serialized = [
      (error as Error).message,
      JSON.stringify(error),
      String((error as {cause?: unknown}).cause),
      JSON.stringify(mocks.warn.mock.calls),
    ].join(' ');
    expect(serialized).not.toContain('super-secret-code');
    expect(serialized).not.toContain('test-client-secret');
    expect(mocks.warn.mock.calls[0]).toEqual([
      {operation: 'exchange-authorization-code', status: 403, oauthErrorCode: 'unavailable'},
      'Linear API request rejected',
    ]);
  });
});

describe('createLinearApiClient.refreshAccessToken', () => {
  beforeEach(() => {
    vi.useRealTimers();
    mocks.post.mockReset();
    mocks.warn.mockReset();
  });

  it('posts a refresh-token grant and parses the new tokens', async () => {
    vi.useFakeTimers({now: new Date('2026-07-07T12:00:00.000Z')});
    mocks.post.mockReturnValue(
      resolves({
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 1800,
        scope: 'read,write',
      }),
    );
    const client = createLinearApiClient();

    const result = await client.refreshAccessToken({refreshToken: 'old-refresh-token'});

    const firstCall = mocks.post.mock.calls[0];
    expect(firstCall).toBeDefined();
    const [, options] = firstCall as [string, {body: URLSearchParams}];
    const body = options.body as URLSearchParams;
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('old-refresh-token');
    expect(body.has('scope')).toBe(false);
    expect(body.has('diagnostics')).toBe(false);
    expect(result).toEqual({
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
      expiresAt: new Date('2026-07-07T12:30:00.000Z'),
      scopes: ['read', 'write'],
    });
  });

  it.each([
    ['invalid_grant', 'invalid_grant'],
    ['invalid_client', 'invalid_client'],
    ['invalid_scope', 'invalid_scope'],
    ['invalid_request', 'invalid_request'],
    ['unsupported_grant_type', 'unsupported_grant_type'],
    ['secret-provider-value', 'unknown'],
    [null, 'unavailable'],
  ])('logs only a safe OAuth code for %s', async (providerCode, expectedCode) => {
    const error = httpError(400, {}, 'secret-status-text');
    error.data = {
      error: providerCode,
      error_description: 'secret-description',
      access_token: 'secret-access-token',
      refresh_token: 'secret-refresh-token',
    };
    mocks.post.mockReturnValue(rejects(error));
    const diagnostics = {
      connectionId: 'connection-id',
      refreshReason: 'expiry' as const,
      tokenExpiresAt: '2026-07-07T11:00:00.000Z',
    };

    await expect(
      createLinearApiClient().refreshAccessToken({
        refreshToken: 'secret-refresh-token',
        diagnostics,
      }),
    ).rejects.toMatchObject({reason: 'access-denied'});

    expect(mocks.warn).toHaveBeenCalledWith(
      {
        operation: 'refresh-access-token',
        status: 400,
        ...diagnostics,
        oauthErrorCode: expectedCode,
      },
      'Linear API request rejected',
    );
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain('secret-');
  });

  it.each([
    undefined,
    '<html>secret-body</html>',
    [],
    {error: {token: 'secret-token'}},
  ])('handles missing or malformed OAuth data without changing the failure', async (data) => {
    const error = httpError(400);
    error.data = data;
    mocks.post.mockReturnValue(rejects(error));

    await expect(
      createLinearApiClient().refreshAccessToken({refreshToken: 'secret-token'}),
    ).rejects.toMatchObject({reason: 'access-denied'});

    expect(mocks.warn).toHaveBeenCalledWith(
      {operation: 'refresh-access-token', status: 400, oauthErrorCode: 'unavailable'},
      'Linear API request rejected',
    );
  });

  it('logs the error class and refresh context without the message or payload', async () => {
    const error = Object.assign(new SyntaxError('secret-provider-response'), {
      payload: {refresh_token: 'secret-refresh-token'},
    });
    mocks.post.mockReturnValue(rejects(error));
    const diagnostics = {
      connectionId: 'connection-id',
      refreshReason: 'expiry' as const,
      tokenExpiresAt: '2026-07-07T11:00:00.000Z',
    };

    await expect(
      createLinearApiClient().refreshAccessToken({
        refreshToken: 'secret-refresh-token',
        diagnostics,
      }),
    ).rejects.toMatchObject({reason: 'provider-unavailable'});

    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith(
      {operation: 'refresh-access-token', errName: 'SyntaxError', ...diagnostics},
      'Linear API request failed',
    );
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain('secret-');
  });

  it('maps an invalid refresh token to access-denied', async () => {
    mocks.post.mockReturnValue(rejects(httpError(400)));
    const client = createLinearApiClient();

    const result = client.refreshAccessToken({refreshToken: 'invalid-refresh-token'});

    await expect(result).rejects.toMatchObject({reason: 'access-denied'});
  });
});

describe('createLinearApiClient.revokeToken', () => {
  beforeEach(() => {
    mocks.post.mockReset();
    mocks.warn.mockReset();
  });

  it('posts an OAuth token revocation request', async () => {
    mocks.post.mockResolvedValue(undefined);
    const client = createLinearApiClient();

    await client.revokeToken({token: 'access-token', tokenTypeHint: 'access_token'});

    const firstCall = mocks.post.mock.calls[0];
    expect(firstCall).toBeDefined();
    const [url, options] = firstCall as [string, {body: URLSearchParams}];
    const body = options.body as URLSearchParams;
    expect(url).toBe('https://api.linear.app/oauth/revoke');
    expect(body.get('client_id')).toBe('test-client-id');
    expect(body.get('client_secret')).toBe('test-client-secret');
    expect(body.get('token')).toBe('access-token');
    expect(body.get('token_type_hint')).toBe('access_token');
  });

  it('maps a rejected revocation without logging the token', async () => {
    mocks.post.mockRejectedValue(httpError(400));
    const client = createLinearApiClient();

    const error = await client
      .revokeToken({token: 'secret-token', tokenTypeHint: 'refresh_token'})
      .catch((thrown: unknown) => thrown);

    expect(error).toMatchObject({reason: 'access-denied'});
    const serialized = [
      (error as Error).message,
      JSON.stringify(error),
      JSON.stringify(mocks.warn.mock.calls),
    ].join(' ');
    expect(serialized).not.toContain('secret-token');
  });
});

describe('createLinearApiClient.getIdentity', () => {
  beforeEach(() => {
    vi.useRealTimers();
    mocks.post.mockReset();
    mocks.warn.mockReset();
  });

  it('derives the app user and organization identity', async () => {
    mocks.post.mockReturnValue(
      resolves({
        data: {
          viewer: {id: 'app-user-id'},
          organization: {id: 'org-id', name: 'Acme', urlKey: 'acme'},
        },
      }),
    );
    const client = createLinearApiClient();

    const result = await client.getIdentity({accessToken: 'linear-token'});

    const firstCall = mocks.post.mock.calls[0];
    expect(firstCall).toBeDefined();
    const [, options] = firstCall as [string, {headers: Record<string, string>}];
    expect(options.headers).toEqual({authorization: 'Bearer linear-token'});
    expect(result).toEqual({
      appUserId: 'app-user-id',
      organizationId: 'org-id',
      organizationName: 'Acme',
      organizationUrlKey: 'acme',
    });
  });

  it('maps missing viewer or organization data to malformed-provider-response', async () => {
    mocks.post.mockReturnValue(resolves({data: {viewer: {id: 'app-user-id'}}}));
    const client = createLinearApiClient();

    const result = client.getIdentity({accessToken: 'linear-token'});

    await expect(result).rejects.toMatchObject({reason: 'malformed-provider-response'});
  });

  it('maps GraphQL auth errors to access-denied without leaking the provider message', async () => {
    mocks.post.mockReturnValue(
      resolves({
        errors: [
          {
            message: 'invalid token linear-token',
            extensions: {type: 'authentication'},
          },
        ],
      }),
    );
    const client = createLinearApiClient();

    const error = await client.getIdentity({accessToken: 'linear-token'}).catch((thrown) => thrown);

    expect(error).toMatchObject({reason: 'access-denied'});
    const serialized = [
      (error as Error).message,
      JSON.stringify(error),
      JSON.stringify(mocks.warn.mock.calls),
    ].join(' ');
    expect(serialized).not.toContain('linear-token');
    expect(serialized).not.toContain('invalid token');
  });

  it('maps GraphQL transport auth failures to access-denied', async () => {
    mocks.post.mockReturnValue(rejects(httpError(401)));
    const client = createLinearApiClient();

    const result = client.getIdentity({accessToken: 'linear-token'});

    await expect(result).rejects.toMatchObject({reason: 'access-denied'});
  });

  it('maps GraphQL non-auth transport 4xx failures to malformed-provider-response', async () => {
    mocks.post.mockReturnValue(rejects(httpError(400)));
    const client = createLinearApiClient();

    const result = client.getIdentity({accessToken: 'linear-token'});

    await expect(result).rejects.toMatchObject({reason: 'malformed-provider-response'});
  });

  it('maps non-auth GraphQL errors to malformed-provider-response', async () => {
    mocks.post.mockReturnValue(
      resolves({
        errors: [{message: 'validation detail', extensions: {type: 'invalid'}}],
      }),
    );
    const client = createLinearApiClient();

    const result = client.getIdentity({accessToken: 'linear-token'});

    await expect(result).rejects.toMatchObject({reason: 'malformed-provider-response'});
  });

  it('maps GraphQL responses without data to malformed-provider-response', async () => {
    mocks.post.mockReturnValue(resolves({}));
    const client = createLinearApiClient();

    const result = client.getIdentity({accessToken: 'linear-token'});

    await expect(result).rejects.toMatchObject({reason: 'malformed-provider-response'});
  });
});

describe('createLinearApiClient native tool queries', () => {
  const relatedIssue = (identifier: string, projectId: string | null) => ({
    id: `uuid-${identifier}`,
    identifier,
    title: `Issue ${identifier}`,
    archivedAt: null,
    project: projectId === null ? null : {id: projectId},
  });

  beforeEach(() => {
    vi.useRealTimers();
    mocks.post.mockReset();
    mocks.warn.mockReset();
  });

  it('reads both relation directions from the configured GraphQL endpoint', async () => {
    mocks.post.mockReturnValue(
      resolves({
        data: {
          issue: {
            relations: {
              edges: [
                {
                  cursor: 'out-1',
                  node: {type: 'blocks', relatedIssue: relatedIssue('ENG-2', 'p1')},
                },
              ],
              pageInfo: {hasNextPage: true, endCursor: 'out-1'},
            },
            inverseRelations: {
              edges: [
                {cursor: 'in-1', node: {type: 'duplicate', issue: relatedIssue('ENG-3', null)}},
              ],
              pageInfo: {hasNextPage: false, endCursor: 'in-1'},
            },
          },
        },
      }),
    );
    const client = createLinearApiClient();

    const result = await client.listIssueRelations({
      accessToken: 'linear-token',
      issueId: 'ENG-1',
      outgoing: {first: 10, after: 'out-0'},
      incoming: {first: 10},
    });

    const [url, options] = mocks.post.mock.calls[0] as [
      string,
      {headers: Record<string, string>; json: {variables: Record<string, unknown>}},
    ];
    expect(url).toBe('https://api.linear.app/graphql');
    expect(options.headers).toEqual({authorization: 'Bearer linear-token'});
    expect(options.json.variables).toEqual({
      id: 'ENG-1',
      withOutgoing: true,
      outgoingFirst: 10,
      outgoingAfter: 'out-0',
      incomingFirst: 10,
      incomingAfter: null,
    });
    expect(result).toEqual({
      outgoing: {
        edges: [
          {
            cursor: 'out-1',
            type: 'blocks',
            issue: {
              id: 'uuid-ENG-2',
              identifier: 'ENG-2',
              title: 'Issue ENG-2',
              archivedAt: null,
              projectId: 'p1',
            },
          },
        ],
        hasNextPage: true,
        endCursor: 'out-1',
      },
      incoming: {
        edges: [
          {
            cursor: 'in-1',
            type: 'duplicate',
            issue: {
              id: 'uuid-ENG-3',
              identifier: 'ENG-3',
              title: 'Issue ENG-3',
              archivedAt: null,
              projectId: null,
            },
          },
        ],
        hasNextPage: false,
        endCursor: 'in-1',
      },
    });
  });

  it('skips outgoing relations when they are exhausted', async () => {
    mocks.post.mockReturnValue(
      resolves({
        data: {
          issue: {inverseRelations: {edges: [], pageInfo: {hasNextPage: false, endCursor: null}}},
        },
      }),
    );
    const client = createLinearApiClient();

    const result = await client.listIssueRelations({
      accessToken: 'linear-token',
      issueId: 'ENG-1',
      incoming: {first: 10, after: 'in-4'},
    });

    const [, options] = mocks.post.mock.calls[0] as [
      string,
      {json: {variables: Record<string, unknown>}},
    ];
    expect(options.json.variables).toMatchObject({withOutgoing: false, incomingAfter: 'in-4'});
    expect(result).toEqual({incoming: {edges: [], hasNextPage: false, endCursor: null}});
  });

  it('reads one page of issue attachments', async () => {
    const attachment = {
      id: 'attachment-1',
      title: 'design.pdf',
      subtitle: null,
      url: 'https://uploads.linear.app/org/file/design.pdf',
      createdAt: '2026-09-27T12:00:00.000Z',
    };
    mocks.post.mockReturnValue(
      resolves({
        data: {
          issue: {
            attachments: {
              nodes: [attachment],
              pageInfo: {hasNextPage: true, endCursor: 'page-2'},
            },
          },
        },
      }),
    );
    const client = createLinearApiClient();

    const result = await client.listIssueAttachments({
      accessToken: 'linear-token',
      issueId: 'ENG-1',
      first: 1,
    });

    const [, options] = mocks.post.mock.calls[0] as [
      string,
      {json: {variables: Record<string, unknown>}},
    ];
    expect(options.json.variables).toEqual({id: 'ENG-1', first: 1, after: null});
    expect(result).toEqual({attachments: [attachment], hasNextPage: true, endCursor: 'page-2'});
  });

  it.each([
    ['a null issue', resolves({data: {issue: null}})],
    [
      'an entity-not-found GraphQL error',
      resolves({
        data: null,
        errors: [
          {
            message: 'Entity not found: Issue',
            extensions: {
              type: 'invalid input',
              userPresentableMessage: 'Could not find referenced Issue.',
            },
          },
        ],
      }),
    ],
    [
      'an HTTP 400 carrying a not-found GraphQL error',
      rejects(
        Object.assign(httpError(400), {
          data: {errors: [{message: 'Entity not found: Issue'}]},
        }),
      ),
    ],
  ])('maps %s to not-found', async (_name, response) => {
    mocks.post.mockReturnValue(response);
    const client = createLinearApiClient();

    const result = client.listIssueAttachments({
      accessToken: 'linear-token',
      issueId: 'ENG-404',
      first: 50,
    });

    await expect(result).rejects.toMatchObject({
      reason: 'not-found',
      message: 'Linear could not find the issue.',
    });
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it.each([
    [
      'RATELIMITED errors',
      {errors: [{message: 'slow down', extensions: {code: 'RATELIMITED'}}]},
      'rate-limited',
    ],
    [
      'authentication errors',
      {errors: [{message: 'bad token', extensions: {type: 'authentication'}}]},
      'credentials-unavailable',
    ],
    [
      'authorization errors',
      {errors: [{message: 'forbidden', extensions: {type: 'authorization'}}]},
      'access-denied',
    ],
    ['other GraphQL errors', {errors: [{message: 'bad query'}]}, 'provider-rejected'],
    [
      'unexpected data',
      {data: {issue: {attachments: {nodes: 'nope'}}}},
      'malformed-provider-response',
    ],
  ])('maps %s', async (_name, body, reason) => {
    mocks.post.mockReturnValue(resolves(body));
    const client = createLinearApiClient();

    const result = client.listIssueAttachments({
      accessToken: 'linear-token',
      issueId: 'ENG-1',
      first: 50,
    });

    await expect(result).rejects.toMatchObject({reason});
  });

  it.each([
    [401, 'credentials-unavailable'],
    [403, 'access-denied'],
    [408, 'timeout'],
    [400, 'provider-rejected'],
    [503, 'provider-unavailable'],
  ])('maps a bare HTTP %i to %s', async (status, reason) => {
    mocks.post.mockReturnValue(rejects(httpError(status)));
    const client = createLinearApiClient();

    const result = client.listIssueRelations({
      accessToken: 'linear-token',
      issueId: 'ENG-1',
      incoming: {first: 50},
    });

    await expect(result).rejects.toMatchObject({reason});
  });
});
