import {IntegrationProviderError} from '@shipfox/api-integration-spi';
import {logger} from '@shipfox/node-opentelemetry';
import ky, {HTTPError, TimeoutError} from 'ky';
import {config} from '#config.js';
import {ClickUpIntegrationProviderError} from '#core/errors.js';

const CLICKUP_API_TIMEOUT_MS = 10_000;
const TRAILING_SLASHES_RE = /\/+$/;

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

export interface ClickUpApiClient {
  exchangeAuthorizationCode(input: {code: string}): Promise<ClickUpAuthorization>;
  getAuthorizedWorkspaces(input: {accessToken: string}): Promise<ClickUpAuthorizedWorkspace[]>;
  getAuthorizedUser(input: {accessToken: string}): Promise<ClickUpAuthorizedUser>;
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
      if (typeof body.access_token !== 'string' || body.access_token.length === 0) {
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
  };
}

export async function mapClickUpError<T>(operation: string, request: () => Promise<T>): Promise<T> {
  try {
    return await request();
  } catch (error) {
    if (error instanceof ClickUpIntegrationProviderError) throw error;
    if (error instanceof IntegrationProviderError) throw error;
    if (error instanceof HTTPError) throw mapClickUpHttpError(operation, error);
    if (error instanceof TimeoutError) {
      logger().warn({operation}, 'ClickUp API request timed out');
      throw new ClickUpIntegrationProviderError('timeout', 'ClickUp request timed out');
    }
    logger().warn(
      {operation, errName: error instanceof Error ? error.name : typeof error},
      'ClickUp API request failed',
    );
    throw new ClickUpIntegrationProviderError('provider-unavailable', 'ClickUp request failed');
  }
}

function mapClickUpHttpError(operation: string, error: HTTPError): ClickUpIntegrationProviderError {
  const {status, statusText, headers} = error.response;
  logger().warn({operation, status, statusText}, 'ClickUp API request rejected');
  if (status === 429) {
    return new ClickUpIntegrationProviderError(
      'rate-limited',
      'ClickUp request was rate limited',
      retryAfterSeconds(headers),
    );
  }
  if (status === 401 || status === 403) {
    return new ClickUpIntegrationProviderError('access-denied', 'ClickUp request was rejected');
  }
  if (status >= 500) {
    return new ClickUpIntegrationProviderError('provider-unavailable', 'ClickUp request failed');
  }
  return new ClickUpIntegrationProviderError(
    'malformed-provider-response',
    'ClickUp request was rejected',
  );
}

function clickUpApiUrl(path: string): string {
  const base = config.CLICKUP_API_BASE_URL.replace(TRAILING_SLASHES_RE, '');
  return `${base}${path}`;
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

function malformed(message: string): ClickUpIntegrationProviderError {
  return new ClickUpIntegrationProviderError('malformed-provider-response', message);
}

function retryAfterSeconds(headers: Headers): number | undefined {
  const value = headers.get('x-ratelimit-reset');
  if (!value) return undefined;
  const resetAt = Number.parseInt(value, 10);
  if (!Number.isFinite(resetAt)) return undefined;
  return Math.max(0, resetAt - Math.floor(Date.now() / 1000));
}
