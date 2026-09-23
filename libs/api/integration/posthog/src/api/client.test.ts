import {PosthogIntegrationProviderError} from '#core/errors.js';
import {createPosthogApiClient} from './client.js';

const requiredScopes = [
  'dashboard:read',
  'error_tracking:read',
  'event_definition:read',
  'experiment:read',
  'feature_flag:read',
  'insight:read',
  'project:read',
  'property_definition:read',
  'query:read',
  'survey:read',
];

function credentialResponse(scopedTeams: number[] | null = [], scopes: string[] = requiredScopes) {
  return Response.json({scopes, scoped_teams: scopedTeams});
}

describe('PostHog API client', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ['us', 'https://us.posthog.com/api/personal_api_keys/@current/'],
    ['eu', 'https://eu.posthog.com/api/personal_api_keys/@current/'],
  ] as const)('probes the %s regional API', async (region, expectedUrl) => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const fetch = vi.fn().mockResolvedValue({status: 401, body: {cancel}});
    const client = createPosthogApiClient({fetch});

    await expect(client.probeCredential({region, apiKey: 'phx_secret'})).resolves.toEqual({
      status: 401,
    });

    expect(fetch).toHaveBeenCalledWith(expectedUrl, {
      headers: {authorization: 'Bearer phx_secret'},
      signal: expect.any(AbortSignal),
    });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each([
    ['us', 'https://us.posthog.com'],
    ['eu', 'https://eu.posthog.com'],
  ] as const)('uses the %s API base', async (region, baseUrl) => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(credentialResponse())
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [{id: 'project-1', name: 'Analytics', organization_id: 'org-1'}],
          }),
          {status: 200, headers: {'content-type': 'application/json'}},
        ),
      );

    await createPosthogApiClient().listProjects({region, apiKey: 'phx_secret'});

    expect(fetchMock).toHaveBeenCalledWith(
      `${baseUrl}/api/projects/`,
      expect.objectContaining({
        headers: expect.objectContaining({authorization: 'Bearer phx_secret'}),
      }),
    );
  });

  it('uses the E2E API base override for every region', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(credentialResponse())
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([{id: 'project-1', name: 'Analytics', organization_id: 'org-1'}]),
          {
            status: 200,
            headers: {'content-type': 'application/json'},
          },
        ),
      )
      .mockResolvedValueOnce({
        status: 200,
        body: {cancel: vi.fn().mockResolvedValue(undefined)},
      } as unknown as Response);
    const client = createPosthogApiClient({apiBaseUrl: 'http://127.0.0.1:16116/'});

    await client.listProjects({region: 'us', apiKey: 'phx_secret'});
    await client.probeCredential({region: 'eu', apiKey: 'phx_secret'});

    expect(fetchMock.mock.calls[1]?.[0]).toBe('http://127.0.0.1:16116/api/projects/');
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      'http://127.0.0.1:16116/api/personal_api_keys/@current/',
    );
  });

  it.each([
    {scopedTeams: [101]},
    {scopedTeams: [101, 202]},
  ])('resolves scoped projects without listing globally: $scopedTeams', async ({scopedTeams}) => {
    const fetch = vi.fn((url: string | URL | Request) => {
      const path = new URL(String(url)).pathname;
      if (path === '/api/personal_api_keys/@current/')
        return Promise.resolve(credentialResponse(scopedTeams));
      if (path === '/api/projects/')
        return Promise.resolve(
          Response.json({detail: 'Scoped projects require project-based endpoints'}, {status: 403}),
        );
      const id = Number(path.split('/')[3]);
      return Promise.resolve(Response.json({id, name: `Project ${id}`, organization: 'org-1'}));
    });
    const projects = await createPosthogApiClient({fetch}).listProjects({
      region: 'eu',
      apiKey: 'phx_scoped',
    });

    expect(projects).toEqual(
      scopedTeams.map((id) => ({id: String(id), name: `Project ${id}`, organizationId: 'org-1'})),
    );
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
      'https://eu.posthog.com/api/personal_api_keys/@current/',
      ...scopedTeams.map((id) => `https://eu.posthog.com/api/projects/${id}/`),
    ]);
  });

  it('accepts null project scoping and a paginated list response', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(credentialResponse(null))
      .mockResolvedValueOnce(
        Response.json({
          results: [{id: 101, name: 'Analytics', organization: 'org-1'}],
          next: null,
        }),
      );
    await expect(
      createPosthogApiClient({fetch}).listProjects({region: 'us', apiKey: 'phx_key'}),
    ).resolves.toEqual([{id: '101', name: 'Analytics', organizationId: 'org-1'}]);
  });

  it('checks the stored project directly for a scoped replacement', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(credentialResponse([101, 202]))
      .mockResolvedValueOnce(
        Response.json({
          id: 202,
          name: 'Product',
          organization: 'org-1',
        }),
      );
    await expect(
      createPosthogApiClient({fetch}).getProject({
        region: 'eu',
        apiKey: 'phx_key',
        projectId: '202',
      }),
    ).resolves.toMatchObject({id: '202'});
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1]?.[0]).toBe('https://eu.posthog.com/api/projects/202/');
  });

  it('rejects a replacement scoped to another project before fetching it', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(credentialResponse([101]));
    await expect(
      createPosthogApiClient({fetch}).getProject({
        region: 'eu',
        apiKey: 'phx_key',
        projectId: '202',
      }),
    ).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each(
    requiredScopes,
  )('rejects a credential missing %s before discovering projects', async (missingScope) => {
    const fetch = vi.fn().mockResolvedValueOnce(
      credentialResponse(
        [101],
        requiredScopes.filter((scope) => scope !== missingScope),
      ),
    );
    await expect(
      createPosthogApiClient({fetch}).listProjects({region: 'eu', apiKey: 'phx_key'}),
    ).rejects.toMatchObject({
      name: 'PosthogMissingScopesError',
      missingScopes: [missingScope],
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([
    {scopes: ['*']},
    {scopes: requiredScopes.map((scope) => scope.replace(':read', ':write'))},
  ])('accepts grants that include the required reads: $scopes', async ({scopes}) => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(credentialResponse([], scopes))
      .mockResolvedValueOnce(Response.json([]));
    await expect(
      createPosthogApiClient({fetch}).listProjects({region: 'eu', apiKey: 'phx_key'}),
    ).resolves.toEqual([]);
  });

  it.each([
    {},
    {scopes: requiredScopes},
    {scopes: requiredScopes, scoped_teams: ['101']},
    {scopes: 'query:read', scoped_teams: []},
  ])('rejects malformed credential metadata without falling back to global discovery: %j', async (payload) => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json(payload));
    await expect(
      createPosthogApiClient({fetch}).listProjects({region: 'eu', apiKey: 'phx_key'}),
    ).rejects.toMatchObject({reason: 'malformed-provider-response'});
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('rejects a project response with a different identity', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(credentialResponse([101]))
      .mockResolvedValueOnce(
        Response.json({id: 202, name: 'Wrong project', organization: 'org-1'}),
      );
    await expect(
      createPosthogApiClient({fetch}).listProjects({region: 'eu', apiKey: 'phx_key'}),
    ).rejects.toMatchObject({reason: 'malformed-provider-response'});
  });

  it('treats a deleted project as inaccessible', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(credentialResponse([101]))
      .mockResolvedValueOnce(Response.json({detail: 'Not found'}, {status: 404}));
    await expect(
      createPosthogApiClient({fetch}).getProject({
        region: 'eu',
        apiKey: 'phx_key',
        projectId: '101',
      }),
    ).resolves.toBeUndefined();
  });

  it('sends the contract validation query to the selected project', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));

    await createPosthogApiClient().validateQuery({
      region: 'eu',
      apiKey: 'phx_secret',
      projectId: 'project/1',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://eu.posthog.com/api/projects/project%2F1/query/',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          query: {kind: 'HogQLQuery', query: 'SELECT 1 AS contract_probe'},
        }),
      }),
    );
  });

  it.each([
    {status: 401, reason: 'credentials-unavailable'},
    {status: 403, reason: 'access-denied'},
  ] as const)('maps HTTP $status to $reason', async ({status, reason}) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({detail: 'Personal API keys are disabled'}), {status}),
    );

    const error = await createPosthogApiClient()
      .listProjects({region: 'eu', apiKey: 'phx_secret'})
      .catch((value: unknown) => value);

    expect(error).toBeInstanceOf(PosthogIntegrationProviderError);
    expect(error).toMatchObject({
      message: `PostHog responded ${status}: Personal API keys are disabled`,
      reason,
      status,
    });
  });

  it('maps HTTP 429 to a rate-limited provider error with Retry-After seconds', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({detail: 'Too many requests'}), {
        status: 429,
        headers: {'retry-after': '19'},
      }),
    );

    await expect(
      createPosthogApiClient().listProjects({region: 'eu', apiKey: 'phx_secret'}),
    ).rejects.toMatchObject({
      message: 'PostHog responded 429: Too many requests',
      reason: 'rate-limited',
      retryAfterSeconds: 19,
      status: 429,
    });
  });

  it('maps an aborted response body to a timeout provider error', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"results":['));
        controller.error(Object.assign(new Error('body stalled'), {name: 'AbortError'}));
      },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, {status: 200}));

    await expect(
      createPosthogApiClient().listProjects({region: 'eu', apiKey: 'phx_secret'}),
    ).rejects.toMatchObject({reason: 'timeout', message: 'PostHog request timed out'});
  });

  it('stops consuming an oversized provider error body at the byte cap', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('x'.repeat(9 * 1024)));
      },
      cancel() {
        cancelled = true;
      },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, {status: 401}));

    await expect(
      createPosthogApiClient().listProjects({region: 'eu', apiKey: 'phx_secret'}),
    ).rejects.toMatchObject({
      message: `PostHog responded 401: ${'x'.repeat(499)}…`,
      reason: 'credentials-unavailable',
      status: 401,
    });
    expect(cancelled).toBe(true);
  });

  it('exposes the direct credential probe', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));

    await createPosthogApiClient().probeCredential({region: 'us', apiKey: 'phx_secret'});

    expect(fetchMock).toHaveBeenCalledWith(
      'https://us.posthog.com/api/personal_api_keys/@current/',
      expect.anything(),
    );
  });
});
