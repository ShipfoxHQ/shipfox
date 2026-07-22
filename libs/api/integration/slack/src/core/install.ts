import type {UserContextMembership} from '@shipfox/api-auth-context';
import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import {logger} from '@shipfox/node-opentelemetry';
import type {SlackApiClient} from '#api/client.js';
import type {SlackTokenStore} from '#core/tokens.js';
import {
  SlackInstallationAlreadyLinkedError,
  SlackInstallStateActorMismatchError,
  SlackOAuthCallbackError,
} from './errors.js';
import {assertSlackAuthorizationScopes} from './scopes.js';
import {verifySlackInstallState} from './state.js';

export interface ConnectSlackInstallationInput {
  workspaceId: string;
  teamId: string;
  teamName: string;
  appId: string;
  botUserId: string;
  scopes: string[];
  tokenExpiresAt: Date | null;
  displayName: string;
}

export interface HandleSlackCallbackParams {
  slack: SlackApiClient;
  tokenStore: Pick<SlackTokenStore, 'storeTokens'>;
  code: string;
  state: string;
  sessionUserId: string;
  sessionMemberships: ReadonlyArray<UserContextMembership>;
  requireWorkspaceMembership: (params: {
    workspaceId: string;
    userId: string;
    memberships: ReadonlyArray<UserContextMembership>;
  }) => Promise<unknown>;
  getExistingSlackConnection: (input: {
    teamId: string;
  }) => Promise<IntegrationConnection<'slack'> | undefined>;
  connectSlackInstallation: (
    input: ConnectSlackInstallationInput,
  ) => Promise<IntegrationConnection<'slack'>>;
  disconnectSlackInstallation: (input: {connectionId: string}) => Promise<void>;
}

export async function handleSlackCallback(
  params: HandleSlackCallbackParams,
): Promise<IntegrationConnection<'slack'>> {
  const claims = verifySlackInstallState(params.state);
  if (claims.userId !== params.sessionUserId) throw new SlackInstallStateActorMismatchError();
  await params.requireWorkspaceMembership({
    workspaceId: claims.workspaceId,
    userId: claims.userId,
    memberships: params.sessionMemberships,
  });

  const authorization = await params.slack.exchangeAuthorizationCode({code: params.code});
  let connectedConnectionId: string | undefined;
  let shouldDisconnectConnection = false;
  let shouldRevokeToken = false;
  try {
    const existing = await params.getExistingSlackConnection({teamId: authorization.teamId});
    if (existing && existing.workspaceId !== claims.workspaceId) {
      throw new SlackInstallationAlreadyLinkedError(authorization.teamId);
    }
    shouldRevokeToken = !existing;
    assertSlackAuthorizationScopes(authorization.scopes);
    const connection = await params.connectSlackInstallation({
      workspaceId: claims.workspaceId,
      teamId: authorization.teamId,
      teamName: authorization.teamName,
      appId: authorization.appId,
      botUserId: authorization.botUserId,
      scopes: authorization.scopes,
      tokenExpiresAt: null,
      displayName: `Slack ${authorization.teamName}`,
    });
    connectedConnectionId = connection.id;
    shouldDisconnectConnection = !existing;
    await params.tokenStore.storeTokens({
      connectionId: connection.id,
      botToken: authorization.accessToken,
      editedBy: claims.userId,
    });
    return connection;
  } catch (error) {
    if (shouldRevokeToken) await bestEffortRevokeToken(params.slack, authorization.accessToken);
    if (connectedConnectionId && shouldDisconnectConnection) {
      await bestEffortDisconnectSlackInstallation(params, connectedConnectionId);
    }
    throw error;
  }
}

export async function handleSlackOAuthCallbackError(params: {
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
  const claims = verifySlackInstallState(params.state);
  if (claims.userId !== params.sessionUserId) throw new SlackInstallStateActorMismatchError();
  await params.requireWorkspaceMembership({
    workspaceId: claims.workspaceId,
    userId: claims.userId,
    memberships: params.sessionMemberships,
  });
  throw new SlackOAuthCallbackError(params.error, params.errorDescription);
}

async function bestEffortRevokeToken(slack: SlackApiClient, token: string): Promise<void> {
  try {
    await slack.revokeToken({token});
  } catch (error) {
    logger().warn({err: error}, 'Slack OAuth token revocation failed');
  }
}

async function bestEffortDisconnectSlackInstallation(
  params: HandleSlackCallbackParams,
  connectionId: string,
): Promise<void> {
  try {
    await params.disconnectSlackInstallation({connectionId});
  } catch (error) {
    logger().warn(
      {err: error, connectionId},
      'Slack connect compensation failed after token storage rejection',
    );
  }
}
