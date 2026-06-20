import {Buffer} from 'node:buffer';
import {GiteaIntegrationProviderError} from '#core/errors.js';
import {createGiteaApiClient} from './client.js';

const REPOSITORY = {
  id: 7,
  owner: {login: 'shipfox'},
  name: 'platform',
  full_name: 'shipfox/platform',
  default_branch: 'main',
  private: true,
  clone_url: 'https://gitea.example.com/shipfox/platform.git',
  html_url: 'https://gitea.example.com/shipfox/platform',
};

function jsonResponse(
  body: unknown,
  init: {status?: number; headers?: Record<string, string>} = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {'content-type': 'application/json', ...init.headers},
  });
}

describe('HttpGiteaApiClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function requestedUrl(call = 0): URL {
    return new URL(String(fetchMock.mock.calls[call]?.[0]));
  }

  function requestInit(call = 0): RequestInit {
    return fetchMock.mock.calls[call]?.[1] as RequestInit;
  }

  it('lists org repositories with basic auth and a page cursor from the link header', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse([REPOSITORY], {
        headers: {
          link: '<https://gitea.example.com/api/v1/orgs/shipfox/repos?page=3&limit=50>; rel="next"',
        },
      }),
    );
    const client = createGiteaApiClient();

    const result = await client.listOrgRepositories({org: 'shipfox', limit: 50, cursor: '2'});

    expect(result.repositories[0]?.fullName).toBe('shipfox/platform');
    expect(result.nextCursor).toBe('3');
    const url = requestedUrl();
    expect(url.pathname).toBe('/api/v1/orgs/shipfox/repos');
    expect(url.searchParams.get('page')).toBe('2');
    expect(url.searchParams.get('limit')).toBe('50');
    expect((requestInit().headers as Record<string, string>).authorization).toBe(
      `Basic ${Buffer.from('shipfox-bot:test-service-token').toString('base64')}`,
    );
  });

  it('returns no next cursor when the link header has no next relation', async () => {
    fetchMock.mockResolvedValue(jsonResponse([REPOSITORY]));
    const client = createGiteaApiClient();

    const result = await client.listOrgRepositories({org: 'shipfox', limit: 50});

    expect(result.nextCursor).toBeNull();
  });

  it('gets a single repository', async () => {
    fetchMock.mockResolvedValue(jsonResponse(REPOSITORY));
    const client = createGiteaApiClient();

    const result = await client.getRepository({owner: 'shipfox', repo: 'platform'});

    expect(result).toEqual({
      ownerLogin: 'shipfox',
      name: 'platform',
      fullName: 'shipfox/platform',
      defaultBranch: 'main',
      private: true,
      cloneUrl: 'https://gitea.example.com/shipfox/platform.git',
      htmlUrl: 'https://gitea.example.com/shipfox/platform',
    });
    expect(requestedUrl().pathname).toBe('/api/v1/repos/shipfox/platform');
  });

  it('resolves a ref to its head commit sha', async () => {
    fetchMock.mockResolvedValue(jsonResponse([{sha: 'abc123'}, {sha: 'older'}]));
    const client = createGiteaApiClient();

    const sha = await client.resolveRef({owner: 'shipfox', repo: 'platform', ref: 'main'});

    expect(sha).toBe('abc123');
    const url = requestedUrl();
    expect(url.pathname).toBe('/api/v1/repos/shipfox/platform/commits');
    expect(url.searchParams.get('sha')).toBe('main');
    expect(url.searchParams.get('limit')).toBe('1');
  });

  it('rejects a ref that resolves to no commit', async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));
    const client = createGiteaApiClient();

    const result = client.resolveRef({owner: 'shipfox', repo: 'platform', ref: 'missing'});

    await expect(result).rejects.toMatchObject({reason: 'repository-not-found'});
  });

  it('lists the recursive tree, keeping blobs and dropping subtrees', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        tree: [
          {path: 'README.md', type: 'blob', size: 12},
          {path: 'src', type: 'tree'},
          {path: 'src/index.ts', type: 'blob', size: 34},
        ],
        truncated: false,
      }),
    );
    const client = createGiteaApiClient();

    const result = await client.listTree({owner: 'shipfox', repo: 'platform', sha: 'abc123'});

    expect(result.blobs).toEqual([
      {path: 'README.md', size: 12},
      {path: 'src/index.ts', size: 34},
    ]);
    expect(result.truncated).toBe(false);
    const url = requestedUrl();
    expect(url.pathname).toBe('/api/v1/repos/shipfox/platform/git/trees/abc123');
    expect(url.searchParams.get('recursive')).toBe('true');
  });

  it('reports a truncated tree', async () => {
    fetchMock.mockResolvedValue(jsonResponse({tree: [], truncated: true}));
    const client = createGiteaApiClient();

    const result = await client.listTree({owner: 'shipfox', repo: 'platform', sha: 'abc123'});

    expect(result.truncated).toBe(true);
  });

  it('fetches and base64-decodes file content', async () => {
    const content = 'name: CI\n';
    fetchMock.mockResolvedValue(
      jsonResponse({
        type: 'file',
        encoding: 'base64',
        path: '.shipfox/workflows/ci.yml',
        size: content.length,
        content: Buffer.from(content).toString('base64'),
      }),
    );
    const client = createGiteaApiClient();

    const result = await client.fetchFileContent({
      owner: 'shipfox',
      repo: 'platform',
      path: '.shipfox/workflows/ci.yml',
      ref: 'main',
    });

    expect(result.content).toBe(content);
    const url = requestedUrl();
    expect(url.pathname).toBe('/api/v1/repos/shipfox/platform/contents/.shipfox/workflows/ci.yml');
    expect(url.searchParams.get('ref')).toBe('main');
  });

  it('rejects a content response that is a directory listing', async () => {
    fetchMock.mockResolvedValue(jsonResponse([{type: 'file', path: 'a'}]));
    const client = createGiteaApiClient();

    const result = client.fetchFileContent({
      owner: 'shipfox',
      repo: 'platform',
      path: 'src',
      ref: 'main',
    });

    await expect(result).rejects.toMatchObject({reason: 'file-not-found'});
  });

  it('rejects file content larger than the supported limit before decoding', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        type: 'file',
        encoding: 'base64',
        path: 'big.bin',
        size: 1_000_001,
        content: '',
      }),
    );
    const client = createGiteaApiClient();

    const result = client.fetchFileContent({
      owner: 'shipfox',
      repo: 'platform',
      path: 'big.bin',
      ref: 'main',
    });

    await expect(result).rejects.toMatchObject({reason: 'content-too-large'});
  });

  it.each([
    [401, 'access-denied'],
    [403, 'access-denied'],
    [404, 'repository-not-found'],
    [429, 'rate-limited'],
    [500, 'provider-unavailable'],
    [503, 'provider-unavailable'],
  ])('maps HTTP %s to the %s reason', async (status, reason) => {
    fetchMock.mockResolvedValue(jsonResponse({}, {status}));
    const client = createGiteaApiClient();

    const result = client.getRepository({owner: 'shipfox', repo: 'platform'});

    await expect(result).rejects.toBeInstanceOf(GiteaIntegrationProviderError);
    await expect(result).rejects.toMatchObject({reason});
  });

  it('carries retry-after seconds on a rate-limited response', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, {status: 429, headers: {'retry-after': '42'}}));
    const client = createGiteaApiClient();

    const result = client.getRepository({owner: 'shipfox', repo: 'platform'});

    await expect(result).rejects.toMatchObject({reason: 'rate-limited', retryAfterSeconds: 42});
  });

  it('treats an exhausted rate-limit budget on a 403 as rate-limited', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({}, {status: 403, headers: {'x-ratelimit-remaining': '0'}}),
    );
    const client = createGiteaApiClient();

    const result = client.getRepository({owner: 'shipfox', repo: 'platform'});

    await expect(result).rejects.toMatchObject({reason: 'rate-limited'});
  });

  it('maps a network failure to provider-unavailable', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const client = createGiteaApiClient();

    const result = client.getRepository({owner: 'shipfox', repo: 'platform'});

    await expect(result).rejects.toMatchObject({reason: 'provider-unavailable'});
  });

  it('maps a malformed repository payload to malformed-provider-response', async () => {
    fetchMock.mockResolvedValue(jsonResponse({name: 'platform'}));
    const client = createGiteaApiClient();

    const result = client.getRepository({owner: 'shipfox', repo: 'platform'});

    await expect(result).rejects.toMatchObject({reason: 'malformed-provider-response'});
  });

  it('maps a file response without base64 content to malformed-provider-response', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({type: 'file', encoding: 'utf-8', path: 'a', size: 1, content: 'x'}),
    );
    const client = createGiteaApiClient();

    const result = client.fetchFileContent({
      owner: 'shipfox',
      repo: 'platform',
      path: 'a',
      ref: 'main',
    });

    await expect(result).rejects.toMatchObject({reason: 'malformed-provider-response'});
  });

  it('maps a file response missing a numeric size to malformed-provider-response', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({type: 'file', encoding: 'base64', path: 'a', content: ''}),
    );
    const client = createGiteaApiClient();

    const result = client.fetchFileContent({
      owner: 'shipfox',
      repo: 'platform',
      path: 'a',
      ref: 'main',
    });

    await expect(result).rejects.toMatchObject({reason: 'malformed-provider-response'});
  });

  it('maps a 404 on the contents endpoint to file-not-found', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, {status: 404}));
    const client = createGiteaApiClient();

    const result = client.fetchFileContent({
      owner: 'shipfox',
      repo: 'platform',
      path: 'missing.txt',
      ref: 'main',
    });

    await expect(result).rejects.toMatchObject({reason: 'file-not-found'});
  });

  it('rejects a path with traversal segments before issuing a request', async () => {
    const client = createGiteaApiClient();

    const result = client.fetchFileContent({
      owner: 'shipfox',
      repo: 'platform',
      path: '../../../../user/keys',
      ref: 'main',
    });

    await expect(result).rejects.toMatchObject({reason: 'file-not-found'});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps a request timeout to the timeout reason', async () => {
    fetchMock.mockRejectedValue(
      Object.assign(new Error('The operation timed out'), {name: 'TimeoutError'}),
    );
    const client = createGiteaApiClient();

    const result = client.getRepository({owner: 'shipfox', repo: 'platform'});

    await expect(result).rejects.toMatchObject({reason: 'timeout'});
  });

  it('reports an existing organization as present', async () => {
    fetchMock.mockResolvedValue(jsonResponse({username: 'shipfox'}));
    const client = createGiteaApiClient();

    const exists = await client.organizationExists({org: 'shipfox'});

    expect(exists).toBe(true);
    expect(requestedUrl().pathname).toBe('/api/v1/orgs/shipfox');
  });

  it('reports a missing organization as absent', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, {status: 404}));
    const client = createGiteaApiClient();

    const exists = await client.organizationExists({org: 'ghost'});

    expect(exists).toBe(false);
  });

  it('surfaces a non-404 error while checking an organization', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, {status: 403}));
    const client = createGiteaApiClient();

    const result = client.organizationExists({org: 'shipfox'});

    await expect(result).rejects.toMatchObject({reason: 'access-denied'});
  });

  it('registers an org push webhook and returns its id as a string', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse({id: 99}, {status: 201}));
    const client = createGiteaApiClient();

    const webhook = await client.createOrgPushWebhook({org: 'shipfox'});

    expect(webhook).toEqual({id: '99', reused: false});
    const listUrl = requestedUrl(0);
    expect(listUrl.pathname).toBe('/api/v1/orgs/shipfox/hooks');
    expect(requestInit(0).method ?? 'GET').toBe('GET');
    const createUrl = requestedUrl(1);
    expect(createUrl.pathname).toBe('/api/v1/orgs/shipfox/hooks');
    const init = requestInit(1);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect(JSON.parse(String(init.body))).toEqual({
      type: 'gitea',
      active: true,
      events: ['push'],
      config: {
        url: 'https://api.example.com/webhooks/integrations/gitea',
        content_type: 'json',
        secret: 'test-webhook-secret',
      },
    });
  });

  it('reuses an existing push webhook that targets the configured url', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        {id: 1, config: {url: 'https://elsewhere.example.com'}},
        {id: 7, config: {url: 'https://api.example.com/webhooks/integrations/gitea'}},
      ]),
    );
    const client = createGiteaApiClient();

    const webhook = await client.createOrgPushWebhook({org: 'shipfox'});

    expect(webhook).toEqual({id: '7', reused: true});
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a webhook response without a numeric id', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse({id: 'not-a-number'}, {status: 201}));
    const client = createGiteaApiClient();

    const result = client.createOrgPushWebhook({org: 'shipfox'});

    await expect(result).rejects.toMatchObject({reason: 'malformed-provider-response'});
  });

  it('deletes an org webhook by id', async () => {
    fetchMock.mockResolvedValue(new Response(null, {status: 204}));
    const client = createGiteaApiClient();

    await client.deleteOrgWebhook({org: 'shipfox', webhookId: '7'});

    const url = requestedUrl();
    expect(url.pathname).toBe('/api/v1/orgs/shipfox/hooks/7');
    expect(requestInit().method).toBe('DELETE');
  });

  it('treats a missing webhook on delete as already removed', async () => {
    fetchMock.mockResolvedValue(new Response(null, {status: 404}));
    const client = createGiteaApiClient();

    await expect(
      client.deleteOrgWebhook({org: 'shipfox', webhookId: '7'}),
    ).resolves.toBeUndefined();
  });

  it('surfaces a non-404 error on delete', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, {status: 500}));
    const client = createGiteaApiClient();

    const result = client.deleteOrgWebhook({org: 'shipfox', webhookId: '7'});

    await expect(result).rejects.toMatchObject({reason: 'provider-unavailable'});
  });
});
