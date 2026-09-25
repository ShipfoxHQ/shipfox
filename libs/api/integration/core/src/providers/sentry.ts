import type {
  ConnectSentryInstallationInput,
  SentrySecretsStore,
} from '@shipfox/api-integration-sentry';
import type {IntegrationConnection as CoreIntegrationConnection} from '@shipfox/api-integration-spi';
import {config} from '#config.js';
import type {IntegrationCapability} from '#core/entities/provider.js';
import {getIntegrationProviderCapabilities} from '#core/providers/registry.js';
import {
  getIntegrationConnectionById,
  resolveUniqueConnectionSlug,
  updateIntegrationConnectionLifecycleStatus,
  upsertIntegrationConnection,
} from '#db/connections.js';
import {db} from '#db/db.js';
import {publishIntegrationEventReceived, recordDeliveryOnly} from '#db/webhook-deliveries.js';
import {retryConnectionSlugCollision, slugifyConnectionSlug} from '#providers/connection-slug.js';
import type {IntegrationModuleParts, IntegrationProviderModule} from '#providers/types.js';

const SENTRY_SECRETS_NAMESPACE_PREFIX = 'system/integrations/sentry/';

async function loadSentryModuleParts(
  options: Parameters<IntegrationProviderModule['load']>[0] = {},
): Promise<IntegrationModuleParts> {
  const {
    createSentryIntegrationProvider,
    createSentryMaintenanceWorker,
    createSentryReadClient,
    getSentryInstallationByInstallationUuid,
    persistVerifiedUnclaimedInstallation,
    upsertSentryInstallation,
    db: sentryDb,
    migrationsPath: sentryMigrationsPath,
    sentrySecretsNamespace,
  } = await import('@shipfox/api-integration-sentry');
  let providerCapabilities: IntegrationCapability[] = [];

  async function getConnectionById(
    id: string,
  ): Promise<CoreIntegrationConnection<'sentry'> | undefined> {
    const connection = await getIntegrationConnectionById(id);
    if (!connection) return undefined;
    return connection as CoreIntegrationConnection<'sentry'>;
  }

  async function connectSentryInstallation(
    input: ConnectSentryInstallationInput,
  ): Promise<CoreIntegrationConnection<'sentry'>> {
    return await retryConnectionSlugCollision(() =>
      db().transaction(async (tx) => {
        const baseSlug = slugifyConnectionSlug(`sentry_${input.orgSlug}`, {fallback: 'sentry'});
        const slug = await resolveUniqueConnectionSlug(
          {
            workspaceId: input.workspaceId,
            provider: 'sentry',
            externalAccountId: input.installationUuid,
            baseSlug,
          },
          {tx},
        );
        const connection = await upsertIntegrationConnection(
          {
            workspaceId: input.workspaceId,
            provider: 'sentry',
            externalAccountId: input.installationUuid,
            slug,
            displayName: input.displayName,
            lifecycleStatus: 'active',
            capabilities: providerCapabilities,
            actorUserId: input.actorUserId,
          },
          {tx},
        );

        await upsertSentryInstallation(
          {
            connectionId: connection.id,
            installationUuid: input.installationUuid,
            orgSlug: input.orgSlug,
            status: 'installed',
            codeHash: input.codeHash,
            installerUserId: input.installerUserId,
          },
          {tx},
        );

        return connection as CoreIntegrationConnection<'sentry'>;
      }),
    );
  }

  const fallbackSecrets: SentrySecretsStore = {
    getSecret: () => Promise.resolve(null),
    setSecrets: () => Promise.reject(new Error('Sentry token storage is not configured')),
  };
  const secrets: SentrySecretsStore = options.secrets?.sentry
    ? {
        getSecret: (params) =>
          options.secrets?.sentry?.getSecret({
            ...params,
            namespace: sentryNamespaceSuffix(params.namespace),
          }) ?? Promise.resolve(null),
        setSecrets: (params) =>
          options.secrets?.sentry?.setSecrets({
            ...params,
            namespace: sentryNamespaceSuffix(params.namespace),
          }) ?? Promise.resolve(),
      }
    : fallbackSecrets;
  const readClient = createSentryReadClient({
    resolveConnection: async (connectionId) => getIntegrationConnectionById(connectionId),
    secrets,
  });

  const integrationProvider = createSentryIntegrationProvider({
    agentTools: {readClient},
    cleanup: {
      deleteConnectionSecrets: async (connection) => {
        // Scoped secrets accept the provider-local suffix, after this helper validates its prefix.
        await (options.secrets?.sentry?.deleteSecrets({
          workspaceId: connection.workspaceId,
          namespace: sentryNamespaceSuffix(sentrySecretsNamespace(connection.id)),
        }) ?? Promise.resolve());
      },
    },
    getSentryInstallation: ({installationUuid}) =>
      getSentryInstallationByInstallationUuid(installationUuid),
    getConnectionById,
    connectSentryInstallation,
    persistVerifiedUnclaimedInstallation,
    coreDb: db,
    publishIntegrationEventReceived,
    recordDeliveryOnly,
    getIntegrationConnectionById,
    updateConnectionLifecycleStatus: updateIntegrationConnectionLifecycleStatus,
  });
  providerCapabilities = getIntegrationProviderCapabilities(integrationProvider.adapters);

  return {
    provider: integrationProvider,
    webhookProcessors: integrationProvider.webhookProcessors,
    database: {
      db: sentryDb,
      migrationsPath: sentryMigrationsPath,
      databaseNamespace: 'integrations_sentry',
    },
    workers: [createSentryMaintenanceWorker()],
  };
}

export const sentryProviderModule: IntegrationProviderModule = {
  id: 'sentry',
  enabled: config.INTEGRATIONS_ENABLE_SENTRY_PROVIDER,
  load: loadSentryModuleParts,
};

function sentryNamespaceSuffix(namespace: string): string {
  if (!namespace.startsWith(SENTRY_SECRETS_NAMESPACE_PREFIX)) {
    throw new Error('Sentry provider attempted to access an unscoped secret namespace');
  }
  return namespace.slice(SENTRY_SECRETS_NAMESPACE_PREFIX.length);
}
