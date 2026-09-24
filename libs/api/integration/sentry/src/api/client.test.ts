import {createHmac} from 'node:crypto';
import {HTTPError, TimeoutError} from 'ky';
import {SentryIntegrationProviderError} from '#core/errors.js';
import {createSentryApiClient} from './client.js';

const {postMock, getMock, putMock} = vi.hoisted(() => ({
  postMock: vi.fn(),
  getMock: vi.fn(),
  putMock: vi.fn(),
}));

vi.mock('ky', () => {
  class HTTPError extends Error {
    constructor(public response: {status: number; headers: Headers}) {
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
  return {default: {post: postMock, get: getMock, put: putMock}, HTTPError, TimeoutError};
});

function resolves(data: unknown) {
  return {json: () => Promise.resolve(data)};
}

function rejects(error: unknown) {
  return {json: () => Promise.reject(error)};
}

function httpError(status: number, headers: Record<string, string> = {}): HTTPError {
  return new HTTPError({status, headers: new Headers(headers)} as never, {} as never, {} as never);
}

describe('createSentryApiClient.exchangeAuthorizationCode', () => {
  beforeEach(() => {
    postMock.mockReset();
    getMock.mockReset();
    putMock.mockReset();
  });

  it('returns the token, refresh token, and expiry', async () => {
    postMock.mockReturnValue(
      resolves({token: 'tok', refreshToken: 'refresh', expiresAt: '2026-06-11T12:00:00.000Z'}),
    );
    const client = createSentryApiClient();

    const result = await client.exchangeAuthorizationCode({
      installationUuid: 'uuid-1',
      code: 'the-code',
    });

    expect(result).toEqual({
      token: 'tok',
      refreshToken: 'refresh',
      expiresAt: '2026-06-11T12:00:00.000Z',
    });
  });

  it('maps a 429 to rate-limited with retry-after seconds', async () => {
    postMock.mockReturnValue(rejects(httpError(429, {'retry-after': '30'})));
    const client = createSentryApiClient();

    const result = client.exchangeAuthorizationCode({installationUuid: 'uuid-1', code: 'c'});

    await expect(result).rejects.toMatchObject({reason: 'rate-limited', retryAfterSeconds: 30});
    await expect(result).rejects.toBeInstanceOf(SentryIntegrationProviderError);
  });

  it('maps a 5xx to provider-unavailable', async () => {
    postMock.mockReturnValue(rejects(httpError(503)));
    const client = createSentryApiClient();

    const result = client.exchangeAuthorizationCode({installationUuid: 'uuid-1', code: 'c'});

    await expect(result).rejects.toMatchObject({reason: 'provider-unavailable'});
  });

  it('maps a forged-code 4xx to access-denied', async () => {
    postMock.mockReturnValue(rejects(httpError(403)));
    const client = createSentryApiClient();

    const result = client.exchangeAuthorizationCode({installationUuid: 'uuid-1', code: 'c'});

    await expect(result).rejects.toMatchObject({reason: 'access-denied'});
  });

  it('maps a timeout to timeout', async () => {
    postMock.mockReturnValue(rejects(new TimeoutError({} as never)));
    const client = createSentryApiClient();

    const result = client.exchangeAuthorizationCode({installationUuid: 'uuid-1', code: 'c'});

    await expect(result).rejects.toMatchObject({reason: 'timeout'});
  });

  it('maps a response without a token to malformed-provider-response', async () => {
    postMock.mockReturnValue(resolves({refreshToken: 'r', expiresAt: 'x'}));
    const client = createSentryApiClient();

    const result = client.exchangeAuthorizationCode({installationUuid: 'uuid-1', code: 'c'});

    await expect(result).rejects.toMatchObject({reason: 'malformed-provider-response'});
  });

  it('never leaks the code or client secret into the thrown error', async () => {
    postMock.mockReturnValue(rejects(httpError(403)));
    const client = createSentryApiClient();

    const error = await client
      .exchangeAuthorizationCode({installationUuid: 'uuid-1', code: 'super-secret-code'})
      .catch((thrown: unknown) => thrown);

    const serialized = `${(error as Error).message} ${JSON.stringify(error)} ${String((error as {cause?: unknown}).cause)}`;
    expect(serialized).not.toContain('super-secret-code');
    expect(serialized).not.toContain('test-client-secret');
    expect((error as {cause?: unknown}).cause).toBeUndefined();
  });
});

describe('createSentryApiClient.getInstallation', () => {
  beforeEach(() => {
    getMock.mockReset();
  });

  it('derives the organization slug', async () => {
    getMock.mockReturnValue(resolves({organization: {slug: 'acme'}}));
    const client = createSentryApiClient();

    const result = await client.getInstallation({installationUuid: 'uuid-1', token: 'tok'});

    expect(result).toEqual({orgSlug: 'acme'});
  });

  it('maps a response without an organization slug to malformed-provider-response', async () => {
    getMock.mockReturnValue(resolves({organization: {}}));
    const client = createSentryApiClient();

    const result = client.getInstallation({installationUuid: 'uuid-1', token: 'tok'});

    await expect(result).rejects.toMatchObject({reason: 'malformed-provider-response'});
  });
});

describe('Sentry authenticated reads', () => {
  beforeEach(() => {
    postMock.mockReset();
    getMock.mockReset();
  });

  it('mints an app-signed JWT with a short lifetime and validates the token response', async () => {
    postMock.mockReturnValue(resolves({token: 'read-token', expiresAt: '2026-09-25T00:00:00Z'}));

    const result = await createSentryApiClient().mintInstallationToken({
      installationUuid: 'install/1',
    });

    expect(result.token).toBe('read-token');
    const [url, options] = postMock.mock.calls[0] as [
      string,
      {headers: {authorization: string}; json: {grant_type: string}},
    ];
    expect(url).toContain('/sentry-app-installations/install%2F1/authorizations/');
    expect(options.json.grant_type).toBe('urn:sentry:params:oauth:grant-type:jwt-bearer');
    const assertion = options.headers.authorization.slice('Bearer '.length);
    const [header, payload, signature] = assertion.split('.');
    expect(assertion.split('.')).toHaveLength(3);
    expect(JSON.parse(Buffer.from(header ?? '', 'base64url').toString())).toEqual({
      alg: 'HS256',
      typ: 'JWT',
    });
    const claims = JSON.parse(Buffer.from(payload ?? '', 'base64url').toString()) as {
      iss: string;
      sub: string;
      iat: number;
      exp: number;
      jti: string;
    };
    expect(claims).toMatchObject({iss: 'test-client-id', sub: 'test-client-id'});
    expect(claims.exp - claims.iat).toBe(60);
    expect(claims.jti).toBeTruthy();
    expect(signature).toBe(
      createHmac('sha256', 'test-client-secret').update(`${header}.${payload}`).digest('base64url'),
    );
  });

  it('maps a rejected token mint to access-denied', async () => {
    postMock.mockReturnValue(rejects(httpError(403)));

    const result = createSentryApiClient().mintInstallationToken({installationUuid: 'install-1'});

    await expect(result).rejects.toMatchObject({reason: 'access-denied'});
  });

  it('rejects a minted token with a malformed expiry', async () => {
    postMock.mockReturnValue(resolves({token: 'read-token', expiresAt: 'not-a-date'}));

    const result = createSentryApiClient().mintInstallationToken({installationUuid: 'install-1'});

    await expect(result).rejects.toMatchObject({reason: 'malformed-provider-response'});
  });

  it('encodes project filters and forwards the next cursor without following the link URL', async () => {
    getMock.mockReturnValue(
      Promise.resolve(
        new Response(JSON.stringify([{id: '1', slug: 'api', name: 'API'}]), {
          headers: {
            link: '<https://foreign.example/?cursor=opaque%3A1>; rel="next"; results="true"; cursor="opaque:1"',
          },
        }),
      ),
    );

    const result = await createSentryApiClient().listProjects({
      orgSlug: 'team/name',
      token: 'secret',
      query: 'api & jobs',
      limit: 20,
      cursor: 'old:1',
    });

    expect(result).toEqual({data: [{id: '1', slug: 'api', name: 'API'}], nextCursor: 'opaque:1'});
    const [url, options] = getMock.mock.calls[0] as [
      string,
      {headers: {authorization: string}; searchParams: URLSearchParams},
    ];
    expect(url).toBe('https://sentry.io/api/0/organizations/team%2Fname/projects/');
    expect(options.headers.authorization).toBe('Bearer secret');
    expect(options.searchParams.get('query')).toBe('api & jobs');
    expect(options.searchParams.get('per_page')).toBe('20');
    expect(options.searchParams.get('cursor')).toBe('old:1');
  });

  it('passes issue filters, including an explicit empty query', async () => {
    getMock.mockReturnValue(
      Promise.resolve(new Response(JSON.stringify([{id: '42', title: 'Failure'}]))),
    );

    const result = await createSentryApiClient().searchIssues({
      orgSlug: 'acme',
      token: 'secret',
      query: '',
      projectIds: ['12', '34'],
      environments: ['prod', 'stage'],
      statsPeriod: '24h',
      sort: 'date',
      limit: 20,
      cursor: 'next:1',
    });

    expect(result).toEqual({data: [{id: '42', title: 'Failure'}], nextCursor: null});
    const [, options] = getMock.mock.calls[0] as [string, {searchParams: URLSearchParams}];
    expect(options.searchParams.get('query')).toBe('');
    expect(options.searchParams.getAll('project')).toEqual(['12', '34']);
    expect(options.searchParams.getAll('environment')).toEqual(['prod', 'stage']);
    expect(options.searchParams.get('statsPeriod')).toBe('24h');
    expect(options.searchParams.get('sort')).toBe('date');
    expect(options.searchParams.get('limit')).toBe('20');
    expect(options.searchParams.has('shortIdLookup')).toBe(false);
  });

  it('reads issue detail and latest event through encoded organization paths', async () => {
    getMock.mockReturnValueOnce(
      Promise.resolve(new Response(JSON.stringify({id: '42', title: 'Failure'}))),
    );
    getMock.mockReturnValueOnce(
      Promise.resolve(
        new Response(
          JSON.stringify({
            id: 'event-1',
            groupID: '42',
            eventID: 'event-1',
            entries: [
              {
                type: 'exception',
                data: {
                  values: [
                    {
                      type: 'Error',
                      value: 'failure',
                      stacktrace: {
                        frames: [
                          {
                            filename: 'src/app.ts',
                            function: 'run',
                            lineNo: 12,
                            colNo: 3,
                            inApp: true,
                          },
                        ],
                      },
                    },
                  ],
                },
              },
            ],
          }),
        ),
      ),
    );
    const client = createSentryApiClient();

    expect(
      await client.getIssue({orgSlug: 'acme', token: 'secret', issueId: '42/other'}),
    ).toMatchObject({id: '42'});
    const event = await client.getIssueEvent({
      orgSlug: 'acme',
      token: 'secret',
      issueId: '42/other',
      environments: ['prod & blue'],
    });
    expect(event).toMatchObject({
      id: 'event-1',
      entries: [{data: {values: [{stacktrace: {frames: [{inApp: true}]}}]}}],
    });
    expect(getMock.mock.calls[0]?.[0]).toContain('/issues/42%2Fother/');
    expect(getMock.mock.calls[1]?.[0]).toContain('/issues/42%2Fother/events/latest/');
    const options = getMock.mock.calls[1]?.[1] as {searchParams: URLSearchParams};
    expect(options.searchParams.get('environment')).toBe('prod & blue');
  });

  it.each([400, 404])('maps read %i without exposing the provider body', async (status) => {
    getMock.mockReturnValue(Promise.reject(httpError(status)));
    const error = await createSentryApiClient()
      .getIssue({orgSlug: 'acme', token: 'secret', issueId: '42'})
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({reason: 'provider-rejected', status});
    expect(JSON.stringify(error)).not.toContain('secret');
  });

  it('maps read 401 for coordinated renewal and keeps installation errors unchanged', async () => {
    getMock.mockReturnValueOnce(Promise.reject(httpError(401)));
    getMock.mockReturnValueOnce(rejects(httpError(401)));
    const client = createSentryApiClient();

    await expect(
      client.getIssue({orgSlug: 'acme', token: 'secret', issueId: '42'}),
    ).rejects.toMatchObject({reason: 'credentials-unavailable', status: 401});
    await expect(
      client.getInstallation({installationUuid: 'install-1', token: 'secret'}),
    ).rejects.toMatchObject({reason: 'access-denied'});
  });

  it('rejects malformed successful responses', async () => {
    getMock.mockReturnValue(Promise.resolve(new Response(JSON.stringify([{id: '1'}]))));
    await expect(
      createSentryApiClient().listProjects({orgSlug: 'acme', token: 'secret'}),
    ).rejects.toMatchObject({reason: 'malformed-provider-response'});
  });
});
