import {logger} from '@shipfox/node-opentelemetry';
import ky, {TimeoutError} from 'ky';
import {config} from '#config.js';
import {NotionIntegrationProviderError} from '#core/errors.js';

export const NOTION_API_VERSION = '2026-03-11';
export const NOTION_API_TIMEOUT_MS = 10_000;

const TRAILING_SLASHES_RE = /\/+$/;
const TIMEOUT_NAME_RE = /timed?\s*out|timeout/i;

export type NotionAgentToolHttpMethod = 'GET' | 'POST';
export type NotionAgentToolQueryValue = string | number | boolean | undefined;

export interface NotionAgentToolRequest {
  accessToken: string;
  method: NotionAgentToolHttpMethod;
  path: string;
  query?: Record<string, NotionAgentToolQueryValue> | undefined;
  body?: unknown;
  operation?: string | undefined;
}

export interface NotionAgentToolResponse {
  status: number;
  body: unknown;
}

export interface NotionAgentToolsClient {
  request(input: NotionAgentToolRequest): Promise<NotionAgentToolResponse>;
}

export function createNotionAgentToolsClient(): NotionAgentToolsClient {
  return {request: requestNotionRest};
}

async function requestNotionRest(input: NotionAgentToolRequest): Promise<NotionAgentToolResponse> {
  const operation = input.operation ?? 'agent-tool';
  try {
    const response = await ky(notionApiUrl(input.path), {
      method: input.method,
      headers: {
        authorization: `Bearer ${input.accessToken}`,
        'Notion-Version': NOTION_API_VERSION,
      },
      ...(input.query === undefined ? {} : {searchParams: notionQueryParams(input.query)}),
      ...(input.body === undefined ? {} : {json: input.body}),
      retry: 0,
      timeout: NOTION_API_TIMEOUT_MS,
      throwHttpErrors: false,
    });
    if (response.status === 429 || response.status === 408 || response.status >= 500) {
      throw mapNotionStatusError(operation, response.status, response.headers);
    }
    return {status: response.status, body: await readNotionResponseBody(response)};
  } catch (error) {
    throw mapNotionError(operation, error);
  }
}

export function notionApiUrl(path: string): string {
  const base = config.NOTION_API_BASE_URL.replace(TRAILING_SLASHES_RE, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}

function notionQueryParams(
  query: Record<string, NotionAgentToolQueryValue>,
): URLSearchParams | undefined {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  return params.size > 0 ? params : undefined;
}

async function readNotionResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function mapNotionError(operation: string, error: unknown): NotionIntegrationProviderError {
  if (error instanceof NotionIntegrationProviderError) return error;
  if (error instanceof TimeoutError || isTimeoutError(error)) {
    logger().warn({operation}, 'Notion API request timed out');
    return new NotionIntegrationProviderError('provider-unavailable', 'Notion request timed out');
  }
  logger().warn(
    {operation, errName: error instanceof Error ? error.name : typeof error},
    'Notion API request failed',
  );
  return new NotionIntegrationProviderError('provider-unavailable', 'Notion request failed');
}

function mapNotionStatusError(
  operation: string,
  status: number,
  headers: Headers,
): NotionIntegrationProviderError {
  logger().warn({operation, status}, 'Notion API request rejected');
  if (status === 429) {
    return new NotionIntegrationProviderError(
      'rate-limited',
      'Notion request was rate limited',
      retryAfterSeconds(headers),
      status,
    );
  }
  if (status === 408 || status >= 500) {
    return new NotionIntegrationProviderError(
      'provider-unavailable',
      status === 408 ? 'Notion request timed out' : 'Notion request failed',
      undefined,
      status,
    );
  }
  return new NotionIntegrationProviderError(
    'provider-rejected',
    'Notion request was rejected',
    undefined,
    status,
  );
}

function retryAfterSeconds(headers: Headers): number | undefined {
  const value = headers.get('retry-after');
  if (value === null) return undefined;
  const seconds = Number.parseInt(value, 10);
  return Number.isNaN(seconds) ? undefined : Math.max(0, seconds);
}

function isTimeoutError(error: unknown): boolean {
  return (
    error instanceof Error && (TIMEOUT_NAME_RE.test(error.name) || error.name === 'AbortError')
  );
}
