import {requestGithubOidcToken} from '../src/oidc.js';

describe('requestGithubOidcToken', () => {
  const env = {
    ACTIONS_ID_TOKEN_REQUEST_URL: 'https://token.actions.test/oidc?api-version=2.0',
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'request-bearer',
  };

  it('requests a token for the registry audience', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({value: 'jwt'}));

    const token = await requestGithubOidcToken({
      audience: 'https://api.registry.shipfox.io',
      env,
      fetch,
    });

    expect(token).toBe('jwt');
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      'https://token.actions.test/oidc?api-version=2.0&audience=https%3A%2F%2Fapi.registry.shipfox.io',
    );
    expect(init?.headers).toEqual({authorization: 'Bearer request-bearer'});
  });

  it('explains how to get a token outside a job with id-token: write', async () => {
    await expect(
      requestGithubOidcToken({audience: 'https://registry.test', env: {}}),
    ).rejects.toThrow('id-token: write');
  });

  it('reports a refusal from GitHub', async () => {
    const fetch: typeof globalThis.fetch = async () => new Response('no', {status: 403});

    await expect(
      requestGithubOidcToken({audience: 'https://registry.test', env, fetch}),
    ).rejects.toThrow('status 403');
  });
});
