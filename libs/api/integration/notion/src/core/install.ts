import type {UserContextMembership} from '@shipfox/api-auth-context';
import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import {logger} from '@shipfox/node-opentelemetry';
import type {NotionApiClient, NotionOAuthAuthorization} from '#api/client.js';
import type {NotionInstallation} from '#db/installations.js';
import {withNotionGrantLock} from '#db/installations.js';
import {
  NotionInstallationAlreadyLinkedError,
  NotionInstallStateActorMismatchError,
  NotionIntegrationProviderError,
  NotionOAuthCallbackError,
} from './errors.js';
import {verifyNotionInstallState} from './state.js';

export interface ConnectNotionInstallationInput {
  workspaceId: string;
  notionWorkspaceId: string;
  workspaceName: string;
  botId: string;
  authorizedByUserId: string;
  tokenExpiresAt?: Date | null | undefined;
  lifecycleStatus?: 'active' | 'disabled' | 'error' | undefined;
  displayName: string;
  actorUserId?: string | undefined;
}

export interface HandleNotionCallbackParams {
  notion: NotionApiClient;
  tokenStore: {
    storeTokens(input: {
      connectionId: string;
      accessToken: string;
      refreshToken?: string | undefined;
      editedBy?: string | null | undefined;
      lockAlreadyHeld?: boolean | undefined;
    }): Promise<void>;
    getTokens(input: {connectionId: string}): Promise<{
      accessToken: string;
      refreshToken?: string | undefined;
    }>;
  };
  code: string;
  state: string;
  sessionUserId: string;
  sessionMemberships: ReadonlyArray<UserContextMembership>;
  requireWorkspaceMembership(input: {
    workspaceId: string;
    userId: string;
    memberships: ReadonlyArray<UserContextMembership>;
  }): Promise<unknown>;
  getExistingNotionConnection(input: {
    notionWorkspaceId: string;
  }): Promise<IntegrationConnection<'notion'> | undefined>;
  getNotionInstallationByConnectionId(
    connectionId: string,
  ): Promise<NotionInstallation | undefined>;
  connectNotionInstallation(
    input: ConnectNotionInstallationInput,
  ): Promise<IntegrationConnection<'notion'>>;
  restoreNotionInstallation(input: NotionInstallation): Promise<NotionInstallation | undefined>;
  disconnectNotionInstallation(input: {connectionId: string}): Promise<void>;
}

export interface NotionCallbackSuccess {
  connection: IntegrationConnection<'notion'>;
  reconnected: boolean;
}

export async function handleNotionCallback(
  params: HandleNotionCallbackParams,
): Promise<NotionCallbackSuccess> {
  const claims = verifyNotionInstallState(params.state);
  if (claims.userId !== params.sessionUserId) throw new NotionInstallStateActorMismatchError();
  await params.requireWorkspaceMembership({
    workspaceId: claims.workspaceId,
    userId: claims.userId,
    memberships: params.sessionMemberships,
  });

  const authorization = await params.notion.exchangeAuthorizationCode({code: params.code});
  let connectionId: string | undefined;
  let shouldDisconnectConnection = false;
  try {
    const existing = await params.getExistingNotionConnection({
      notionWorkspaceId: authorization.workspaceId,
    });
    if (existing && existing.workspaceId !== claims.workspaceId) {
      throw new NotionInstallationAlreadyLinkedError(authorization.workspaceId);
    }

    if (existing) {
      const result = await replaceNotionGrant({
        ...params,
        claims,
        authorization,
        existing,
      });
      return {connection: result, reconnected: true};
    }

    const connection = await params.connectNotionInstallation({
      workspaceId: claims.workspaceId,
      notionWorkspaceId: authorization.workspaceId,
      workspaceName: authorization.workspaceName,
      botId: authorization.botId,
      authorizedByUserId: claims.userId,
      tokenExpiresAt: authorization.expiresAt ?? null,
      lifecycleStatus: 'active',
      displayName: `Notion ${authorization.workspaceName}`,
      actorUserId: claims.userId,
    });
    connectionId = connection.id;
    shouldDisconnectConnection = true;
    await params.tokenStore.storeTokens({
      connectionId: connection.id,
      accessToken: authorization.accessToken,
      refreshToken: authorization.refreshToken,
      editedBy: claims.userId,
    });
    return {connection, reconnected: false};
  } catch (error) {
    await bestEffortRevokeAuthorization(params.notion, authorization);
    if (connectionId && shouldDisconnectConnection) {
      await bestEffortDisconnect(params.disconnectNotionInstallation, connectionId);
    }
    throw error;
  }
}

async function replaceNotionGrant(params: {
  notion: NotionApiClient;
  tokenStore: HandleNotionCallbackParams['tokenStore'];
  claims: {workspaceId: string; userId: string};
  authorization: NotionOAuthAuthorization;
  existing: IntegrationConnection<'notion'>;
  getNotionInstallationByConnectionId(
    connectionId: string,
  ): Promise<NotionInstallation | undefined>;
  connectNotionInstallation(
    input: ConnectNotionInstallationInput,
  ): Promise<IntegrationConnection<'notion'>>;
  restoreNotionInstallation(input: NotionInstallation): Promise<NotionInstallation | undefined>;
}): Promise<IntegrationConnection<'notion'>> {
  return await withNotionGrantLock(params.existing.id, async () => {
    const previousInstallation = await params.getNotionInstallationByConnectionId(
      params.existing.id,
    );
    if (!previousInstallation) {
      throw new NotionIntegrationProviderError(
        'provider-unavailable',
        'Notion installation disappeared during reconnect',
      );
    }
    const previousTokens = await params.tokenStore.getTokens({
      connectionId: params.existing.id,
    });

    try {
      const connection = await params.connectNotionInstallation({
        workspaceId: params.claims.workspaceId,
        notionWorkspaceId: params.authorization.workspaceId,
        workspaceName: params.authorization.workspaceName,
        botId: params.authorization.botId,
        authorizedByUserId: params.claims.userId,
        tokenExpiresAt: params.authorization.expiresAt ?? null,
        lifecycleStatus: 'active',
        displayName: `Notion ${params.authorization.workspaceName}`,
        actorUserId: params.claims.userId,
      });
      await params.tokenStore.storeTokens({
        connectionId: connection.id,
        accessToken: params.authorization.accessToken,
        refreshToken: params.authorization.refreshToken,
        editedBy: params.claims.userId,
        lockAlreadyHeld: true,
      });
      // Different-authorizer revoke behavior was not covered by the spike. Let the old grant expire.
      return connection;
    } catch (error) {
      await restorePreviousGrant(params, previousInstallation, previousTokens, error);
      throw new NotionIntegrationProviderError(
        'provider-unavailable',
        'Notion grant replacement failed; the previous grant was restored',
      );
    }
  });
}

async function restorePreviousGrant(
  params: Pick<HandleNotionCallbackParams, 'tokenStore' | 'restoreNotionInstallation'>,
  installation: NotionInstallation,
  tokens: {accessToken: string; refreshToken?: string | undefined},
  cause: unknown,
): Promise<void> {
  try {
    await params.tokenStore.storeTokens({
      connectionId: installation.connectionId,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      lockAlreadyHeld: true,
    });
    await params.restoreNotionInstallation(installation);
  } catch (restoreError) {
    logger().warn(
      {err: restoreError, connectionId: installation.connectionId},
      'Notion grant replacement rollback failed',
    );
  }
  logger().warn(
    {err: cause, connectionId: installation.connectionId},
    'Notion grant replacement failed',
  );
}

export async function handleNotionOAuthCallbackError(params: {
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
}): Promise<{outcome: 'access_denied'}> {
  const claims = verifyNotionInstallState(params.state);
  if (claims.userId !== params.sessionUserId) throw new NotionInstallStateActorMismatchError();
  await params.requireWorkspaceMembership({
    workspaceId: claims.workspaceId,
    userId: claims.userId,
    memberships: params.sessionMemberships,
  });
  if (params.error === 'access_denied') return {outcome: 'access_denied'};
  throw new NotionOAuthCallbackError(params.error, params.errorDescription);
}

async function bestEffortRevokeAuthorization(
  notion: Pick<NotionApiClient, 'revokeToken'>,
  authorization: {accessToken: string; refreshToken?: string | undefined},
): Promise<void> {
  await Promise.all(
    [authorization.accessToken, authorization.refreshToken]
      .filter((token): token is string => token !== undefined)
      .map(async (token) => {
        try {
          await notion.revokeToken({token});
        } catch (error) {
          logger().warn({err: error}, 'Notion OAuth token revocation failed');
        }
      }),
  );
}

async function bestEffortDisconnect(
  disconnectNotionInstallation: HandleNotionCallbackParams['disconnectNotionInstallation'],
  connectionId: string,
): Promise<void> {
  try {
    await disconnectNotionInstallation({connectionId});
  } catch (error) {
    logger().warn(
      {err: error, connectionId},
      'Notion connect compensation failed after token storage rejection',
    );
  }
}
