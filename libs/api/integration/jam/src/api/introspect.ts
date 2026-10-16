import {z} from 'zod';
import {JamIntegrationProviderError} from '#core/errors.js';
import {jamUnavailable} from '#core/mcp-client.js';

export const DEFAULT_JAM_API_BASE_URL = 'https://api.jam.dev';

const REQUEST_TIMEOUT_MS = 30_000;
const TRAILING_SLASH_RE = /\/$/u;
const WHITESPACE_RE = /\s+/u;

const introspectionSchema = z.object({
  active: z.boolean(),
  team_id: z.string().min(1).optional(),
  user_id: z.string().min(1).optional(),
  scope: z.string().optional(),
});

export type JamIntrospection =
  | {active: false}
  | {active: true; teamId: string; userId: string; scopes: string[]};

export interface JamIntrospectionClient {
  introspect(token: string): Promise<JamIntrospection>;
}

export interface CreateJamIntrospectionClientOptions {
  fetch?: typeof globalThis.fetch | undefined;
  apiBaseUrl?: string | URL | undefined;
}

export function createJamIntrospectionClient(
  options: CreateJamIntrospectionClientOptions = {},
): JamIntrospectionClient {
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const apiBaseUrl = String(options.apiBaseUrl ?? DEFAULT_JAM_API_BASE_URL).replace(
    TRAILING_SLASH_RE,
    '',
  );

  return {
    async introspect(token) {
      const response = await request({fetchImplementation, apiBaseUrl, token});
      if (response.status === 401) return {active: false};
      assertSuccess(response);

      const parsed = introspectionSchema.safeParse(await response.json().catch(() => undefined));
      if (!parsed.success) throw malformedResponse();
      if (!parsed.data.active) return {active: false};
      if (parsed.data.team_id === undefined || parsed.data.user_id === undefined) {
        throw malformedResponse();
      }
      return {
        active: true,
        teamId: parsed.data.team_id,
        userId: parsed.data.user_id,
        scopes: (parsed.data.scope ?? '').split(WHITESPACE_RE).filter((scope) => scope !== ''),
      };
    },
  };
}

async function request(params: {
  fetchImplementation: typeof globalThis.fetch;
  apiBaseUrl: string;
  token: string;
}): Promise<Response> {
  try {
    return await params.fetchImplementation(`${params.apiBaseUrl}/oauth/introspect`, {
      method: 'POST',
      headers: {'content-type': 'application/x-www-form-urlencoded'},
      body: new URLSearchParams({token: params.token}),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new JamIntegrationProviderError('timeout', 'Jam timed out. Please try again.');
    }
    throw jamUnavailable();
  }
}

function assertSuccess(response: Response): void {
  if (response.status === 429) {
    throw new JamIntegrationProviderError(
      'rate-limited',
      'Jam rate limited the request. Please try again later.',
      undefined,
      response.status,
    );
  }
  if (response.status >= 500) throw jamUnavailable(response.status);
  if (!response.ok) {
    throw new JamIntegrationProviderError(
      'provider-rejected',
      'Jam rejected the request.',
      undefined,
      response.status,
    );
  }
}

function malformedResponse(): JamIntegrationProviderError {
  return new JamIntegrationProviderError(
    'malformed-provider-response',
    'Jam token introspection response was not valid',
  );
}
