import {logger} from '@shipfox/node-opentelemetry';
import ky, {HTTPError, TimeoutError} from 'ky';
import {config} from '#config.js';
import {
  SlackEnterpriseInstallUnsupportedError,
  SlackIntegrationProviderError,
} from '#core/errors.js';

const SLACK_API_TIMEOUT_MS = 10_000;

export interface SlackAuthorization {
  accessToken: string;
  botUserId: string;
  appId: string;
  teamId: string;
  teamName: string;
  scopes: string[];
}

export interface SlackApiClient {
  exchangeAuthorizationCode(input: {code: string}): Promise<SlackAuthorization>;
  revokeToken(input: {token: string}): Promise<void>;
}

interface SlackOAuthAccessResponse {
  ok?: unknown;
  error?: unknown;
  access_token?: unknown;
  bot_user_id?: unknown;
  app_id?: unknown;
  team?: {id?: unknown; name?: unknown} | null | undefined;
  scope?: unknown;
  is_enterprise_install?: unknown;
}

export function createSlackApiClient(): SlackApiClient {
  return {
    async exchangeAuthorizationCode(input) {
      const body = await mapSlackError('exchange-authorization-code', () =>
        ky
          .post(slackApiUrl('oauth.v2.access'), {
            body: new URLSearchParams({
              client_id: config.SLACK_OAUTH_CLIENT_ID,
              client_secret: config.SLACK_OAUTH_CLIENT_SECRET,
              code: input.code,
              redirect_uri: config.SLACK_OAUTH_REDIRECT_URL,
            }),
            timeout: SLACK_API_TIMEOUT_MS,
          })
          .json<SlackOAuthAccessResponse>(),
      );
      return parseOAuthAccess(body);
    },

    async revokeToken(input) {
      await mapSlackError('revoke-token', async () => {
        await ky.post(slackApiUrl('auth.revoke'), {
          headers: {authorization: `Bearer ${input.token}`},
          timeout: SLACK_API_TIMEOUT_MS,
        });
      });
    },
  };
}

function parseOAuthAccess(body: SlackOAuthAccessResponse): SlackAuthorization {
  if (body.ok !== true) {
    throw new SlackIntegrationProviderError(
      slackOAuthErrorReason(body.error),
      'Slack authorization request failed',
    );
  }
  if (body.is_enterprise_install === true || body.team == null) {
    throw new SlackEnterpriseInstallUnsupportedError();
  }
  const {access_token: accessToken, bot_user_id: botUserId, app_id: appId, team, scope} = body;
  if (
    typeof accessToken !== 'string' ||
    typeof botUserId !== 'string' ||
    typeof appId !== 'string' ||
    typeof team.id !== 'string' ||
    typeof team.name !== 'string' ||
    typeof scope !== 'string'
  ) {
    throw new SlackIntegrationProviderError(
      'malformed-provider-response',
      'Slack authorization response did not include the required installation details',
    );
  }
  // Token rotation is intentionally unsupported until ENG-997 adds a rejection guard.
  return {
    accessToken,
    botUserId,
    appId,
    teamId: team.id,
    teamName: team.name,
    scopes: scope
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  };
}

function slackOAuthErrorReason(error: unknown) {
  if (error === 'service_unavailable' || error === 'internal_error') return 'provider-unavailable';
  if (error === 'ratelimited') return 'rate-limited';
  return 'access-denied';
}

async function mapSlackError<T>(operation: string, request: () => Promise<T>): Promise<T> {
  try {
    return await request();
  } catch (error) {
    if (error instanceof SlackIntegrationProviderError) throw error;
    if (error instanceof HTTPError) {
      const {status, statusText, headers} = error.response;
      logger().warn({operation, status, statusText}, 'Slack API request rejected');
      if (status === 429) {
        throw new SlackIntegrationProviderError(
          'rate-limited',
          'Slack request was rate limited',
          retryAfterSeconds(headers),
        );
      }
      if (status >= 500) {
        throw new SlackIntegrationProviderError('provider-unavailable', 'Slack request failed');
      }
      throw new SlackIntegrationProviderError('access-denied', 'Slack request was rejected');
    }
    if (error instanceof TimeoutError) {
      logger().warn({operation}, 'Slack API request timed out');
      throw new SlackIntegrationProviderError('timeout', 'Slack request timed out');
    }
    logger().warn(
      {operation, errName: error instanceof Error ? error.name : typeof error},
      'Slack API request failed',
    );
    throw new SlackIntegrationProviderError('provider-unavailable', 'Slack request failed');
  }
}

function slackApiUrl(path: string): string {
  return new URL(path, `${config.SLACK_API_BASE_URL}/`).toString();
}

function retryAfterSeconds(headers: Headers): number | undefined {
  const retryAfter = headers.get('retry-after');
  if (!retryAfter) return undefined;
  const parsed = Number.parseInt(retryAfter, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}
