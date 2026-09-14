import {clickupWebhookEventNames} from '@shipfox/api-integration-clickup-dto';
import {logger} from '@shipfox/node-opentelemetry';
import ky, {HTTPError, TimeoutError} from 'ky';
import {config} from '#config.js';
import {ClickUpIntegrationProviderError} from '#core/errors.js';

const CLICKUP_API_TIMEOUT_MS = 10_000;
const TRAILING_SLASHES_RE = /\/+$/;

export const CLICKUP_WEBHOOK_EVENTS = clickupWebhookEventNames;

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

export interface ClickUpAuthorization {
  accessToken: string;
}

export interface ClickUpAuthorizedWorkspace {
  id: string;
  name: string;
}

export interface ClickUpAuthorizedUser {
  id: string;
  username?: string | undefined;
  email?: string | undefined;
}

export interface ClickUpWebhookRegistration {
  id: string;
  secret: string;
}

export interface ClickUpApiClient {
  exchangeAuthorizationCode(input: {code: string}): Promise<ClickUpAuthorization>;
  getAuthorizedWorkspaces(input: {accessToken: string}): Promise<ClickUpAuthorizedWorkspace[]>;
  getAuthorizedUser(input: {accessToken: string}): Promise<ClickUpAuthorizedUser>;
  createWebhook(input: {
    accessToken: string;
    teamId: string;
    endpoint: string;
    events?: readonly string[] | undefined;
  }): Promise<ClickUpWebhookRegistration>;
  deleteWebhook(input: {accessToken: string; webhookId: string}): Promise<void>;
}

interface ClickUpTokenResponse {
  access_token?: unknown;
}

interface ClickUpTeamsResponse {
  teams?: unknown;
}

interface ClickUpUserResponse {
  user?: unknown;
}

interface ClickUpWebhookResponse {
  webhook?: unknown;
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
        retry: 0,
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

export function createClickUpApiClient(): ClickUpApiClient {
  return {
    async exchangeAuthorizationCode(input) {
      const body = await mapClickUpError('exchange-authorization-code', () =>
        ky
          .post(clickUpApiUrl('/api/v2/oauth/token'), {
            json: {
              client_id: config.CLICKUP_OAUTH_CLIENT_ID,
              client_secret: config.CLICKUP_OAUTH_CLIENT_SECRET,
              code: input.code,
            },
            timeout: CLICKUP_API_TIMEOUT_MS,
          })
          .json<ClickUpTokenResponse>(),
      );
      if (!body || typeof body.access_token !== 'string' || body.access_token.length === 0) {
        throw malformed('ClickUp authorization response did not include an access token');
      }
      return {accessToken: body.access_token};
    },

    async getAuthorizedWorkspaces(input) {
      const body = await mapClickUpError('get-authorized-workspaces', () =>
        ky
          .get(clickUpApiUrl('/api/v2/team'), {
            headers: {authorization: `Bearer ${input.accessToken}`},
            timeout: CLICKUP_API_TIMEOUT_MS,
          })
          .json<ClickUpTeamsResponse>(),
      );
      if (!body || !Array.isArray(body.teams)) {
        throw malformed('ClickUp authorized-workspaces response did not contain teams');
      }
      return body.teams.map(parseWorkspace);
    },

    async getAuthorizedUser(input) {
      const body = await mapClickUpError('get-authorized-user', () =>
        ky
          .get(clickUpApiUrl('/api/v2/user'), {
            headers: {authorization: `Bearer ${input.accessToken}`},
            timeout: CLICKUP_API_TIMEOUT_MS,
          })
          .json<ClickUpUserResponse>(),
      );
      if (!body?.user || typeof body.user !== 'object') {
        throw malformed('ClickUp authorized-user response did not contain a user');
      }
      return parseUser(body.user);
    },

    async createWebhook(input) {
      const body = await mapClickUpError('create-webhook', () =>
        ky
          .post(clickUpApiUrl(`/api/v2/team/${encodeURIComponent(input.teamId)}/webhook`), {
            headers: {authorization: `Bearer ${input.accessToken}`},
            json: {
              endpoint: input.endpoint,
              events: input.events ?? CLICKUP_WEBHOOK_EVENTS,
            },
            timeout: CLICKUP_API_TIMEOUT_MS,
          })
          .json<ClickUpWebhookResponse>(),
      );
      return parseWebhookRegistration(body);
    },

    async deleteWebhook(input) {
      await mapClickUpError('delete-webhook', () =>
        ky.delete(clickUpApiUrl(`/api/v2/webhook/${encodeURIComponent(input.webhookId)}`), {
          headers: {authorization: `Bearer ${input.accessToken}`},
          timeout: CLICKUP_API_TIMEOUT_MS,
        }),
      );
    },
  };
}

function clickUpRestUrl(path: string): string {
  const baseUrl = config.CLICKUP_API_BASE_URL.replace(TRAILING_SLASHES_RE, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${baseUrl}/api/v2${normalizedPath}`;
}

function clickUpApiUrl(path: string): string {
  const base = config.CLICKUP_API_BASE_URL.replace(TRAILING_SLASHES_RE, '');
  return `${base}${path}`;
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
    throw await mapUnknownClickUpError(operation, error);
  }
}

async function mapUnknownClickUpError(
  operation: string,
  error: unknown,
): Promise<ClickUpIntegrationProviderError> {
  if (error instanceof HTTPError) return await mapClickUpHttpError(operation, error);
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

async function mapClickUpHttpError(
  operation: string,
  error: HTTPError,
): Promise<ClickUpIntegrationProviderError> {
  const {status, statusText, headers} = error.response;
  const details = await clickUpErrorDetails(error.response);
  logger().warn(
    {
      operation,
      status,
      statusText,
      err: details.err,
      ECODE: details.ECODE,
    },
    'ClickUp API request rejected',
  );
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

function parseWorkspace(value: unknown): ClickUpAuthorizedWorkspace {
  if (!value || typeof value !== 'object')
    throw malformed('ClickUp workspace response was malformed');
  const {id, name} = value as {id?: unknown; name?: unknown};
  const workspaceId = stringId(id);
  if (!workspaceId || typeof name !== 'string' || name.length === 0) {
    throw malformed('ClickUp workspace response did not include a valid id and name');
  }
  return {id: workspaceId, name};
}

function parseUser(value: object): ClickUpAuthorizedUser {
  const {id, username, email} = value as {
    id?: unknown;
    username?: unknown;
    email?: unknown;
  };
  const userId = stringId(id);
  if (!userId) throw malformed('ClickUp authorized-user response did not include a valid id');
  return {
    id: userId,
    ...(typeof username === 'string' && username.length > 0 ? {username} : {}),
    ...(typeof email === 'string' && email.length > 0 ? {email} : {}),
  };
}

function stringId(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  return undefined;
}

function parseWebhookRegistration(body: ClickUpWebhookResponse): ClickUpWebhookRegistration {
  const value = body?.webhook ?? body;
  if (!value || typeof value !== 'object') {
    throw malformed('ClickUp webhook response did not contain a webhook');
  }
  const {id, secret} = value as {id?: unknown; secret?: unknown};
  const webhookId = stringId(id);
  if (!webhookId || typeof secret !== 'string' || secret.length === 0) {
    throw malformed('ClickUp webhook response did not include a valid id and secret');
  }
  return {id: webhookId, secret};
}

async function clickUpErrorDetails(response: Response): Promise<{
  err?: string;
  ECODE?: string;
}> {
  const body = await readClickUpResponseBody(response);
  if (!body || typeof body !== 'object') return {};
  const {err, ECODE} = body as {err?: unknown; ECODE?: unknown};
  return {
    ...(typeof err === 'string' ? {err} : {}),
    ...(typeof ECODE === 'string' ? {ECODE} : {}),
  };
}

function malformed(message: string): ClickUpIntegrationProviderError {
  return new ClickUpIntegrationProviderError('malformed-provider-response', message);
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
