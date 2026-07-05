const userId = '11111111-1111-4111-8111-111111111111';
const refreshCookie = 'shipfox_refresh=refresh-token; Path=/auth/refresh; HttpOnly; SameSite=Lax';

function response(params: {setCookie?: string; json: unknown}) {
  return {
    headers: {
      get: vi.fn((name: string) => (name.toLowerCase() === 'set-cookie' ? params.setCookie : null)),
    },
    json: vi.fn().mockResolvedValue(params.json),
  };
}

describe('auth setup helper', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  test('posts generated users to the auth E2E setup route', async () => {
    const requestJson = vi.fn().mockResolvedValue({
      user: {id: userId},
      email: 'user@example.test',
      password: 'secret-password',
    });
    vi.doMock('@shipfox/e2e-core', () => ({config: {}, request: vi.fn(), requestJson}));
    const {createUser} = await import('./index.js');

    const result = await createUser({
      email: 'user@example.test',
      password: 'secret-password',
      name: 'E2E User',
      verified: false,
    });

    expect(requestJson).toHaveBeenCalledWith('post', '/__e2e/auth/users', {
      json: {
        email: 'user@example.test',
        password: 'secret-password',
        name: 'E2E User',
        verified: false,
      },
    });
    expect(result.user.id).toBe(userId);
  });

  test('returns the session token with the refresh cookie', async () => {
    const request = vi.fn().mockResolvedValue(
      response({
        setCookie: refreshCookie,
        json: {token: 'session-token', expires_at: '2026-01-15T12:00:00.000Z'},
      }),
    );
    vi.doMock('@shipfox/e2e-core', () => ({config: {}, request, requestJson: vi.fn()}));
    const {createSession} = await import('./index.js');

    const result = await createSession({user_id: userId});

    expect(request).toHaveBeenCalledWith('post', '/__e2e/auth/sessions', {
      json: {user_id: userId},
    });
    expect(result).toEqual({
      token: 'session-token',
      expires_at: '2026-01-15T12:00:00.000Z',
      setCookie: refreshCookie,
    });
  });

  test('fails when the session response omits the refresh cookie', async () => {
    const request = vi.fn().mockResolvedValue(response({json: {token: 'session-token'}}));
    vi.doMock('@shipfox/e2e-core', () => ({config: {}, request, requestJson: vi.fn()}));
    const {createSession} = await import('./index.js');

    const result = createSession({user_id: userId});

    await expect(result).rejects.toThrow('E2E session endpoint did not set a refresh cookie');
  });

  test('hydrates the browser refresh cookie when logging in', async () => {
    const addCookies = vi.fn().mockResolvedValue(undefined);
    const request = vi.fn().mockResolvedValue(
      response({
        setCookie: refreshCookie,
        json: {token: 'session-token', expires_at: '2026-01-15T12:00:00.000Z'},
      }),
    );
    vi.doMock('@shipfox/e2e-core', () => ({
      config: {API_URL: 'https://api.example.test'},
      request,
      requestJson: vi.fn(),
    }));
    const {loginAs} = await import('./index.js');

    await loginAs({context: () => ({addCookies})} as never, {user: {id: userId}} as never);

    expect(addCookies).toHaveBeenCalledWith([
      {
        name: 'shipfox_refresh',
        value: 'refresh-token',
        domain: 'api.example.test',
        path: '/auth/refresh',
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
      },
    ]);
  });
});
