import {configureApiClient} from '@shipfox/client-api';
import {confirmPasswordReset, requestPasswordReset} from './password-reset-auth.js';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: {'content-type': 'application/json'},
    status: 200,
    ...init,
  });
}

describe('requestPasswordReset', () => {
  beforeEach(() => {
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl: undefined});
  });

  test('posts reset request emails', async () => {
    let requestBody: unknown;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      requestBody = await (input as Request).clone().json();
      return new Response(null, {status: 204});
    });
    configureApiClient({fetchImpl});

    const result = await requestPasswordReset({email: 'reset@example.com'});

    const request = fetchImpl.mock.calls[0]?.[0] as Request;
    expect(result).toBeUndefined();
    expect(request.url).toBe('https://api.example.test/auth/password-reset');
    expect(request.method).toBe('POST');
    expect(requestBody).toEqual({email: 'reset@example.com'});
  });
});

describe('confirmPasswordReset', () => {
  beforeEach(() => {
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl: undefined});
  });

  test('posts reset confirmation tokens and passwords', async () => {
    let requestBody: unknown;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      requestBody = await (input as Request).clone().json();
      return jsonResponse({
        token: 'reset-access-token',
        user: {
          id: '11111111-1111-4111-8111-111111111111',
          email: 'reset@example.com',
          name: null,
          email_verified_at: '2026-04-27T00:00:00.000Z',
          status: 'active',
          created_at: '2026-04-27T00:00:00.000Z',
          updated_at: '2026-04-27T00:00:00.000Z',
        },
      });
    });
    configureApiClient({fetchImpl});
    const body = {token: 'reset-token', new_password: 'new password is long'};

    const result = await confirmPasswordReset(body);

    const request = fetchImpl.mock.calls[0]?.[0] as Request;
    expect(result.accessToken).toBe('reset-access-token');
    expect(request.url).toBe('https://api.example.test/auth/password-reset/confirm');
    expect(request.method).toBe('POST');
    expect(requestBody).toEqual(body);
  });
});
