import type {IntegrationConnection} from '@shipfox/api-integration-core-dto';
import {logger} from '@shipfox/node-opentelemetry';
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
    // Best-effort: the connection is already persisted and receiving webhooks, so
    // a verify failure only leaves the install pending on Sentry's side. Failing
    // the connect would strand a working row behind the idempotent short-circuit
    // on retry (re-verifying needs a fresh token we cannot mint yet), so we log it.
    try {
      await params.sentry.verifyInstallation({
        installationUuid: params.installationUuid,
        token: authorization.token,
      });
    } catch (error) {
      logger().warn(
        {installationUuid: params.installationUuid, connectionId: connection.id, err: error},
        'sentry connect: verify-install failed after persistence, connection is active',
      );
    }
  }

  return connection;
}
