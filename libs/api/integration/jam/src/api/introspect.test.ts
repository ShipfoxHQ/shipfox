import {createJamIntrospectionClient} from './introspect.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {'content-type': 'application/json'},
  });
}

describe('Jam introspection client', () => {
  it('posts the token as a form and parses an active token', async () => {
    const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      jsonResponse({
        active: true,
        tokenType: 'pat',
        user_id: 'user-1',
        team_id: 'team-1',
        scope: 'cli:read mcp:read',
      }),
    );
    const client = createJamIntrospectionClient({fetch, apiBaseUrl: 'https://api.jam.test/'});

    expect(await client.introspect('jam_pat_secret')).toEqual({
      active: true,
      teamId: 'team-1',
      userId: 'user-1',
      scopes: ['cli:read', 'mcp:read'],
    });

    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe('https://api.jam.test/oauth/introspect');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({'content-type': 'application/x-www-form-urlencoded'});
    expect(String(init?.body)).toBe('token=jam_pat_secret');
  });

  it('reports a revoked token as inactive', async () => {
    const client = createJamIntrospectionClient({
      fetch: async () => jsonResponse({active: false}),
    });

    expect(await client.introspect('jam_pat_revoked')).toEqual({active: false});
  });

  it('rejects an active token that names no workspace', async () => {
    const client = createJamIntrospectionClient({
      fetch: async () => jsonResponse({active: true, user_id: 'user-1'}),
    });

    await expect(client.introspect('jam_pat_secret')).rejects.toMatchObject({
      reason: 'malformed-provider-response',
    });
  });

  it.each([
    [429, 'rate-limited'],
    [503, 'provider-unavailable'],
    [400, 'provider-rejected'],
  ])('maps HTTP %s to %s', async (status, reason) => {
    const client = createJamIntrospectionClient({
      fetch: async () => jsonResponse({error: 'x'}, status),
    });

    await expect(client.introspect('jam_pat_secret')).rejects.toMatchObject({reason});
  });

  it('maps a network failure to provider-unavailable', async () => {
    const client = createJamIntrospectionClient({
      fetch: () => Promise.reject(new TypeError('fetch failed')),
    });

    await expect(client.introspect('jam_pat_secret')).rejects.toMatchObject({
      reason: 'provider-unavailable',
    });
  });
});
