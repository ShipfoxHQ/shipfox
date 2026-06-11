import type {IntegrationConnection} from '@shipfox/api-integration-core-dto';
import type {SentryApiClient} from '#api/client.js';
import {SentryInstallationAlreadyLinkedError} from '#core/errors.js';

export interface ConnectSentryInstallationInput {
  workspaceId: string;
  installationUuid: string;
  orgSlug: string;
  displayName: string;
  installerUserId: string;
}

export interface HandleSentryConnectParams {
  sentry: SentryApiClient;
  workspaceId: string;
  code: string;
  installationUuid: string;
  installerUserId: string;
  verifyInstall: boolean;
  getExistingSentryConnection: (input: {
    installationUuid: string;
  }) => Promise<IntegrationConnection<'sentry'> | undefined>;
  connectSentryInstallation: (
    input: ConnectSentryInstallationInput,
  ) => Promise<IntegrationConnection<'sentry'>>;
}

// The "verify install" side effect runs AFTER the row is durably persisted, so a
// verify failure leaves a working connection rather than a Sentry-side "installed"
// state pointing at a row that was never written.
export async function handleSentryConnect(
  params: HandleSentryConnectParams,
): Promise<IntegrationConnection<'sentry'>> {
  const existing = await params.getExistingSentryConnection({
    installationUuid: params.installationUuid,
  });
  if (existing && existing.workspaceId !== params.workspaceId) {
    throw new SentryInstallationAlreadyLinkedError(params.installationUuid);
  }
  // Short-circuit so a replayed callback does not re-exchange the single-use code.
  if (existing && existing.lifecycleStatus === 'active') {
    return existing;
  }

  // Exchanging the code is also the authenticity check — a forged installation
  // id fails here and nothing is persisted.
  const authorization = await params.sentry.exchangeAuthorizationCode({
    installationUuid: params.installationUuid,
    code: params.code,
  });

  const {orgSlug} = await params.sentry.getInstallation({
    installationUuid: params.installationUuid,
    token: authorization.token,
  });

  // For a previously uninstalled (disabled) connection, this re-activates both the
  // connection lifecycle and the installation status.
  const connection = await params.connectSentryInstallation({
    workspaceId: params.workspaceId,
    installationUuid: params.installationUuid,
    orgSlug,
    displayName: `Sentry ${orgSlug}`,
    installerUserId: params.installerUserId,
  });

  if (params.verifyInstall) {
    await params.sentry.verifyInstallation({
      installationUuid: params.installationUuid,
      token: authorization.token,
    });
  }

  return connection;
}
