import type {UserContextMembership} from '@shipfox/api-auth-context';
import {clickupWebhookEventNames} from '@shipfox/api-integration-clickup-dto';
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
  lifecycleStatus?: 'active' | 'error' | undefined;
  displayName: string;
}

export interface HandleClickUpCallbackParams {
  clickup: ClickUpApiClient;
  tokenStore: Pick<ClickUpTokenStore, 'storeTokens'>;
  code: string;
  state: string;
  stateNonce: string | undefined;
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
  updateClickUpInstallationWebhook(input: {
    connectionId: string;
    webhookId: string | null;
  }): Promise<unknown>;
  markConnectionActive(input: {
    connectionId: string;
  }): Promise<IntegrationConnection<'clickup'> | undefined>;
  markConnectionError(input: {connectionId: string}): Promise<void>;
  webhookUrlForConnection(connectionId: string): string;
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

    const connection = await params.connectClickUpInstallation({
      workspaceId: claims.workspaceId,
      teamId: workspace.id,
      teamName: workspace.name,
      authorizingUserId: identity.id,
      displayName: `ClickUp ${workspace.name}`,
    });
    try {
      await params.tokenStore.storeTokens({
        connectionId: connection.id,
        accessToken: authorization.accessToken,
        editedBy: claims.userId,
      });
    } catch (error) {
      await bestEffortDisconnect(params, connection.id);
      throw error;
    }

    const activeConnection = await registerClickUpWebhook({
      ...params,
      connectionId: connection.id,
      teamId: workspace.id,
      accessToken: authorization.accessToken,
      editedBy: claims.userId,
      endpoint: params.webhookUrlForConnection(connection.id),
    });
    return activeConnection ?? connection;
  });
}

export async function handleClickUpOAuthCallbackError(params: {
  state: string;
  stateNonce: string | undefined;
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
    'stateNonce' | 'sessionUserId' | 'sessionMemberships' | 'requireWorkspaceMembership'
  >,
  state: string,
) {
  const claims = verifyClickUpInstallState(state, {nonce: params.stateNonce});
  if (claims.userId !== params.sessionUserId) throw new ClickUpInstallStateActorMismatchError();
  await params.requireWorkspaceMembership({
    workspaceId: claims.workspaceId,
    userId: claims.userId,
    memberships: params.sessionMemberships,
  });
  return claims;
}

export async function registerClickUpWebhook(
  params: Pick<
    HandleClickUpCallbackParams,
    | 'clickup'
    | 'tokenStore'
    | 'updateClickUpInstallationWebhook'
    | 'markConnectionActive'
    | 'markConnectionError'
  > & {
    connectionId: string;
    teamId: string;
    accessToken: string;
    endpoint: string;
    editedBy: string;
  },
): Promise<IntegrationConnection<'clickup'> | undefined> {
  let registeredWebhookId: string | undefined;
  try {
    const registration = await params.clickup.createWebhook({
      accessToken: params.accessToken,
      teamId: params.teamId,
      endpoint: params.endpoint,
      events: clickupWebhookEventNames,
    });
    registeredWebhookId = registration.id;
    await params.tokenStore.storeTokens({
      connectionId: params.connectionId,
      accessToken: params.accessToken,
      webhookSecret: registration.secret,
      editedBy: params.editedBy,
    });
    const installation = await params.updateClickUpInstallationWebhook({
      connectionId: params.connectionId,
      webhookId: registration.id,
    });
    if (!installation) throw new Error('ClickUp webhook registration lost its installation record');
    return (await params.markConnectionActive({connectionId: params.connectionId})) ?? undefined;
  } catch (error) {
    let remoteCleanupFailed = false;
    if (registeredWebhookId !== undefined) {
      try {
        await params.clickup.deleteWebhook({
          accessToken: params.accessToken,
          webhookId: registeredWebhookId,
        });
      } catch (cleanupError) {
        remoteCleanupFailed = true;
        logger().warn(
          {err: cleanupError, connectionId: params.connectionId, webhookId: registeredWebhookId},
          'ClickUp webhook cleanup failed after registration rejection',
        );
      }
    }
    try {
      await params.updateClickUpInstallationWebhook({
        connectionId: params.connectionId,
        webhookId: remoteCleanupFailed ? (registeredWebhookId ?? null) : null,
      });
    } catch (cleanupError) {
      logger().warn(
        {err: cleanupError, connectionId: params.connectionId},
        'ClickUp webhook metadata cleanup failed after registration rejection',
      );
    }
    try {
      await params.markConnectionError({connectionId: params.connectionId});
    } catch (stateError) {
      logger().warn(
        {err: stateError, connectionId: params.connectionId},
        'ClickUp connection error-state update failed after webhook registration rejection',
      );
    }
    throw error;
  }
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
