import type {PosthogRegion} from '@shipfox/api-integration-posthog-dto';

const posthogApiBases: Record<PosthogRegion, string> = {
  us: 'https://us.posthog.com',
  eu: 'https://eu.posthog.com',
};

export interface PosthogCredentialProbeResult {
  status: number;
}

export interface PosthogApiClient {
  probeCredential(params: {
    region: PosthogRegion;
    apiKey: string;
  }): Promise<PosthogCredentialProbeResult>;
}

export interface CreatePosthogApiClientOptions {
  fetch?: typeof globalThis.fetch | undefined;
}

/**
 * The probe deliberately returns the HTTP status instead of interpreting the
 * response body. PostHog's 401 is the only reliable signal that a key is dead.
 */
export function createPosthogApiClient(
  options: CreatePosthogApiClientOptions = {},
): PosthogApiClient {
  const fetchImplementation = options.fetch ?? globalThis.fetch;

  return {
    async probeCredential({region, apiKey}) {
      const response = await fetchImplementation(
        `${posthogApiBases[region]}/api/personal_api_keys/@current/`,
        {
          headers: {authorization: `Bearer ${apiKey}`},
        },
      );
      return {status: response.status};
    },
  };
}

export function posthogApiBase(region: PosthogRegion): string {
  return posthogApiBases[region];
}
