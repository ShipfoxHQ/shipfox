import {logger} from '@shipfox/node-opentelemetry';
import ky, {HTTPError, TimeoutError} from 'ky';
import {config} from '#config.js';
import {ClickUpIntegrationProviderError} from '#core/errors.js';

const CLICKUP_API_TIMEOUT_MS = 10_000;
const TRAILING_SLASHES_RE = /\/+$/;

export type ClickUpAgentToolHttpMethod = 'GET' | 'POST' | 'PUT';
export type ClickUpAgentToolQueryValue =
  | string
  | number
  | boolean
  | readonly (string | number)[]
  | undefined;

export interface ClickUpAgentToolRequest {
  accessToken: string;
  teamId: string;
  method: ClickUpAgentToolHttpMethod;
  path: string;
  query?: Record<string, ClickUpAgentToolQueryValue> | undefined;
  body?: unknown;
  operation?: string | undefined;
}

export interface ClickUpAgentToolResponse {
  status: number;
  body: unknown;
}

export interface ClickUpAgentToolsClient {
  request(input: ClickUpAgentToolRequest): Promise<ClickUpAgentToolResponse>;
}

export function createClickUpAgentToolsClient(): ClickUpAgentToolsClient {
  return {request: requestClickUpRest};
}

async function requestClickUpRest(
  input: ClickUpAgentToolRequest,
): Promise<ClickUpAgentToolResponse> {
  return await mapClickUpError(input.operation ?? 'agent-tool', async () => {
    try {
      const response = await ky(clickUpRestUrl(input.path), {
        method: input.method,
        headers: {authorization: `Bearer ${input.accessToken}`},
        ...(input.query === undefined ? {} : {searchParams: clickUpQueryParams(input.query)}),
        ...(input.body === undefined ? {} : {json: input.body}),
        timeout: CLICKUP_API_TIMEOUT_MS,
      });
      return {status: response.status, body: await readClickUpResponseBody(response)};
    } catch (error) {
      if (
        error instanceof HTTPError &&
        (error.response.status === 400 || error.response.status === 404)
      ) {
        return {
          status: error.response.status,
          body: await readClickUpResponseBody(error.response),
        };
      }
      throw error;
    }
  });
}

function clickUpRestUrl(path: string): string {
  const baseUrl = config.CLICKUP_API_BASE_URL.replace(TRAILING_SLASHES_RE, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${baseUrl}/api/v2${normalizedPath}`;
}

function clickUpQueryParams(
  query: Record<string, ClickUpAgentToolQueryValue>,
): URLSearchParams | undefined {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, String(item));
      continue;
    }
    params.set(key, String(value));
  }
  return params.size > 0 ? params : undefined;
}

async function readClickUpResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function mapClickUpError<T>(operation: string, request: () => Promise<T>): Promise<T> {
  try {
    return await request();
  } catch (error) {
    if (error instanceof ClickUpIntegrationProviderError) throw error;
    throw mapUnknownClickUpError(operation, error);
  }
}

function mapUnknownClickUpError(
  operation: string,
  error: unknown,
): ClickUpIntegrationProviderError {
  if (error instanceof HTTPError) return mapClickUpHttpError(operation, error);
  if (error instanceof TimeoutError) {
    logger().warn({operation}, 'ClickUp API request timed out');
    return new ClickUpIntegrationProviderError('timeout', 'ClickUp request timed out');
  }
  logger().warn(
    {operation, errName: error instanceof Error ? error.name : typeof error},
    'ClickUp API request failed',
  );
  return new ClickUpIntegrationProviderError('provider-unavailable', 'ClickUp request failed');
}

function mapClickUpHttpError(operation: string, error: HTTPError): ClickUpIntegrationProviderError {
  const {status, statusText, headers} = error.response;
  logger().warn({operation, status, statusText}, 'ClickUp API request rejected');
  if (status === 429) {
    return new ClickUpIntegrationProviderError(
      'rate-limited',
      'ClickUp request was rate limited',
      retryAfterSeconds(headers),
      status,
    );
  }
  if (status >= 500) {
    return new ClickUpIntegrationProviderError(
      'provider-unavailable',
      'ClickUp request failed',
      undefined,
      status,
    );
  }
  if (status === 401 || status === 403) {
    return new ClickUpIntegrationProviderError(
      'access-denied',
      'ClickUp request was rejected',
      undefined,
      status,
    );
  }
  return new ClickUpIntegrationProviderError(
    'provider-rejected',
    'ClickUp request was rejected',
    undefined,
    status,
  );
}

function retryAfterSeconds(headers: Headers): number | undefined {
  const reset = headers.get('x-ratelimit-reset');
  if (reset !== null) {
    const resetAt = Number.parseInt(reset, 10);
    if (Number.isFinite(resetAt)) return Math.max(0, resetAt - Math.floor(Date.now() / 1000));
  }
  const retryAfter = headers.get('retry-after');
  if (retryAfter === null) return undefined;
  const parsed = Number.parseInt(retryAfter, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}
