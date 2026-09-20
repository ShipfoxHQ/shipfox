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

  it.each([401, 403])('passes the provider detail through for HTTP %s', async (status) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({detail: 'Personal API keys are disabled'}), {status}),
    );

    const error = await createPosthogApiClient()
      .listProjects({region: 'eu', apiKey: 'phx_secret'})
      .catch((value: unknown) => value);

    expect(error).toBeInstanceOf(PosthogIntegrationProviderError);
    expect(error).toMatchObject({
      message: `PostHog responded ${status}: Personal API keys are disabled`,
    });
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
