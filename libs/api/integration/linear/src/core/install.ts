import type {UserContextMembership} from '@shipfox/api-auth-context';
import type {IntegrationConnection} from '@shipfox/api-integration-core-dto';
import type {LinearApiClient} from '#api/client.js';
import type {LinearTokenStore} from '#core/tokens.js';
import {
  LinearInstallationAlreadyLinkedError,
  LinearInstallStateActorMismatchError,
} from './errors.js';
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
}

export async function handleLinearCallback(
  params: HandleLinearCallbackParams,
): Promise<IntegrationConnection<'linear'>> {
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
  const identity = await params.linear.getIdentity({accessToken: authorization.accessToken});
  const existing = await params.getExistingLinearConnection({
    organizationId: identity.organizationId,
  });
  if (existing && existing.workspaceId !== claims.workspaceId) {
    throw new LinearInstallationAlreadyLinkedError(identity.organizationId);
  }

  const connection = await params.connectLinearInstallation({
    workspaceId: claims.workspaceId,
    organizationId: identity.organizationId,
    organizationUrlKey: identity.organizationUrlKey,
    appUserId: identity.appUserId,
    scopes: authorization.scopes,
    tokenExpiresAt: authorization.expiresAt ?? null,
    displayName: `Linear ${identity.organizationName}`,
  });

  await params.tokenStore.storeTokens({
    connectionId: connection.id,
    accessToken: authorization.accessToken,
    refreshToken: authorization.refreshToken,
    editedBy: claims.userId,
  });

  return connection;
}
