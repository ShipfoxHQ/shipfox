import {configureApiClient} from '@shipfox/client-api';
import {loginAuth} from './login-auth.js';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: {'content-type': 'application/json'},
    status: 200,
    ...init,
  });
}

describe('loginAuth', () => {
  beforeEach(() => {
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl: undefined});
  });

  test('posts login credentials', async () => {
    let requestBody: unknown;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      requestBody = await (input as Request).clone().json();
      return jsonResponse({
        token: 'access-token',
        user: {
          id: '11111111-1111-4111-8111-111111111111',
          email: 'login@example.com',
          name: null,
          email_verified_at: '2026-04-27T00:00:00.000Z',
          status: 'active',
          created_at: '2026-04-27T00:00:00.000Z',
          updated_at: '2026-04-27T00:00:00.000Z',
        },
      });
    });
    configureApiClient({fetchImpl});
    const body = {email: 'login@example.com', password: 'correct horse'};

    const result = await loginAuth(body);

    const request = fetchImpl.mock.calls[0]?.[0] as Request;
    expect(result.accessToken).toBe('access-token');
    expect(request.url).toBe('https://api.example.test/auth/login');
    expect(request.method).toBe('POST');
    expect(requestBody).toEqual(body);
  });
});
