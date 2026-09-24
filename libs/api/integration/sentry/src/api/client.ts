import {createHmac, randomUUID} from 'node:crypto';
import {logger} from '@shipfox/node-opentelemetry';
import ky, {HTTPError, TimeoutError} from 'ky';
import {z} from 'zod';
import {config} from '#config.js';
import {SentryIntegrationProviderError} from '#core/errors.js';

const SENTRY_API_BASE = 'https://sentry.io/api/0';
const JWT_GRANT = 'urn:sentry:params:oauth:grant-type:jwt-bearer';
const NEXT_REL = /rel="?next"?/;
const HAS_RESULTS = /results="?true"?/;
const CURSOR_ATTRIBUTE = /(?:^|;)\s*cursor="([^"]+)"/;
const LINK_URL = /<([^>]+)>/;

const projectSchema = z.object({id: z.string(), slug: z.string(), name: z.string()}).passthrough();
const issueSchema = z.object({id: z.string(), title: z.string()}).passthrough();
const eventSchema = z.object({id: z.string(), groupID: z.string()}).passthrough();

export type SentryProject = z.infer<typeof projectSchema>;
export type SentryIssue = z.infer<typeof issueSchema>;
export type SentryIssueEvent = z.infer<typeof eventSchema>;
export interface SentryPage<T> {
  data: T[];
  nextCursor: string | null;
}

export interface SentrySearchIssuesInput {
  query?: string;
  projectIds?: string[];
  environments?: string[];
  statsPeriod?: string;
  start?: string;
  end?: string;
  sort?: string;
  limit?: number;
  cursor?: string;
}

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

export interface SentryReadApiClient extends SentryApiClient {
  mintInstallationToken(input: {
    installationUuid: string;
  }): Promise<{token: string; expiresAt: string}>;
  listProjects(input: {
    orgSlug: string;
    token: string;
    query?: string;
    limit?: number;
    cursor?: string;
  }): Promise<SentryPage<SentryProject>>;
  searchIssues(
    input: {orgSlug: string; token: string} & SentrySearchIssuesInput,
  ): Promise<SentryPage<SentryIssue>>;
  getIssue(input: {orgSlug: string; token: string; issueId: string}): Promise<SentryIssue>;
  getIssueEvent(input: {
    orgSlug: string;
    token: string;
    issueId: string;
    eventId?: string;
    environments?: string[];
  }): Promise<SentryIssueEvent>;
}

export function createSentryApiClient(): SentryReadApiClient {
  return {
    async exchangeAuthorizationCode(input) {
      // Encode the uuid: it originates from the request body / webhook payload, so
      // a path separator in it must not be able to alter the request path (the host
      // is already pinned to SENTRY_API_BASE).
      const body = await mapSentryError('exchange-authorization-code', () =>
        ky
          .post(
            `${SENTRY_API_BASE}/sentry-app-installations/${encodeURIComponent(input.installationUuid)}/authorizations/`,
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
      const body = await mapSentryError('get-installation', () =>
        ky
          .get(
            `${SENTRY_API_BASE}/sentry-app-installations/${encodeURIComponent(input.installationUuid)}/`,
            {
              headers: {authorization: `Bearer ${input.token}`},
            },
          )
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
      await mapSentryError('verify-installation', () =>
        ky
          .put(
            `${SENTRY_API_BASE}/sentry-app-installations/${encodeURIComponent(input.installationUuid)}/`,
            {
              headers: {authorization: `Bearer ${input.token}`},
              json: {status: 'installed'},
            },
          )
          .json<unknown>(),
      );
    },

    async mintInstallationToken(input) {
      const body = await mapSentryError('mint-installation-token', () =>
        ky
          .post(
            `${SENTRY_API_BASE}/sentry-app-installations/${encodeURIComponent(input.installationUuid)}/authorizations/`,
            {
              headers: {authorization: `Bearer ${signSentryAppAssertion()}`},
              json: {grant_type: JWT_GRANT},
              retry: {limit: 0},
            },
          )
          .json<unknown>(),
      );
      const parsed = z
        .object({token: z.string().min(1), expiresAt: z.iso.datetime({offset: true})})
        .safeParse(body);
      if (!parsed.success) throw malformedReadResponse('authorization');
      return parsed.data;
    },

    listProjects(input) {
      const searchParams = new URLSearchParams();
      if (input.query !== undefined) searchParams.set('query', input.query);
      if (input.limit !== undefined) searchParams.set('per_page', String(input.limit));
      if (input.cursor !== undefined) searchParams.set('cursor', input.cursor);
      return readPage(
        `${organizationPath(input.orgSlug)}/projects/`,
        input.token,
        searchParams,
        projectSchema,
      );
    },

    searchIssues(input) {
      return readPage(
        `${organizationPath(input.orgSlug)}/issues/`,
        input.token,
        searchIssuesParams(input),
        issueSchema,
      );
    },

    getIssue(input) {
      return readDetail(
        `${organizationPath(input.orgSlug)}/issues/${encodeURIComponent(input.issueId)}/`,
        input.token,
        issueSchema,
      );
    },

    getIssueEvent(input) {
      const searchParams = new URLSearchParams();
      for (const environment of input.environments ?? [])
        searchParams.append('environment', environment);
      return readDetail(
        `${organizationPath(input.orgSlug)}/issues/${encodeURIComponent(input.issueId)}/events/${encodeURIComponent(input.eventId ?? 'latest')}/`,
        input.token,
        eventSchema,
        searchParams,
      );
    },
  };
}

function searchIssuesParams(input: SentrySearchIssuesInput): URLSearchParams {
  const searchParams = new URLSearchParams();
  if (input.query !== undefined) searchParams.set('query', input.query);
  for (const projectId of input.projectIds ?? []) searchParams.append('project', projectId);
  for (const environment of input.environments ?? [])
    searchParams.append('environment', environment);
  if (input.statsPeriod !== undefined) searchParams.set('statsPeriod', input.statsPeriod);
  if (input.start !== undefined) searchParams.set('start', input.start);
  if (input.end !== undefined) searchParams.set('end', input.end);
  if (input.sort !== undefined) searchParams.set('sort', input.sort);
  if (input.limit !== undefined) searchParams.set('limit', String(input.limit));
  if (input.cursor !== undefined) searchParams.set('cursor', input.cursor);
  return searchParams;
}

function signSentryAppAssertion(): string {
  const now = Math.floor(Date.now() / 1000);
  const clientId = config.SENTRY_APP_CLIENT_ID;
  const header = Buffer.from(JSON.stringify({alg: 'HS256', typ: 'JWT'})).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({iss: clientId, sub: clientId, iat: now, exp: now + 60, jti: randomUUID()}),
  ).toString('base64url');
  const unsigned = `${header}.${payload}`;
  const signature = createHmac('sha256', config.SENTRY_APP_CLIENT_SECRET)
    .update(unsigned)
    .digest('base64url');
  return `${unsigned}.${signature}`;
}

function organizationPath(orgSlug: string): string {
  return `${SENTRY_API_BASE}/organizations/${encodeURIComponent(orgSlug)}`;
}

async function readPage<T>(
  url: string,
  token: string,
  searchParams: URLSearchParams,
  schema: z.ZodType<T>,
): Promise<SentryPage<T>> {
  const response = await readResponse(url, token, searchParams);
  const parsed = z.array(schema).safeParse(await readJson(response));
  if (!parsed.success) throw malformedReadResponse('list');
  return {data: parsed.data, nextCursor: nextCursor(response.headers)};
}

async function readDetail<T>(
  url: string,
  token: string,
  schema: z.ZodType<T>,
  searchParams = new URLSearchParams(),
): Promise<T> {
  const response = await readResponse(url, token, searchParams);
  const parsed = schema.safeParse(await readJson(response));
  if (!parsed.success) throw malformedReadResponse('detail');
  return parsed.data;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw malformedReadResponse('JSON');
  }
}

function readResponse(
  url: string,
  token: string,
  searchParams: URLSearchParams,
): Promise<Response> {
  return mapSentryError(
    'read',
    () =>
      ky.get(url, {
        headers: {authorization: `Bearer ${token}`},
        searchParams,
        retry: {limit: 0},
      }),
    true,
  );
}

function nextCursor(headers: Headers): string | null {
  for (const link of (headers.get('link') ?? '').split(',')) {
    if (!NEXT_REL.test(link) || !HAS_RESULTS.test(link)) continue;
    const cursor = CURSOR_ATTRIBUTE.exec(link)?.[1];
    if (cursor) return cursor;
    const url = LINK_URL.exec(link)?.[1];
    if (url) {
      try {
        return new URL(url).searchParams.get('cursor');
      } catch {
        return null;
      }
    }
  }
  return null;
}

function malformedReadResponse(resource: string): SentryIntegrationProviderError {
  return new SentryIntegrationProviderError(
    'malformed-provider-response',
    `Sentry ${resource} response was malformed`,
  );
}

// The typed error deliberately drops Sentry's status and body so no token, code,
// or client secret can leak to the client or the logged error chain. That also
// strips the one detail a self-hoster needs to fix a misconfigured Sentry app.
// e.g. a 403 on `get-installation` means the app is missing "Organization: Read"
// (see README "Required permissions"). So we log the upstream status
// here, the only place it survives, keyed by the operation that failed.
async function mapSentryError<T>(
  operation: string,
  request: () => Promise<T>,
  read = false,
): Promise<T> {
  try {
    return await request();
  } catch (error) {
    if (error instanceof SentryIntegrationProviderError) throw error;
    if (error instanceof HTTPError) {
      throw mapSentryHttpError(operation, error.response, read);
    }
    if (error instanceof TimeoutError) {
      logger().warn({operation}, 'Sentry API request timed out');
      throw new SentryIntegrationProviderError('timeout', 'Sentry request timed out');
    }
    logger().warn(
      {operation, errName: error instanceof Error ? error.name : typeof error},
      'Sentry API request failed',
    );
    throw new SentryIntegrationProviderError('provider-unavailable', 'Sentry request failed');
  }
}

function mapSentryHttpError(
  operation: string,
  response: Response,
  read: boolean,
): SentryIntegrationProviderError {
  const {status, statusText, headers} = response;
  logger().warn({operation, status, statusText}, 'Sentry API request rejected');
  if (status === 429)
    return new SentryIntegrationProviderError(
      'rate-limited',
      'Sentry request was rate limited',
      retryAfterSeconds(headers),
    );
  if (read && status === 401)
    return new SentryIntegrationProviderError(
      'credentials-unavailable',
      'Sentry authorization expired',
      undefined,
      status,
    );
  if (read && (status === 400 || status === 404))
    return new SentryIntegrationProviderError(
      'provider-rejected',
      status === 400 ? 'Sentry rejected the request parameters' : 'Sentry resource is unavailable',
      undefined,
      status,
    );
  if (status >= 500)
    return new SentryIntegrationProviderError('provider-unavailable', 'Sentry request failed');
  return new SentryIntegrationProviderError('access-denied', 'Sentry request was rejected');
}

function retryAfterSeconds(headers: Headers): number | undefined {
  const retryAfter = headers.get('retry-after');
  if (!retryAfter) return undefined;
  const parsed = Number.parseInt(retryAfter, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}
