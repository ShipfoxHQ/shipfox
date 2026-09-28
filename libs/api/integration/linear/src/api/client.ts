import type {IntegrationProviderErrorReason} from '@shipfox/api-integration-spi';
import {logger} from '@shipfox/node-opentelemetry';
import ky, {HTTPError, TimeoutError} from 'ky';
import {z} from 'zod';
import {config} from '#config.js';
import {isLinearNotFoundMessage, LinearIntegrationProviderError} from '#core/errors.js';

const LINEAR_OAUTH_TOKEN_URL = 'https://api.linear.app/oauth/token';
const LINEAR_OAUTH_REVOKE_URL = 'https://api.linear.app/oauth/revoke';
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

const RELATED_ISSUE_FRAGMENT = `
  fragment ShipfoxLinearRelatedIssue on Issue {
    id
    identifier
    title
    archivedAt
    project {
      id
    }
  }
`;

// Both directions are read in one request so a page that exhausts the outgoing
// relations can continue with incoming ones without a second round trip.
const ISSUE_RELATIONS_QUERY = `
  query ShipfoxLinearIssueRelations(
    $id: String!
    $withOutgoing: Boolean!
    $outgoingFirst: Int!
    $outgoingAfter: String
    $incomingFirst: Int!
    $incomingAfter: String
  ) {
    issue(id: $id) {
      relations(first: $outgoingFirst, after: $outgoingAfter) @include(if: $withOutgoing) {
        edges {
          cursor
          node {
            type
            relatedIssue {
              ...ShipfoxLinearRelatedIssue
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
      inverseRelations(first: $incomingFirst, after: $incomingAfter) {
        edges {
          cursor
          node {
            type
            issue {
              ...ShipfoxLinearRelatedIssue
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
  ${RELATED_ISSUE_FRAGMENT}
`;

const ISSUE_ATTACHMENTS_QUERY = `
  query ShipfoxLinearIssueAttachments($id: String!, $first: Int!, $after: String) {
    issue(id: $id) {
      attachments(first: $first, after: $after) {
        nodes {
          id
          title
          subtitle
          url
          createdAt
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`;

const pageInfoSchema = z.object({
  hasNextPage: z.boolean(),
  endCursor: z.string().nullable(),
});

const relatedIssueSchema = z
  .object({
    id: z.string(),
    identifier: z.string(),
    title: z.string(),
    archivedAt: z.string().nullable(),
    project: z.object({id: z.string()}).nullable(),
  })
  .transform(({project, ...issue}) => ({...issue, projectId: project?.id ?? null}));

const outgoingRelationsSchema = z.object({
  edges: z.array(
    z.object({
      cursor: z.string(),
      node: z.object({type: z.string(), relatedIssue: relatedIssueSchema}),
    }),
  ),
  pageInfo: pageInfoSchema,
});

const incomingRelationsSchema = z.object({
  edges: z.array(
    z.object({
      cursor: z.string(),
      node: z.object({type: z.string(), issue: relatedIssueSchema}),
    }),
  ),
  pageInfo: pageInfoSchema,
});

const issueRelationsDataSchema = z.object({
  issue: z
    .object({
      relations: outgoingRelationsSchema.optional(),
      inverseRelations: incomingRelationsSchema,
    })
    .nullable(),
});

const issueAttachmentsDataSchema = z.object({
  issue: z
    .object({
      attachments: z.object({
        nodes: z.array(
          z.object({
            id: z.string(),
            title: z.string(),
            subtitle: z.string().nullable(),
            url: z.string(),
            createdAt: z.string(),
          }),
        ),
        pageInfo: pageInfoSchema,
      }),
    })
    .nullable(),
});

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
  listIssueRelations(input: ListLinearIssueRelationsInput): Promise<LinearIssueRelationsPage>;
  listIssueAttachments(input: ListLinearIssueAttachmentsInput): Promise<LinearIssueAttachmentsPage>;
}

export interface LinearConnectionPageRequest {
  first: number;
  after?: string | undefined;
}

export interface ListLinearIssueRelationsInput {
  accessToken: string;
  issueId: string;
  /** Omitted once the outgoing relations are exhausted. */
  outgoing?: LinearConnectionPageRequest | undefined;
  incoming: LinearConnectionPageRequest;
}

export interface LinearRelatedIssue {
  id: string;
  identifier: string;
  title: string;
  projectId: string | null;
  archivedAt: string | null;
}

export interface LinearRelationEdge {
  cursor: string;
  type: string;
  issue: LinearRelatedIssue;
}

export interface LinearRelationEdgePage {
  edges: LinearRelationEdge[];
  hasNextPage: boolean;
  endCursor: string | null;
}

export interface LinearIssueRelationsPage {
  outgoing?: LinearRelationEdgePage | undefined;
  incoming: LinearRelationEdgePage;
}

export interface ListLinearIssueAttachmentsInput extends LinearConnectionPageRequest {
  accessToken: string;
  issueId: string;
}

export interface LinearIssueAttachment {
  id: string;
  title: string;
  subtitle: string | null;
  url: string;
  createdAt: string;
}

export interface LinearIssueAttachmentsPage {
  attachments: LinearIssueAttachment[];
  hasNextPage: boolean;
  endCursor: string | null;
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
  extensions?: {type?: unknown; code?: unknown; userPresentableMessage?: unknown} | undefined;
}

interface LinearIdentityData {
  viewer?: {id?: unknown} | null;
  organization?: {id?: unknown; name?: unknown; urlKey?: unknown} | null;
}

interface MapLinearErrorOptions {
  diagnostics?: LinearRefreshDiagnostics | undefined;
  classifyHttp4xx?(status: number): IntegrationProviderErrorReason;
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
            .post(config.LINEAR_GRAPHQL_ENDPOINT, {
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

    async listIssueRelations(input) {
      const data = await requestToolGraphql({
        operation: 'list-issue-relations',
        accessToken: input.accessToken,
        query: ISSUE_RELATIONS_QUERY,
        variables: {
          id: input.issueId,
          withOutgoing: input.outgoing !== undefined,
          outgoingFirst: input.outgoing?.first ?? 0,
          outgoingAfter: input.outgoing?.after ?? null,
          incomingFirst: input.incoming.first,
          incomingAfter: input.incoming.after ?? null,
        },
        schema: issueRelationsDataSchema,
      });
      const issue = data.issue ?? issueNotFound();
      return {
        ...(issue.relations === undefined
          ? {}
          : {
              outgoing: relationEdgePage(issue.relations, (edge) => ({
                cursor: edge.cursor,
                type: edge.node.type,
                issue: edge.node.relatedIssue,
              })),
            }),
        incoming: relationEdgePage(issue.inverseRelations, (edge) => ({
          cursor: edge.cursor,
          type: edge.node.type,
          issue: edge.node.issue,
        })),
      };
    },

    async listIssueAttachments(input) {
      const data = await requestToolGraphql({
        operation: 'list-issue-attachments',
        accessToken: input.accessToken,
        query: ISSUE_ATTACHMENTS_QUERY,
        variables: {id: input.issueId, first: input.first, after: input.after ?? null},
        schema: issueAttachmentsDataSchema,
      });
      const {attachments} = data.issue ?? issueNotFound();
      return {
        attachments: attachments.nodes,
        hasNextPage: attachments.pageInfo.hasNextPage,
        endCursor: attachments.pageInfo.endCursor,
      };
    },
  };
}

function relationEdgePage<Edge>(
  connection: {edges: Edge[]; pageInfo: z.infer<typeof pageInfoSchema>},
  toEdge: (edge: Edge) => LinearRelationEdge,
): LinearRelationEdgePage {
  return {
    edges: connection.edges.map(toEdge),
    hasNextPage: connection.pageInfo.hasNextPage,
    endCursor: connection.pageInfo.endCursor,
  };
}

async function requestToolGraphql<Schema extends z.ZodType>(params: {
  operation: string;
  accessToken: string;
  query: string;
  variables: Record<string, unknown>;
  schema: Schema;
}): Promise<z.infer<Schema>> {
  let body: LinearGraphqlResponse<unknown>;
  try {
    body = await ky
      .post(config.LINEAR_GRAPHQL_ENDPOINT, {
        headers: {authorization: `Bearer ${params.accessToken}`},
        json: {query: params.query, variables: params.variables},
        timeout: LINEAR_API_TIMEOUT_MS,
      })
      .json<LinearGraphqlResponse<unknown>>();
  } catch (error) {
    // Linear answers some GraphQL errors, such as a missing issue, with HTTP 400.
    if (error instanceof HTTPError && isGraphqlResponseWithErrors(error.data)) {
      body = error.data;
    } else {
      throw mapUnknownLinearError(params.operation, error, {classifyHttp4xx: classifyToolHttp4xx});
    }
  }

  if (hasGraphqlErrors(body)) throw toolGraphqlError(params.operation, body.errors ?? []);
  const parsed = params.schema.safeParse(body.data);
  if (!parsed.success) {
    logger().warn({operation: params.operation}, 'Linear GraphQL response had an unexpected shape');
    throw new LinearIntegrationProviderError(
      'malformed-provider-response',
      'Linear returned an unexpected response.',
    );
  }
  return parsed.data;
}

function toolGraphqlError(
  operation: string,
  errors: LinearGraphqlError[],
): LinearIntegrationProviderError {
  if (errors.some(isNotFoundGraphqlError)) return issueNotFoundError();
  const reason = toolGraphqlErrorReason(errors);
  logger().warn({operation, reason}, 'Linear GraphQL request returned errors');
  if (reason === 'rate-limited') {
    return new LinearIntegrationProviderError(
      reason,
      'Linear rate limited the request. Please try again later.',
    );
  }
  if (reason === 'credentials-unavailable') {
    return new LinearIntegrationProviderError(
      reason,
      'Linear credentials are unavailable. Reconnect Linear and try again.',
    );
  }
  if (reason === 'access-denied') {
    return new LinearIntegrationProviderError(reason, 'Linear denied access to the request.');
  }
  return new LinearIntegrationProviderError(reason, 'Linear rejected the request.');
}

function toolGraphqlErrorReason(errors: LinearGraphqlError[]): IntegrationProviderErrorReason {
  if (errors.some((error) => error.extensions?.code === 'RATELIMITED')) return 'rate-limited';
  if (errors.some((error) => graphqlErrorType(error) === 'authentication')) {
    return 'credentials-unavailable';
  }
  if (errors.some((error) => graphqlErrorType(error) === 'authorization')) return 'access-denied';
  return 'provider-rejected';
}

function isNotFoundGraphqlError(error: LinearGraphqlError): boolean {
  return [error.message, error.extensions?.userPresentableMessage].some(
    (message) => typeof message === 'string' && isLinearNotFoundMessage(message),
  );
}

function graphqlErrorType(error: LinearGraphqlError): string | undefined {
  const type = error.extensions?.type;
  return typeof type === 'string' ? type.toLowerCase() : undefined;
}

function isGraphqlResponseWithErrors(value: unknown): value is LinearGraphqlResponse<unknown> {
  return typeof value === 'object' && value !== null && hasGraphqlErrors(value);
}

function issueNotFoundError(): LinearIntegrationProviderError {
  return new LinearIntegrationProviderError('not-found', 'Linear could not find the issue.');
}

function issueNotFound(): never {
  throw issueNotFoundError();
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

function classifyGraphqlHttp4xx(status: number): IntegrationProviderErrorReason {
  return status === 401 || status === 403 ? 'access-denied' : 'malformed-provider-response';
}

function classifyToolHttp4xx(status: number): IntegrationProviderErrorReason {
  if (status === 401) return 'credentials-unavailable';
  if (status === 403) return 'access-denied';
  return 'provider-rejected';
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
