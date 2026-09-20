import type {PosthogRegion} from '@shipfox/api-integration-posthog-dto';
import {PosthogIntegrationProviderError} from '#core/errors.js';

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_ERROR_BODY_BYTES = 8 * 1024;
const MAX_ERROR_MESSAGE_LENGTH = 500;

const posthogApiBases: Record<PosthogRegion, string> = {
  us: 'https://us.posthog.com',
  eu: 'https://eu.posthog.com',
};

export interface PosthogProject {
  id: string;
  name: string;
  organizationId: string;
}

export interface PosthogCredentialProbeResult {
  status: number;
}

export interface PosthogApiClient {
  listProjects(input: {region: PosthogRegion; apiKey: string}): Promise<PosthogProject[]>;
  validateQuery(input: {region: PosthogRegion; apiKey: string; projectId: string}): Promise<void>;
  probeCredential(input: {
    region: PosthogRegion;
    apiKey: string;
  }): Promise<PosthogCredentialProbeResult>;
}

export interface CreatePosthogApiClientOptions {
  fetch?: typeof globalThis.fetch | undefined;
}

export function posthogApiBaseUrl(region: PosthogRegion): string {
  return posthogApiBases[region];
}

export function posthogApiBase(region: PosthogRegion): string {
  return posthogApiBaseUrl(region);
}

export function createPosthogApiClient(
  options: CreatePosthogApiClientOptions = {},
): PosthogApiClient {
  return new HttpPosthogApiClient(options.fetch ?? globalThis.fetch);
}

class HttpPosthogApiClient implements PosthogApiClient {
  constructor(private readonly fetchImplementation: typeof globalThis.fetch) {}

  async listProjects(input: {region: PosthogRegion; apiKey: string}): Promise<PosthogProject[]> {
    const response = await this.request(input, '/api/projects/');
    const payload = await parseJson(response);
    let projects: unknown[] | undefined;
    if (Array.isArray(payload)) {
      projects = payload;
    } else if (isRecord(payload) && Array.isArray(payload.results)) {
      projects = payload.results;
    }
    if (!projects) {
      throw new PosthogIntegrationProviderError(
        'malformed-provider-response',
        'PostHog project list response was not an array',
      );
    }

    return projects.map(toPosthogProject);
  }

  async validateQuery(input: {
    region: PosthogRegion;
    apiKey: string;
    projectId: string;
  }): Promise<void> {
    const response = await this.request(
      input,
      `/api/projects/${encodeURIComponent(input.projectId)}/query/`,
      {
        method: 'POST',
        body: {
          query: {
            kind: 'HogQLQuery',
            query: 'SELECT 1 AS contract_probe',
          },
        },
      },
    );
    await consumeResponse(response);
  }

  async probeCredential(input: {
    region: PosthogRegion;
    apiKey: string;
  }): Promise<PosthogCredentialProbeResult> {
    let response: Response;
    try {
      response = await this.fetchImplementation(
        `${posthogApiBaseUrl(input.region)}/api/personal_api_keys/@current/`,
        {
          headers: {authorization: `Bearer ${input.apiKey}`},
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      );
    } catch (error) {
      if (isPosthogTimeoutError(error)) throw posthogTimeoutError();
      throw new PosthogIntegrationProviderError(
        'provider-unavailable',
        `PostHog request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const status = response.status;
    await response.body?.cancel();
    return {status};
  }

  private async request(
    input: {region: PosthogRegion; apiKey: string},
    path: string,
    options: {method?: string; body?: unknown} = {},
  ): Promise<Response> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${input.apiKey}`,
      accept: 'application/json',
    };
    const init: RequestInit = {
      method: options.method ?? 'GET',
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    };
    if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }

    let response: Response;
    try {
      response = await this.fetchImplementation(`${posthogApiBaseUrl(input.region)}${path}`, init);
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === 'TimeoutError' || error.name === 'AbortError')
      ) {
        throw new PosthogIntegrationProviderError('timeout', 'PostHog request timed out');
      }
      throw new PosthogIntegrationProviderError(
        'provider-unavailable',
        `PostHog request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (response.ok) return response;
    throw await posthogHttpError(response);
  }
}

async function posthogHttpError(response: Response): Promise<PosthogIntegrationProviderError> {
  const message = await responseErrorMessage(response);
  if (response.status === 401) {
    return new PosthogIntegrationProviderError(
      'credentials-unavailable',
      message,
      undefined,
      response.status,
    );
  }
  if (response.status === 403) {
    return new PosthogIntegrationProviderError(
      'access-denied',
      message,
      undefined,
      response.status,
    );
  }
  if (response.status >= 400 && response.status < 500) {
    return new PosthogIntegrationProviderError(
      'provider-rejected',
      message,
      undefined,
      response.status,
    );
  }
  return new PosthogIntegrationProviderError(
    'provider-unavailable',
    message,
    undefined,
    response.status,
  );
}

async function responseErrorMessage(response: Response): Promise<string> {
  const fallback = `PostHog responded ${response.status}`;
  let body: string;
  try {
    body = (await response.text()).slice(0, MAX_ERROR_BODY_BYTES);
  } catch {
    return fallback;
  }
  const trimmed = body.trim();
  if (!trimmed) return fallback;

  try {
    const payload: unknown = JSON.parse(trimmed);
    if (isRecord(payload)) {
      for (const key of ['detail', 'message', 'error']) {
        const value = payload[key];
        if (typeof value === 'string' && value.trim()) {
          return `${fallback}: ${truncate(value)}`;
        }
      }
    }
  } catch {
    // PostHog can return plain text, notably for invalid API keys.
  }
  return `${fallback}: ${truncate(trimmed)}`;
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new PosthogIntegrationProviderError(
      'malformed-provider-response',
      'PostHog returned invalid JSON',
    );
  }
}

async function consumeResponse(response: Response): Promise<void> {
  await response.arrayBuffer();
}

function toPosthogProject(value: unknown): PosthogProject {
  if (!isRecord(value) || (typeof value.id !== 'string' && typeof value.id !== 'number')) {
    throw new PosthogIntegrationProviderError(
      'malformed-provider-response',
      'PostHog project list contains a project without an id',
    );
  }
  if (typeof value.name !== 'string' || !value.name.trim()) {
    throw new PosthogIntegrationProviderError(
      'malformed-provider-response',
      'PostHog project list contains a project without a name',
    );
  }

  const organization = isRecord(value.organization) ? value.organization : undefined;
  let organizationId = '';
  if (typeof value.organization_id === 'string') {
    organizationId = value.organization_id;
  } else if (organization && typeof organization.id === 'string') {
    organizationId = organization.id;
  }
  if (!organizationId) {
    throw new PosthogIntegrationProviderError(
      'malformed-provider-response',
      'PostHog project list contains a project without an organization id',
    );
  }

  return {id: String(value.id), name: value.name, organizationId};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function truncate(value: string): string {
  return value.length > MAX_ERROR_MESSAGE_LENGTH
    ? `${value.slice(0, MAX_ERROR_MESSAGE_LENGTH - 1)}…`
    : value;
}
