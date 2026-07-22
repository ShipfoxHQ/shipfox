import type {UserContextMembership} from '@shipfox/api-auth-context';
import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import {logger} from '@shipfox/node-opentelemetry';
import type {JiraAccessibleResource, JiraApiClient, JiraAuthorization} from '#api/client.js';
import type {JiraPendingSelectionStore} from '#core/pending.js';
import type {JiraTokenStore} from '#core/tokens.js';
import {
  JiraInstallationAlreadyLinkedError,
  JiraInstallStateActorMismatchError,
  JiraIntegrationProviderError,
  JiraOAuthCallbackError,
  JiraOfflineAccessNotGrantedError,
  JiraPendingSelectionNotFoundError,
  JiraSiteSelectionMismatchError,
} from './errors.js';
import {assertJiraAuthorizationScopes} from './scopes.js';
import {verifyJiraInstallState} from './state.js';

export interface ConnectJiraInstallationInput {
  workspaceId: string;
  cloudId: string;
  siteUrl: string;
  siteName: string;
  authorizingAccountId: string;
  scopes: string[];
  tokenExpiresAt: Date | null;
  displayName: string;
}

export interface HandleJiraCallbackParams {
  jira: JiraApiClient;
  tokenStore: Pick<JiraTokenStore, 'storeTokens'>;
  pendingStore: Pick<JiraPendingSelectionStore, 'save' | 'load' | 'clear'>;
  code: string;
  state: string;
  sessionUserId: string;
  sessionMemberships: ReadonlyArray<UserContextMembership>;
  requireWorkspaceMembership(input: {
    workspaceId: string;
    userId: string;
    memberships: ReadonlyArray<UserContextMembership>;
  }): Promise<unknown>;
  getExistingJiraConnection(input: {
    cloudId: string;
  }): Promise<IntegrationConnection<'jira'> | undefined>;
  connectJiraInstallation(
    input: ConnectJiraInstallationInput,
  ): Promise<IntegrationConnection<'jira'>>;
  disconnectJiraInstallation(input: {connectionId: string}): Promise<void>;
}

export async function handleJiraCallback(
  params: HandleJiraCallbackParams,
): Promise<IntegrationConnection<'jira'> | {sites: JiraAccessibleResource[]}> {
  const claims = await verifyClaims(params, params.state);
  const authorization = await params.jira.exchangeAuthorizationCode({code: params.code});
  if (!authorization.refreshToken) throw new JiraOfflineAccessNotGrantedError();
  const sites = await params.jira.getAccessibleResources({accessToken: authorization.accessToken});
  if (sites.length === 0)
    throw new JiraIntegrationProviderError(
      'access-denied',
      'Jira authorization did not grant access to a site',
    );
  if (sites.length > 1) {
    await params.pendingStore.save({
      workspaceId: claims.workspaceId,
      state: params.state,
      authorization,
      sites,
    });
    return {sites};
  }
  const site = sites[0];
  if (!site) {
    throw new JiraIntegrationProviderError(
      'malformed-provider-response',
      'Jira accessible-resources response did not contain a selected site',
    );
  }
  assertJiraAuthorizationScopes(site.scopes);
  return resolveJiraSite({...params, authorization, site, claims});
}

export async function handleJiraSiteSelection(
  params: Omit<HandleJiraCallbackParams, 'code'> & {cloudId: string},
): Promise<IntegrationConnection<'jira'>> {
  const claims = await verifyClaims(params, params.state);
  const pending = await params.pendingStore.load({
    workspaceId: claims.workspaceId,
    state: params.state,
  });
  if (!pending) throw new JiraPendingSelectionNotFoundError();
  const site = pending.sites.find((candidate) => candidate.cloudId === params.cloudId);
  if (!site) throw new JiraSiteSelectionMismatchError(params.cloudId);
  assertJiraAuthorizationScopes(site.scopes);
  const connection = await resolveJiraSite({
    ...params,
    authorization: pending.authorization,
    site,
    claims,
  });
  await params.pendingStore.clear({workspaceId: claims.workspaceId, state: params.state});
  return connection;
}

export async function handleJiraOAuthCallbackError(params: {
  state: string;
  error: string;
  errorDescription?: string | undefined;
  sessionUserId: string;
  sessionMemberships: ReadonlyArray<UserContextMembership>;
  requireWorkspaceMembership(input: {
    workspaceId: string;
    userId: string;
    memberships: ReadonlyArray<UserContextMembership>;
  }): Promise<unknown>;
}): Promise<never> {
  await verifyClaims(params, params.state);
  throw new JiraOAuthCallbackError(params.error, params.errorDescription);
}

async function verifyClaims(
  params: Pick<
    HandleJiraCallbackParams,
    'sessionUserId' | 'sessionMemberships' | 'requireWorkspaceMembership'
  >,
  state: string,
) {
  const claims = verifyJiraInstallState(state);
  if (claims.userId !== params.sessionUserId) throw new JiraInstallStateActorMismatchError();
  await params.requireWorkspaceMembership({
    workspaceId: claims.workspaceId,
    userId: claims.userId,
    memberships: params.sessionMemberships,
  });
  return claims;
}

async function resolveJiraSite(
  params: Omit<HandleJiraCallbackParams, 'code'> & {
    authorization: JiraAuthorization;
    site: JiraAccessibleResource;
    claims: {workspaceId: string; userId: string};
  },
): Promise<IntegrationConnection<'jira'>> {
  const existing = await params.getExistingJiraConnection({cloudId: params.site.cloudId});
  if (existing && existing.workspaceId !== params.claims.workspaceId)
    throw new JiraInstallationAlreadyLinkedError(params.site.cloudId);
  let connectionId: string | undefined;
  try {
    const identity = await params.jira.getMyself({
      accessToken: params.authorization.accessToken,
      cloudId: params.site.cloudId,
    });
    const connection = await params.connectJiraInstallation({
      workspaceId: params.claims.workspaceId,
      cloudId: params.site.cloudId,
      siteUrl: params.site.url,
      siteName: params.site.name,
      authorizingAccountId: identity.accountId,
      scopes: params.site.scopes,
      tokenExpiresAt: params.authorization.expiresAt ?? null,
      displayName: `Jira ${params.site.name}`,
    });
    connectionId = connection.id;
    await params.tokenStore.storeTokens({
      connectionId: connection.id,
      accessToken: params.authorization.accessToken,
      refreshToken: params.authorization.refreshToken,
      editedBy: params.claims.userId,
    });
    return connection;
  } catch (error) {
    if (connectionId && !existing) await bestEffortDisconnect(params, connectionId);
    throw error;
  }
}

async function bestEffortDisconnect(
  params: Pick<HandleJiraCallbackParams, 'disconnectJiraInstallation'>,
  connectionId: string,
): Promise<void> {
  try {
    await params.disconnectJiraInstallation({connectionId});
  } catch (error) {
    logger().warn(
      {err: error, connectionId},
      'Jira connect compensation failed after token storage rejection',
    );
  }
}
