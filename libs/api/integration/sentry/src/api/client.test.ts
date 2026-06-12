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
  return new HTTPError({status, headers: new Headers(headers)});
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
    postMock.mockReturnValue(rejects(new TimeoutError()));
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
