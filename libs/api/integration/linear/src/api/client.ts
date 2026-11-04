import {logger} from '@shipfox/node-opentelemetry';
import ky, {HTTPError, TimeoutError} from 'ky';
import {config} from '#config.js';
import {isLinearNotFoundMessage, LinearIntegrationProviderError} from '#core/errors.js';

const TRAILING_SLASHES = /\/+$/u;
const LINEAR_OAUTH_TOKEN_URL = linearApiUrl('/oauth/token');
const LINEAR_OAUTH_REVOKE_URL = linearApiUrl('/oauth/revoke');
const LINEAR_GRAPHQL_URL = linearApiUrl('/graphql');
const LINEAR_API_TIMEOUT_MS = 10_000;
const OAUTH_ERROR_CODES = new Set([
  'invalid_request',
  'invalid_client',
  'invalid_grant',
  'unauthorized_client',
  'unsupported_grant_type',
  'invalid_scope',
  'access_denied',
  'server_error',
  'temporarily_unavailable',
]);

const SCOPE_SEPARATOR_RE = /[,\s]+/;

const IDENTITY_QUERY = `
  query ShipfoxLinearIdentity {
    viewer {
      id
    }
    organization {
      id
      name
      urlKey
    }
  }
`;

const AGENT_ACTIVITY_CREATE_MUTATION = `
  mutation ShipfoxAgentActivityCreate($input: AgentActivityCreateInput!) {
    agentActivityCreate(input: $input) {
      success
    }
  }
`;

const AGENT_ACTIVITY_QUERY = `
  query ShipfoxAgentActivity($id: String!) {
    agentActivity(id: $id) {
      id
    }
  }
`;

const AGENT_SESSION_UPDATE_MUTATION = `
  mutation ShipfoxAgentSessionUpdate($id: String!, $input: AgentSessionUpdateInput!) {
    agentSessionUpdate(id: $id, input: $input) {
      success
    }
  }
`;

const AGENT_SESSION_ISSUE_QUERY = `
  query ShipfoxAgentSessionIssueId($id: String!) {
    agentSession(id: $id) {
      issue {
        id
      }
    }
  }
`;

const COMMENT_QUERY = `
  query ShipfoxComment($id: String!) {
    comment(id: $id) {
      id
    }
  }
`;

const COMMENT_CREATE_MUTATION = `
  mutation ShipfoxCommentCreate($input: CommentCreateInput!) {
    commentCreate(input: $input) {
      success
    }
  }
`;

const ISSUE_CONTEXT_QUERY = `
  query ShipfoxAgentSessionIssue($id: String!) {
    issue(id: $id) {
      identifier
      team {
        id
        key
      }
      project {
        id
        name
      }
      labels {
        nodes {
          name
        }
      }
    }
  }
`;

export interface LinearAuthorization {
  accessToken: string;
  refreshToken?: string | undefined;
  expiresAt?: Date | undefined;
  scopes: string[];
}

export interface LinearIdentity {
  appUserId: string;
  organizationId: string;
  organizationName: string;
  organizationUrlKey: string;
}

/** What Linear shows in an agent session. */
export type LinearAgentActivityContent =
  | {type: 'thought'; body: string}
  | {type: 'action'; action: string; parameter: string}
  | {type: 'response'; body: string}
  | {type: 'error'; body: string};

export interface LinearIssueContext {
  identifier: string;
  teamId: string;
  teamKey: string;
  projectId: string | null;
  projectName: string | null;
  labels: string[];
}

export interface LinearApiClient {
  exchangeAuthorizationCode(input: {code: string}): Promise<LinearAuthorization>;
  refreshAccessToken(input: {
    refreshToken: string;
    diagnostics?: LinearRefreshDiagnostics | undefined;
  }): Promise<LinearAuthorization>;
  revokeToken(input: {
    token: string;
    tokenTypeHint: 'access_token' | 'refresh_token';
  }): Promise<void>;
  getIdentity(input: {accessToken: string}): Promise<LinearIdentity>;
  createAgentActivity(input: {
    accessToken: string;
    /** A client-chosen UUID, so the activity can be found again after a send of unknown outcome. */
    id?: string | undefined;
    agentSessionId: string;
    content: LinearAgentActivityContent;
    /** Linear replaces an ephemeral activity with the next one. */
    ephemeral?: boolean | undefined;
    timeoutMs?: number | undefined;
  }): Promise<void>;
  /** Whether Linear holds an activity with this id. */
  hasAgentActivity(input: {accessToken: string; id: string}): Promise<boolean>;
  /** Adds to the session links. Linear merges them, so concurrent reports can't drop each other. */
  addAgentSessionExternalUrls(input: {
    accessToken: string;
    agentSessionId: string;
    urls: {label: string; url: string}[];
  }): Promise<void>;
  getIssueContext(input: {accessToken: string; issueId: string}): Promise<LinearIssueContext>;
  /** The issue an agent session belongs to, or null for a session that has none. */
  getAgentSessionIssueId(input: {
    accessToken: string;
    agentSessionId: string;
  }): Promise<string | null>;
  /** Whether Linear holds a comment with this id. */
  hasIssueComment(input: {accessToken: string; id: string}): Promise<boolean>;
  /** Posts a comment on an issue as the app, shown under `createAsUser` instead of the app. */
  createIssueComment(input: {
    accessToken: string;
    /** A client-chosen UUID, so the comment can be found again after a send of unknown outcome. */
    id: string;
    issueId: string;
    body: string;
    createAsUser: string;
  }): Promise<void>;
}

interface LinearRefreshDiagnostics {
  connectionId: string;
  refreshReason: 'forced' | 'expiry';
  tokenExpiresAt: string | null;
}

interface LinearTokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  scope?: unknown;
}

interface LinearGraphqlResponse<Data> {
  data?: Data | null;
  errors?: LinearGraphqlError[] | undefined;
}

interface LinearGraphqlError {
  message?: unknown;
  extensions?: {type?: unknown} | undefined;
}

interface LinearIdentityData {
  viewer?: {id?: unknown} | null;
  organization?: {id?: unknown; name?: unknown; urlKey?: unknown} | null;
}

interface LinearAgentActivityCreateData {
  agentActivityCreate?: {success?: unknown} | null;
}

interface LinearAgentActivityData {
  agentActivity?: {id?: unknown} | null;
}

interface LinearAgentSessionUpdateData {
  agentSessionUpdate?: {success?: unknown} | null;
}

interface LinearAgentSessionIssueData {
  agentSession?: {issue?: {id?: unknown} | null} | null;
}

interface LinearCommentData {
  comment?: {id?: unknown} | null;
}

interface LinearCommentCreateData {
  commentCreate?: {success?: unknown} | null;
}

interface LinearIssueContextData {
  issue?: {
    identifier?: unknown;
    team?: {id?: unknown; key?: unknown} | null;
    project?: {id?: unknown; name?: unknown} | null;
    labels?: {nodes?: {name?: unknown}[] | null} | null;
  } | null;
}

interface MapLinearErrorOptions {
  diagnostics?: LinearRefreshDiagnostics | undefined;
  classifyHttp4xx?(status: number): 'access-denied' | 'malformed-provider-response';
}

export function createLinearApiClient(): LinearApiClient {
  return {
    async exchangeAuthorizationCode(input) {
      const body = await mapLinearError('exchange-authorization-code', () =>
        ky
          .post(LINEAR_OAUTH_TOKEN_URL, {
            body: new URLSearchParams({
              grant_type: 'authorization_code',
              client_id: config.LINEAR_OAUTH_CLIENT_ID,
              client_secret: config.LINEAR_OAUTH_CLIENT_SECRET,
              code: input.code,
              redirect_uri: config.LINEAR_OAUTH_REDIRECT_URL,
            }),
            timeout: LINEAR_API_TIMEOUT_MS,
          })
          .json<LinearTokenResponse>(),
      );

      return parseTokenResponse(body);
    },

    async refreshAccessToken(input) {
      const body = await mapLinearError(
        'refresh-access-token',
        () =>
          ky
            .post(LINEAR_OAUTH_TOKEN_URL, {
              body: new URLSearchParams({
                grant_type: 'refresh_token',
                client_id: config.LINEAR_OAUTH_CLIENT_ID,
                client_secret: config.LINEAR_OAUTH_CLIENT_SECRET,
                refresh_token: input.refreshToken,
              }),
              timeout: LINEAR_API_TIMEOUT_MS,
            })
            .json<LinearTokenResponse>(),
        {diagnostics: input.diagnostics},
      );

      return parseTokenResponse(body);
    },

    async revokeToken(input) {
      await mapLinearError('revoke-token', async () => {
        await ky.post(LINEAR_OAUTH_REVOKE_URL, {
          body: new URLSearchParams({
            client_id: config.LINEAR_OAUTH_CLIENT_ID,
            client_secret: config.LINEAR_OAUTH_CLIENT_SECRET,
            token: input.token,
            token_type_hint: input.tokenTypeHint,
          }),
          timeout: LINEAR_API_TIMEOUT_MS,
        });
      });
    },

    async getIdentity(input) {
      const body = await mapLinearError(
        'get-identity',
        () =>
          ky
            .post(LINEAR_GRAPHQL_URL, {
              headers: {authorization: `Bearer ${input.accessToken}`},
              json: {query: IDENTITY_QUERY},
              timeout: LINEAR_API_TIMEOUT_MS,
            })
            .json<LinearGraphqlResponse<LinearIdentityData>>(),
        {classifyHttp4xx: classifyGraphqlHttp4xx},
      );
      const data = graphqlData('get-identity', body);
      const appUserId = data.viewer?.id;
      const organizationId = data.organization?.id;
      const organizationName = data.organization?.name;
      const organizationUrlKey = data.organization?.urlKey;

      if (
        typeof appUserId !== 'string' ||
        typeof organizationId !== 'string' ||
        typeof organizationName !== 'string' ||
        typeof organizationUrlKey !== 'string'
      ) {
        throw new LinearIntegrationProviderError(
          'malformed-provider-response',
          'Linear identity response did not include the app user and organization',
        );
      }

      return {appUserId, organizationId, organizationName, organizationUrlKey};
    },

    async createAgentActivity(input) {
      const body = await mapLinearError(
        'create-agent-activity',
        () =>
          ky
            .post(LINEAR_GRAPHQL_URL, {
              headers: {authorization: `Bearer ${input.accessToken}`},
              json: {
                query: AGENT_ACTIVITY_CREATE_MUTATION,
                variables: {
                  input: {
                    ...(input.id === undefined ? {} : {id: input.id}),
                    agentSessionId: input.agentSessionId,
                    content: input.content,
                    ...(input.ephemeral === undefined ? {} : {ephemeral: input.ephemeral}),
                  },
                },
              },
              timeout: input.timeoutMs ?? LINEAR_API_TIMEOUT_MS,
            })
            .json<LinearGraphqlResponse<LinearAgentActivityCreateData>>(),
        {classifyHttp4xx: classifyGraphqlHttp4xx},
      );
      const data = graphqlData('create-agent-activity', body);
      if (data.agentActivityCreate?.success !== true) {
        throw new LinearIntegrationProviderError(
          'malformed-provider-response',
          'Linear did not create the agent activity',
        );
      }
    },

    async hasAgentActivity(input) {
      const body = await mapLinearError(
        'get-agent-activity',
        () =>
          ky
            .post(LINEAR_GRAPHQL_URL, {
              headers: {authorization: `Bearer ${input.accessToken}`},
              json: {query: AGENT_ACTIVITY_QUERY, variables: {id: input.id}},
              timeout: LINEAR_API_TIMEOUT_MS,
            })
            .json<LinearGraphqlResponse<LinearAgentActivityData>>()
            .catch((error: unknown) => {
              // Linear may answer an unknown id with a 400 that carries the GraphQL error.
              if (error instanceof HTTPError && isNotFoundBody(error.data)) return error.data;
              throw error;
            }),
        {classifyHttp4xx: classifyGraphqlHttp4xx},
      );
      // Only a recognized not-found answer proves the activity is absent. Any other failure
      // throws, so the delivery is retried instead of settled on a guess.
      if (isNotFoundBody(body)) return false;
      const data = graphqlData('get-agent-activity', body);
      return data.agentActivity?.id === input.id;
    },

    async addAgentSessionExternalUrls(input) {
      const body = await mapLinearError(
        'update-agent-session',
        () =>
          ky
            .post(LINEAR_GRAPHQL_URL, {
              headers: {authorization: `Bearer ${input.accessToken}`},
              json: {
                query: AGENT_SESSION_UPDATE_MUTATION,
                variables: {id: input.agentSessionId, input: {addedExternalUrls: input.urls}},
              },
              timeout: LINEAR_API_TIMEOUT_MS,
            })
            .json<LinearGraphqlResponse<LinearAgentSessionUpdateData>>(),
        {classifyHttp4xx: classifyGraphqlHttp4xx},
      );
      const data = graphqlData('update-agent-session', body);
      if (data.agentSessionUpdate?.success !== true) {
        throw new LinearIntegrationProviderError(
          'malformed-provider-response',
          'Linear did not update the agent session',
        );
      }
    },

    async getAgentSessionIssueId(input) {
      const body = await mapLinearError(
        'get-agent-session-issue',
        () =>
          ky
            .post(LINEAR_GRAPHQL_URL, {
              headers: {authorization: `Bearer ${input.accessToken}`},
              json: {query: AGENT_SESSION_ISSUE_QUERY, variables: {id: input.agentSessionId}},
              timeout: LINEAR_API_TIMEOUT_MS,
            })
            .json<LinearGraphqlResponse<LinearAgentSessionIssueData>>(),
        {classifyHttp4xx: classifyGraphqlHttp4xx},
      );
      const issueId = graphqlData('get-agent-session-issue', body).agentSession?.issue?.id;
      return typeof issueId === 'string' ? issueId : null;
    },

    async hasIssueComment(input) {
      const body = await mapLinearError(
        'get-comment',
        () =>
          ky
            .post(LINEAR_GRAPHQL_URL, {
              headers: {authorization: `Bearer ${input.accessToken}`},
              json: {query: COMMENT_QUERY, variables: {id: input.id}},
              timeout: LINEAR_API_TIMEOUT_MS,
            })
            .json<LinearGraphqlResponse<LinearCommentData>>()
            .catch((error: unknown) => {
              // Linear may answer an unknown id with a 400 that carries the GraphQL error.
              if (error instanceof HTTPError && isNotFoundBody(error.data)) return error.data;
              throw error;
            }),
        {classifyHttp4xx: classifyGraphqlHttp4xx},
      );
      // Only a recognized not-found answer proves the comment is absent.
      if (isNotFoundBody(body)) return false;
      return graphqlData('get-comment', body).comment?.id === input.id;
    },

    async createIssueComment(input) {
      const body = await mapLinearError(
        'create-issue-comment',
        () =>
          ky
            .post(LINEAR_GRAPHQL_URL, {
              headers: {authorization: `Bearer ${input.accessToken}`},
              json: {
                query: COMMENT_CREATE_MUTATION,
                variables: {
                  input: {
                    id: input.id,
                    issueId: input.issueId,
                    body: input.body,
                    createAsUser: input.createAsUser,
                  },
                },
              },
              timeout: LINEAR_API_TIMEOUT_MS,
            })
            .json<LinearGraphqlResponse<LinearCommentCreateData>>(),
        {classifyHttp4xx: classifyGraphqlHttp4xx},
      );
      if (graphqlData('create-issue-comment', body).commentCreate?.success !== true) {
        throw new LinearIntegrationProviderError(
          'malformed-provider-response',
          'Linear did not create the comment',
        );
      }
    },

    async getIssueContext(input) {
      const body = await mapLinearError(
        'get-issue-context',
        () =>
          ky
            .post(LINEAR_GRAPHQL_URL, {
              headers: {authorization: `Bearer ${input.accessToken}`},
              json: {query: ISSUE_CONTEXT_QUERY, variables: {id: input.issueId}},
              timeout: LINEAR_API_TIMEOUT_MS,
            })
            .json<LinearGraphqlResponse<LinearIssueContextData>>(),
        {classifyHttp4xx: classifyGraphqlHttp4xx},
      );
      const issue = graphqlData('get-issue-context', body).issue;
      const teamId = issue?.team?.id;
      const teamKey = issue?.team?.key;
      if (
        typeof issue?.identifier !== 'string' ||
        typeof teamId !== 'string' ||
        typeof teamKey !== 'string'
      ) {
        throw new LinearIntegrationProviderError(
          'malformed-provider-response',
          'Linear issue response did not include the identifier and team',
        );
      }

      return {
        identifier: issue.identifier,
        teamId,
        teamKey,
        projectId: typeof issue.project?.id === 'string' ? issue.project.id : null,
        projectName: typeof issue.project?.name === 'string' ? issue.project.name : null,
        labels: (issue.labels?.nodes ?? []).flatMap((label) =>
          typeof label.name === 'string' ? [label.name] : [],
        ),
      };
    },
  };
}

function linearApiUrl(path: string): string {
  return `${config.LINEAR_API_BASE_URL.replace(TRAILING_SLASHES, '')}${path}`;
}

function parseTokenResponse(body: LinearTokenResponse): LinearAuthorization {
  if (typeof body.access_token !== 'string' || body.access_token.length === 0) {
    throw new LinearIntegrationProviderError(
      'malformed-provider-response',
      'Linear authorization response did not include an access token',
    );
  }

  const scopes = parseScopes(body.scope);
  const expiresAt = parseExpiresAt(body.expires_in);
  const refreshToken = typeof body.refresh_token === 'string' ? body.refresh_token : undefined;
  return {accessToken: body.access_token, refreshToken, expiresAt, scopes};
}

function parseScopes(scope: unknown): string[] {
  if (typeof scope === 'string') {
    return scope
      .split(SCOPE_SEPARATOR_RE)
      .map((value) => value.trim())
      .filter(Boolean);
  }
  if (Array.isArray(scope) && scope.every((value) => typeof value === 'string')) return scope;
  if (scope === undefined) return [];
  throw new LinearIntegrationProviderError(
    'malformed-provider-response',
    'Linear authorization response included malformed scopes',
  );
}

function parseExpiresAt(expiresIn: unknown): Date | undefined {
  if (expiresIn === undefined) return undefined;
  if (typeof expiresIn !== 'number' || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new LinearIntegrationProviderError(
      'malformed-provider-response',
      'Linear authorization response included a malformed expiry',
    );
  }
  return new Date(Date.now() + expiresIn * 1000);
}

function graphqlData<Data>(operation: string, body: LinearGraphqlResponse<Data>): Data {
  if (hasGraphqlErrors(body)) {
    const reason = hasAuthGraphqlError(body.errors)
      ? 'access-denied'
      : 'malformed-provider-response';
    logger().warn({operation}, 'Linear GraphQL request returned errors');
    throw new LinearIntegrationProviderError(reason, 'Linear GraphQL request failed');
  }
  if (!body.data) {
    throw new LinearIntegrationProviderError(
      'malformed-provider-response',
      'Linear GraphQL response did not include data',
    );
  }
  return body.data;
}

function isNotFoundBody(body: unknown): body is LinearGraphqlResponse<never> {
  const errors = (body as LinearGraphqlResponse<unknown> | null | undefined)?.errors;
  return (
    Array.isArray(errors) &&
    errors.some(
      (error) => typeof error.message === 'string' && isLinearNotFoundMessage(error.message),
    )
  );
}

function hasGraphqlErrors(body: LinearGraphqlResponse<unknown>): boolean {
  return Array.isArray(body.errors) && body.errors.length > 0;
}

function hasAuthGraphqlError(errors: LinearGraphqlError[] | undefined): boolean {
  return (
    errors?.some((error) => {
      const type = error.extensions?.type;
      return (
        typeof type === 'string' && ['authentication', 'authorization'].includes(type.toLowerCase())
      );
    }) ?? false
  );
}

async function mapLinearError<T>(
  operation: string,
  request: () => Promise<T>,
  options: MapLinearErrorOptions = {},
): Promise<T> {
  try {
    return await request();
  } catch (error) {
    if (error instanceof LinearIntegrationProviderError) throw error;
    throw mapUnknownLinearError(operation, error, options);
  }
}

function mapUnknownLinearError(
  operation: string,
  error: unknown,
  options: MapLinearErrorOptions,
): LinearIntegrationProviderError {
  if (error instanceof HTTPError) return mapLinearHttpError(operation, error, options);
  if (error instanceof TimeoutError) {
    logger().warn({operation, ...options.diagnostics}, 'Linear API request timed out');
    return new LinearIntegrationProviderError('timeout', 'Linear request timed out');
  }
  logger().warn(
    {
      operation,
      errName: error instanceof Error ? error.name : typeof error,
      ...options.diagnostics,
    },
    'Linear API request failed',
  );
  return new LinearIntegrationProviderError('provider-unavailable', 'Linear request failed');
}

function mapLinearHttpError(
  operation: string,
  error: HTTPError,
  options: MapLinearErrorOptions,
): LinearIntegrationProviderError {
  const {status, headers} = error.response;
  const isOAuthTokenRequest =
    operation === 'refresh-access-token' || operation === 'exchange-authorization-code';
  logger().warn(
    {
      operation,
      status,
      ...options.diagnostics,
      ...(isOAuthTokenRequest ? {oauthErrorCode: oauthErrorCode(error.data)} : {}),
    },
    'Linear API request rejected',
  );
  if (status === 429) {
    return new LinearIntegrationProviderError(
      'rate-limited',
      'Linear request was rate limited',
      retryAfterSeconds(headers),
    );
  }
  if (status >= 500) {
    return new LinearIntegrationProviderError('provider-unavailable', 'Linear request failed');
  }
  const reason = options.classifyHttp4xx?.(status) ?? 'access-denied';
  return new LinearIntegrationProviderError(reason, 'Linear request was rejected');
}

function classifyGraphqlHttp4xx(status: number): 'access-denied' | 'malformed-provider-response' {
  return status === 401 || status === 403 ? 'access-denied' : 'malformed-provider-response';
}

function retryAfterSeconds(headers: Headers): number | undefined {
  const retryAfter = headers.get('retry-after');
  if (!retryAfter) return undefined;
  const parsed = Number.parseInt(retryAfter, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function oauthErrorCode(data: unknown): string {
  if (typeof data !== 'object' || data === null || !('error' in data)) return 'unavailable';
  if (typeof data.error !== 'string') return 'unavailable';
  return OAUTH_ERROR_CODES.has(data.error) ? data.error : 'unknown';
}
