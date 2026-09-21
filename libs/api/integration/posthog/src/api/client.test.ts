import {PosthogIntegrationProviderError} from '#core/errors.js';
import {createPosthogApiClient} from './client.js';

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
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
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

    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://127.0.0.1:16116/api/projects/');
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'http://127.0.0.1:16116/api/personal_api_keys/@current/',
    );
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
