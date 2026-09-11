import type {UserContextMembership} from '@shipfox/api-auth-context';
import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import {logger} from '@shipfox/node-opentelemetry';
import type {ClickUpApiClient} from '#api/client.js';
import type {ClickUpTokenStore} from '#core/tokens.js';
import {type ClickUpInstallationLock, withClickUpInstallationLock} from '#db/installations.js';
import {
  ClickUpInstallationAlreadyLinkedError,
  ClickUpInstallStateActorMismatchError,
  ClickUpOAuthCallbackError,
  ClickUpWorkspaceCountError,
} from './errors.js';
import {verifyClickUpInstallState} from './state.js';

export interface ConnectClickUpInstallationInput {
  workspaceId: string;
  teamId: string;
  teamName: string;
  authorizingUserId: string;
  webhookId?: string | null | undefined;
  displayName: string;
}

export interface HandleClickUpCallbackParams {
  clickup: ClickUpApiClient;
  tokenStore: Pick<ClickUpTokenStore, 'storeTokens'>;
  code: string;
  state: string;
  sessionUserId: string;
  sessionMemberships: ReadonlyArray<UserContextMembership>;
  requireWorkspaceMembership(input: {
    workspaceId: string;
    userId: string;
    memberships: ReadonlyArray<UserContextMembership>;
  }): Promise<unknown>;
  getExistingClickUpConnection(input: {
    teamId: string;
  }): Promise<IntegrationConnection<'clickup'> | undefined>;
  connectClickUpInstallation(
    input: ConnectClickUpInstallationInput,
  ): Promise<IntegrationConnection<'clickup'>>;
  disconnectClickUpInstallation(input: {connectionId: string}): Promise<void>;
  withClickUpInstallationLock?: ClickUpInstallationLock;
}

export async function handleClickUpCallback(
  params: HandleClickUpCallbackParams,
): Promise<IntegrationConnection<'clickup'>> {
  const claims = await verifyClaims(params, params.state);
  const authorization = await params.clickup.exchangeAuthorizationCode({code: params.code});
  const workspaces = await params.clickup.getAuthorizedWorkspaces({
    accessToken: authorization.accessToken,
  });
  if (workspaces.length !== 1) throw new ClickUpWorkspaceCountError(workspaces.length);

  const workspace = workspaces[0];
  if (!workspace) throw new ClickUpWorkspaceCountError(workspaces.length);
  const identity = await params.clickup.getAuthorizedUser({
    accessToken: authorization.accessToken,
  });
  const withInstallationLock = params.withClickUpInstallationLock ?? withClickUpInstallationLock;

  return await withInstallationLock(workspace.id, async () => {
    const existing = await params.getExistingClickUpConnection({teamId: workspace.id});
    if (existing) throw new ClickUpInstallationAlreadyLinkedError(workspace.id);

    let connection: IntegrationConnection<'clickup'> | undefined;
    try {
      connection = await params.connectClickUpInstallation({
        workspaceId: claims.workspaceId,
        teamId: workspace.id,
        teamName: workspace.name,
        authorizingUserId: identity.id,
        displayName: `ClickUp ${workspace.name}`,
      });
      await params.tokenStore.storeTokens({
        connectionId: connection.id,
        accessToken: authorization.accessToken,
        editedBy: claims.userId,
      });
      return connection;
    } catch (error) {
      if (connection) await bestEffortDisconnect(params, connection.id);
      throw error;
    }
  });
}

export async function handleClickUpOAuthCallbackError(params: {
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
  throw new ClickUpOAuthCallbackError(params.error, params.errorDescription);
}

async function verifyClaims(
  params: Pick<
    HandleClickUpCallbackParams,
    'sessionUserId' | 'sessionMemberships' | 'requireWorkspaceMembership'
  >,
  state: string,
) {
  const claims = verifyClickUpInstallState(state);
  if (claims.userId !== params.sessionUserId) throw new ClickUpInstallStateActorMismatchError();
  await params.requireWorkspaceMembership({
    workspaceId: claims.workspaceId,
    userId: claims.userId,
    memberships: params.sessionMemberships,
  });
  return claims;
}

async function bestEffortDisconnect(
  params: Pick<HandleClickUpCallbackParams, 'disconnectClickUpInstallation'>,
  connectionId: string,
): Promise<void> {
  try {
    await params.disconnectClickUpInstallation({connectionId});
  } catch (error) {
    logger().warn(
      {err: error, connectionId},
      'ClickUp connect compensation failed after token storage rejection',
    );
  }
}
