import ky, {HTTPError, TimeoutError} from 'ky';
import {config} from '#config.js';
import {SentryIntegrationProviderError} from '#core/errors.js';

const SENTRY_API_BASE = 'https://sentry.io/api/0';

export interface SentryAuthorization {
  token: string;
  refreshToken: string;
  expiresAt: string;
}

export interface SentryInstallationDetails {
  orgSlug: string;
}

export interface SentryApiClient {
  exchangeAuthorizationCode(input: {
    installationUuid: string;
    code: string;
  }): Promise<SentryAuthorization>;
  // Derived from Sentry so the org slug is never trusted from the client body.
  getInstallation(input: {
    installationUuid: string;
    token: string;
  }): Promise<SentryInstallationDetails>;
  verifyInstallation(input: {installationUuid: string; token: string}): Promise<void>;
}

export function createSentryApiClient(): SentryApiClient {
  return {
    async exchangeAuthorizationCode(input) {
      const body = await mapSentryError(() =>
        ky
          .post(
            `${SENTRY_API_BASE}/sentry-app-installations/${input.installationUuid}/authorizations/`,
            {
              json: {
                grant_type: 'authorization_code',
                client_id: config.SENTRY_APP_CLIENT_ID,
                client_secret: config.SENTRY_APP_CLIENT_SECRET,
                code: input.code,
              },
            },
          )
          .json<{token?: unknown; refreshToken?: unknown; expiresAt?: unknown}>(),
      );

      if (
        typeof body.token !== 'string' ||
        typeof body.refreshToken !== 'string' ||
        typeof body.expiresAt !== 'string'
      ) {
        throw new SentryIntegrationProviderError(
          'malformed-provider-response',
          'Sentry authorization response did not include a token',
        );
      }
      return {token: body.token, refreshToken: body.refreshToken, expiresAt: body.expiresAt};
    },

    async getInstallation(input) {
      const body = await mapSentryError(() =>
        ky
          .get(`${SENTRY_API_BASE}/sentry-app-installations/${input.installationUuid}/`, {
            headers: {authorization: `Bearer ${input.token}`},
          })
          .json<{organization?: {slug?: unknown}}>(),
      );

      const slug = body.organization?.slug;
      if (typeof slug !== 'string' || slug.length === 0) {
        throw new SentryIntegrationProviderError(
          'malformed-provider-response',
          'Sentry installation response did not include an organization slug',
        );
      }
      return {orgSlug: slug};
    },

    async verifyInstallation(input) {
      await mapSentryError(() =>
        ky
          .put(`${SENTRY_API_BASE}/sentry-app-installations/${input.installationUuid}/`, {
            headers: {authorization: `Bearer ${input.token}`},
            json: {status: 'installed'},
          })
          .json<unknown>(),
      );
    },
  };
}

// Build the error from status + a fixed message only — never the request body,
// token, code, or client secret — so secrets cannot leak through the logged `cause`.
async function mapSentryError<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof SentryIntegrationProviderError) throw error;
    if (error instanceof HTTPError) {
      const {status, headers} = error.response;
      if (status === 429) {
        throw new SentryIntegrationProviderError(
          'rate-limited',
          'Sentry request was rate limited',
          retryAfterSeconds(headers),
        );
      }
      if (status >= 500) {
        throw new SentryIntegrationProviderError('provider-unavailable', 'Sentry request failed');
      }
      throw new SentryIntegrationProviderError('access-denied', 'Sentry request was rejected');
    }
    if (error instanceof TimeoutError) {
      throw new SentryIntegrationProviderError('timeout', 'Sentry request timed out');
    }
    throw new SentryIntegrationProviderError('provider-unavailable', 'Sentry request failed');
  }
}

function retryAfterSeconds(headers: Headers): number | undefined {
  const retryAfter = headers.get('retry-after');
  if (!retryAfter) return undefined;
  const parsed = Number.parseInt(retryAfter, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}
