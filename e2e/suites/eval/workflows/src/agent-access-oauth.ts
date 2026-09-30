import {createHash, randomBytes} from 'node:crypto';
import {
  oauthConsentDecisionResponseSchema,
  oauthConsentResponseSchema,
  oauthDynamicClientRegistrationResponseSchema,
  oauthTokenResponseSchema,
} from '@shipfox/api-auth-dto';

export interface AgentAccessEndpoints {
  /** Where the API listens; the runner reaches `/oauth/*` and `/mcp` here. */
  apiOrigin: string;
  /** The origin OAuth binds tokens to, which the API advertises as its MCP resource. */
  publicOrigin: string;
}

export interface AgentAccessTokens {
  accessToken: string;
  refreshToken: string | undefined;
  /** Epoch milliseconds, from the clock the caller passed in. */
  expiresAt: number;
}

type FetchLike = typeof fetch;

interface OAuthCallOptions {
  endpoints: AgentAccessEndpoints;
  fetch: FetchLike;
  now: () => number;
}

function resourceFor(endpoints: AgentAccessEndpoints): string {
  return `${endpoints.publicOrigin}/mcp`;
}

function expectStatus(response: Response, expected: number, description: string): void {
  if (response.status === expected) return;
  throw new Error(`${description} returned ${response.status}, expected ${expected}`);
}

export async function registerAgentAccessClient(
  options: OAuthCallOptions & {clientName: string; redirectUri: string},
): Promise<string> {
  const response = await options.fetch(`${options.endpoints.apiOrigin}/oauth/register`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({
      client_name: options.clientName,
      redirect_uris: [options.redirectUri],
      // Registration accepts only this grant today, yet the code exchange still issues a refresh token.
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  });
  expectStatus(response, 201, 'OAuth client registration');
  return oauthDynamicClientRegistrationResponseSchema.parse(await response.json()).client_id;
}

async function requestConsent(
  options: OAuthCallOptions & {clientId: string; redirectUri: string; challenge: string},
  state: string,
): Promise<string> {
  const url = new URL(`${options.endpoints.apiOrigin}/oauth/authorize`);
  url.search = new URLSearchParams({
    client_id: options.clientId,
    response_type: 'code',
    redirect_uri: options.redirectUri,
    code_challenge: options.challenge,
    code_challenge_method: 'S256',
    resource: resourceFor(options.endpoints),
    state,
  }).toString();
  const response = await options.fetch(url, {redirect: 'manual'});
  expectStatus(response, 302, 'OAuth authorization');
  const location = response.headers.get('location');
  const requestId = location
    ? new URL(location, options.endpoints.apiOrigin).searchParams.get('request_id')
    : null;
  if (!requestId) throw new Error('OAuth authorization did not return a consent request id');
  return requestId;
}

/**
 * Runs the authorization-code flow for one workspace, approving the consent as the signed-in
 * user. Each call creates a separate grant, so one registered client serves every case.
 */
export async function authorizeAgentAccess(
  options: OAuthCallOptions & {
    clientId: string;
    redirectUri: string;
    sessionToken: string;
    workspaceId: string;
  },
): Promise<AgentAccessTokens> {
  const verifier = randomBytes(32).toString('base64url');
  const state = `eval-${randomBytes(12).toString('hex')}`;
  const requestId = await requestConsent(
    {...options, challenge: createHash('sha256').update(verifier).digest('base64url')},
    state,
  );
  const bearer = {authorization: `Bearer ${options.sessionToken}`};

  const consentUrl = `${options.endpoints.apiOrigin}/oauth/consents/${requestId}`;
  const consent = await options.fetch(consentUrl, {headers: bearer});
  expectStatus(consent, 200, 'OAuth consent detail');
  const offered = oauthConsentResponseSchema.parse(await consent.json()).workspaces;
  if (!offered.some(({workspace_id}) => workspace_id === options.workspaceId)) {
    throw new Error(`Workspace ${options.workspaceId} is not offered for consent`);
  }

  const approval = await options.fetch(`${consentUrl}/approve`, {
    method: 'POST',
    headers: {...bearer, 'content-type': 'application/json'},
    body: JSON.stringify({workspace_id: options.workspaceId}),
  });
  expectStatus(approval, 200, 'OAuth consent approval');
  const redirect = new URL(
    oauthConsentDecisionResponseSchema.parse(await approval.json()).redirect_url,
  );
  const code = redirect.searchParams.get('code');
  if (!code || redirect.searchParams.get('state') !== state) {
    throw new Error('OAuth consent approval returned an invalid client redirect');
  }

  return await requestTokens(options, {
    grant_type: 'authorization_code',
    client_id: options.clientId,
    code,
    redirect_uri: options.redirectUri,
    code_verifier: verifier,
  });
}

/**
 * Refresh tokens rotate. A replayed token is answered without a new one, so the caller keeps
 * its current refresh token when the response omits it.
 */
export async function refreshAgentAccessTokens(
  options: OAuthCallOptions & {clientId: string; refreshToken: string},
): Promise<Pick<AgentAccessTokens, 'accessToken' | 'expiresAt'> & {refreshToken?: string}> {
  const tokens = await requestTokens(options, {
    grant_type: 'refresh_token',
    client_id: options.clientId,
    refresh_token: options.refreshToken,
  });
  return {
    accessToken: tokens.accessToken,
    expiresAt: tokens.expiresAt,
    ...(tokens.refreshToken === undefined ? {} : {refreshToken: tokens.refreshToken}),
  };
}

async function requestTokens(
  options: OAuthCallOptions,
  form: Record<string, string>,
): Promise<AgentAccessTokens> {
  const response = await options.fetch(`${options.endpoints.apiOrigin}/oauth/token`, {
    method: 'POST',
    headers: {'content-type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({...form, resource: resourceFor(options.endpoints)}).toString(),
  });
  expectStatus(response, 200, `OAuth token request (${form.grant_type})`);
  const token = oauthTokenResponseSchema.parse(await response.json());
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: options.now() + token.expires_in * 1000,
  };
}
