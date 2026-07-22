import type {UserContextMembership} from '@shipfox/api-auth-context';
import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import {logger} from '@shipfox/node-opentelemetry';
import type {LinearApiClient} from '#api/client.js';
import type {LinearTokenStore} from '#core/tokens.js';
import {
  LinearInstallationAlreadyLinkedError,
  LinearInstallStateActorMismatchError,
  LinearOAuthCallbackError,
} from './errors.js';
import {assertLinearAuthorizationScopes} from './scopes.js';
import {verifyLinearInstallState} from './state.js';

export interface ConnectLinearInstallationInput {
  workspaceId: string;
  organizationId: string;
  organizationUrlKey: string;
  appUserId: string;
  scopes: string[];
  tokenExpiresAt: Date | null;
  displayName: string;
}

export interface HandleLinearCallbackParams {
  linear: LinearApiClient;
  tokenStore: Pick<LinearTokenStore, 'storeTokens'>;
  code: string;
  state: string;
  sessionUserId: string;
  sessionMemberships: ReadonlyArray<UserContextMembership>;
  requireWorkspaceMembership: (params: {
    workspaceId: string;
    userId: string;
    memberships: ReadonlyArray<UserContextMembership>;
  }) => Promise<unknown>;
  getExistingLinearConnection: (input: {
    organizationId: string;
  }) => Promise<IntegrationConnection<'linear'> | undefined>;
  connectLinearInstallation: (
    input: ConnectLinearInstallationInput,
  ) => Promise<IntegrationConnection<'linear'>>;
  disconnectLinearInstallation: (input: {connectionId: string}) => Promise<void>;
}

export async function handleLinearCallback(
  params: HandleLinearCallbackParams,
): Promise<IntegrationConnection<'linear'>> {
  if (typeof params.disconnectLinearInstallation !== 'function') {
    throw new Error('Linear installation cleanup is not configured');
  }

  const claims = verifyLinearInstallState(params.state);
  if (claims.userId !== params.sessionUserId) {
    throw new LinearInstallStateActorMismatchError();
  }
  await params.requireWorkspaceMembership({
    workspaceId: claims.workspaceId,
    userId: claims.userId,
    memberships: params.sessionMemberships,
  });

  const authorization = await params.linear.exchangeAuthorizationCode({code: params.code});
  let connectedConnectionId: string | undefined;
  let shouldDisconnectConnection = false;
  try {
    const identity = await params.linear.getIdentity({accessToken: authorization.accessToken});
    const existing = await params.getExistingLinearConnection({
      organizationId: identity.organizationId,
    });
    if (existing && existing.workspaceId !== claims.workspaceId) {
      throw new LinearInstallationAlreadyLinkedError(identity.organizationId);
    }

    assertLinearAuthorizationScopes(authorization.scopes);

    const connection = await params.connectLinearInstallation({
      workspaceId: claims.workspaceId,
      organizationId: identity.organizationId,
      organizationUrlKey: identity.organizationUrlKey,
      appUserId: identity.appUserId,
      scopes: authorization.scopes,
      tokenExpiresAt: authorization.expiresAt ?? null,
      displayName: `Linear ${identity.organizationName}`,
    });
    connectedConnectionId = connection.id;
    shouldDisconnectConnection = !existing;
    await params.tokenStore.storeTokens({
      connectionId: connection.id,
      accessToken: authorization.accessToken,
      refreshToken: authorization.refreshToken,
      editedBy: claims.userId,
    });

    return connection;
  } catch (error) {
    await bestEffortRevokeAuthorization(params.linear, authorization);
    if (connectedConnectionId && shouldDisconnectConnection) {
      await bestEffortDisconnectLinearInstallation(params, connectedConnectionId);
    }
    throw error;
  }
}

export async function handleLinearOAuthCallbackError(params: {
  state: string;
  error: string;
  errorDescription?: string | undefined;
  sessionUserId: string;
  sessionMemberships: ReadonlyArray<UserContextMembership>;
  requireWorkspaceMembership: (input: {
    workspaceId: string;
    userId: string;
    memberships: ReadonlyArray<UserContextMembership>;
  }) => Promise<unknown>;
}): Promise<never> {
  const claims = verifyLinearInstallState(params.state);
  if (claims.userId !== params.sessionUserId) throw new LinearInstallStateActorMismatchError();
  await params.requireWorkspaceMembership({
    workspaceId: claims.workspaceId,
    userId: claims.userId,
    memberships: params.sessionMemberships,
  });
  throw new LinearOAuthCallbackError(params.error, params.errorDescription);
}

async function bestEffortRevokeAuthorization(
  linear: LinearApiClient,
  authorization: {accessToken: string; refreshToken?: string | undefined},
): Promise<void> {
  await Promise.all([
    authorization.refreshToken
      ? revokeToken(linear, authorization.refreshToken, 'refresh_token')
      : Promise.resolve(),
    revokeToken(linear, authorization.accessToken, 'access_token'),
  ]);
}

async function revokeToken(
  linear: LinearApiClient,
  token: string,
  tokenTypeHint: 'access_token' | 'refresh_token',
): Promise<void> {
  try {
    await linear.revokeToken({token, tokenTypeHint});
  } catch (error) {
    logger().warn({err: error, tokenTypeHint}, 'Linear OAuth token revocation failed');
  }
}

async function bestEffortDisconnectLinearInstallation(
  params: HandleLinearCallbackParams,
  connectionId: string,
): Promise<void> {
  try {
    await params.disconnectLinearInstallation({connectionId});
  } catch (error) {
    logger().warn(
      {err: error, connectionId},
      'Linear connect compensation failed after token storage rejection',
    );
  }
}
