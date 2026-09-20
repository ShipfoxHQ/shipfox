import {createPosthogApiClient} from './client.js';

describe('PostHog API client', () => {
  it.each([
    ['us', 'https://us.posthog.com/api/personal_api_keys/@current/'],
    ['eu', 'https://eu.posthog.com/api/personal_api_keys/@current/'],
  ] as const)('probes the %s regional API', async (region, expectedUrl) => {
    const fetch = vi.fn().mockResolvedValue({status: 401});
    const client = createPosthogApiClient({fetch});

    await expect(client.probeCredential({region, apiKey: 'phx_secret'})).resolves.toEqual({
      status: 401,
    });

    expect(fetch).toHaveBeenCalledWith(expectedUrl, {
      headers: {authorization: 'Bearer phx_secret'},
    });
  });
});
