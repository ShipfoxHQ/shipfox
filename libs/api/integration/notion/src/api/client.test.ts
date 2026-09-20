import {createNotionAgentToolsClient, NOTION_API_VERSION, notionApiUrl} from './client.js';

function response(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {'content-type': 'application/json', ...headers},
  });
}

describe('Notion REST client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('pins the API version, bearer token, timeout request, and request shape', async () => {
    let requestBody: unknown;
    const fetchMock = vi.fn<(input: Request | URL, init?: RequestInit) => Promise<Response>>(
      async (input) => {
        if (input instanceof Request) requestBody = await input.clone().json();
        return response({results: []}, 200);
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = createNotionAgentToolsClient();

    await client.request({
      accessToken: 'notion-token',
      method: 'POST',
      path: '/v1/search',
      body: {query: 'Roadmap'},
      operation: 'search',
    });

    const request = fetchMock.mock.calls[0]?.[0];
    expect(request).toBeInstanceOf(Request);
    if (!(request instanceof Request)) throw new Error('Expected a Request');
    expect(request.url).toBe(`${notionApiUrl('/v1/search')}`);
    expect(request.method).toBe('POST');
    expect(request.headers.get('authorization')).toBe('Bearer notion-token');
    expect(request.headers.get('Notion-Version')).toBe(NOTION_API_VERSION);
    expect(requestBody).toEqual({query: 'Roadmap'});
  });

  it('returns 401, 403, and object-not-found responses for the provider to map', async () => {
    const fetchMock = vi
      .fn<(input: Request | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(response({code: 'unauthorized'}, 401))
      .mockResolvedValueOnce(response({message: 'forbidden'}, 403))
      .mockResolvedValueOnce(response({code: 'object_not_found'}, 404));
    vi.stubGlobal('fetch', fetchMock);
    const client = createNotionAgentToolsClient();

    await expect(
      client.request({accessToken: 'token', method: 'GET', path: '/v1/pages/1'}),
    ).resolves.toEqual({status: 401, body: {code: 'unauthorized'}});
    await expect(
      client.request({accessToken: 'token', method: 'GET', path: '/v1/pages/2'}),
    ).resolves.toEqual({status: 403, body: {message: 'forbidden'}});
    await expect(
      client.request({accessToken: 'token', method: 'GET', path: '/v1/pages/3'}),
    ).resolves.toEqual({status: 404, body: {code: 'object_not_found'}});
  });

  it('maps rate limits and provider outages with their retry metadata', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({code: 'rate_limited'}, 429, {'retry-after': '17'}))
      .mockResolvedValueOnce(response({code: 'internal_server_error'}, 503));
    vi.stubGlobal('fetch', fetchMock);
    const client = createNotionAgentToolsClient();

    await expect(
      client.request({accessToken: 'token', method: 'GET', path: '/v1/pages/1'}),
    ).rejects.toMatchObject({reason: 'rate-limited', retryAfterSeconds: 17, status: 429});
    await expect(
      client.request({accessToken: 'token', method: 'GET', path: '/v1/pages/1'}),
    ).rejects.toMatchObject({reason: 'provider-unavailable', status: 503});
  });
});
