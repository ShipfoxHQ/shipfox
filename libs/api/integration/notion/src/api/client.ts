import {logger} from '@shipfox/node-opentelemetry';
import ky, {HTTPError, TimeoutError} from 'ky';
import {config} from '#config.js';
import {NotionIntegrationProviderError} from '#core/errors.js';

export const NOTION_API_VERSION = '2026-03-11';
export const NOTION_API_TIMEOUT_MS = 10_000;

const NOTION_OAUTH_TOKEN_PATH = '/v1/oauth/token';
const NOTION_OAUTH_REVOKE_PATH = '/v1/oauth/revoke';
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

export interface NotionAuthorization {
  accessToken: string;
  refreshToken?: string | undefined;
  expiresAt?: Date | undefined;
}

export interface NotionApiClient {
  refreshAccessToken(input: {refreshToken: string}): Promise<NotionAuthorization>;
  revokeToken(input: {token: string}): Promise<void>;
}

interface NotionTokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
}

export function createNotionAgentToolsClient(): NotionAgentToolsClient {
  return {request: requestNotionRest};
}

export function createNotionApiClient(): NotionApiClient {
  return {
    async refreshAccessToken(input) {
      const body = await requestNotionOauth('refresh-access-token', () =>
        ky
          .post(notionApiUrl(NOTION_OAUTH_TOKEN_PATH), {
            headers: basicAuthHeaders(),
            json: {
              grant_type: 'refresh_token',
              refresh_token: input.refreshToken,
            },
            timeout: NOTION_API_TIMEOUT_MS,
          })
          .json<NotionTokenResponse>(),
      );

      return parseRefreshResponse(body);
    },

    async revokeToken(input) {
      await requestNotionOauth('revoke-token', async () => {
        await ky.post(notionApiUrl(NOTION_OAUTH_REVOKE_PATH), {
          headers: basicAuthHeaders(),
          json: {token: input.token},
          timeout: NOTION_API_TIMEOUT_MS,
        });
      });
    },
  };
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

function basicAuthHeaders(): Record<string, string> {
  const credentials = `${config.NOTION_OAUTH_CLIENT_ID}:${config.NOTION_OAUTH_CLIENT_SECRET}`;
  return {authorization: `Basic ${Buffer.from(credentials).toString('base64')}`};
}

function parseRefreshResponse(body: NotionTokenResponse): NotionAuthorization {
  if (typeof body.access_token !== 'string' || body.access_token.length === 0) {
    throw new NotionIntegrationProviderError(
      'malformed-provider-response',
      'Notion refresh response did not include an access token',
    );
  }
  if (typeof body.refresh_token !== 'string' || body.refresh_token.length === 0) {
    throw new NotionIntegrationProviderError(
      'malformed-provider-response',
      'Notion refresh response did not include a refresh token',
    );
  }

  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: parseExpiresAt(body.expires_in),
  };
}

function parseExpiresAt(expiresIn: unknown): Date | undefined {
  if (expiresIn === undefined) return undefined;
  if (typeof expiresIn !== 'number' || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new NotionIntegrationProviderError(
      'malformed-provider-response',
      'Notion token response included a malformed expiry',
    );
  }
  return new Date(Date.now() + expiresIn * 1000);
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

async function requestNotionOauth<T>(operation: string, request: () => Promise<T>): Promise<T> {
  try {
    return await request();
  } catch (error) {
    if (error instanceof NotionIntegrationProviderError) throw error;
    if (error instanceof HTTPError) throw mapNotionHttpError(operation, error);
    if (error instanceof TimeoutError) {
      logger().warn({operation}, 'Notion API request timed out');
      throw new NotionIntegrationProviderError('timeout', 'Notion request timed out');
    }
    logger().warn(
      {operation, errName: error instanceof Error ? error.name : typeof error},
      'Notion API request failed',
    );
    throw new NotionIntegrationProviderError('provider-unavailable', 'Notion request failed');
  }
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

function mapNotionHttpError(operation: string, error: HTTPError): NotionIntegrationProviderError {
  const {status, statusText} = error.response;
  logger().warn({operation, status, statusText}, 'Notion API request rejected');
  if (status === 429) {
    return new NotionIntegrationProviderError(
      'rate-limited',
      'Notion request was rate limited',
      retryAfterSeconds(error.response.headers),
      status,
    );
  }
  if (status >= 500) {
    return new NotionIntegrationProviderError(
      'provider-unavailable',
      'Notion request failed',
      undefined,
      status,
    );
  }

  const providerErrorCode = readProviderErrorCode(error);
  return new NotionIntegrationProviderError(
    'access-denied',
    'Notion request was rejected',
    undefined,
    status,
    providerErrorCode,
  );
}

function readProviderErrorCode(error: HTTPError): string | undefined {
  const body = error.data;
  if (typeof body !== 'object' || body === null || !('error' in body)) return undefined;
  return typeof body.error === 'string' ? body.error : undefined;
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
