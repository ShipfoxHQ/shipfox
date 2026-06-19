import type {IntegrationConnection as CoreIntegrationConnection} from '@shipfox/api-integration-core-dto';
import type {ConnectSentryInstallationInput} from '@shipfox/api-integration-sentry';
import {config} from '#config.js';
import {
  getIntegrationConnectionById,
  updateIntegrationConnectionLifecycleStatus,
  upsertIntegrationConnection,
} from '#db/connections.js';
import {db} from '#db/db.js';
import {publishIntegrationEventReceived, recordDeliveryOnly} from '#db/webhook-deliveries.js';
import type {IntegrationModuleParts, IntegrationProviderModule} from '#providers/types.js';

// Stable migration-tracking table name for the Sentry provider database. This
// must NOT depend on the provider's position in the module `database` array — a
// positional name would shift if a provider is flag-disabled and silently
// re-run migrations against existing tables.
const SENTRY_MIGRATIONS_TABLE = '__drizzle_migrations_integrations_sentry';

async function loadSentryModuleParts(): Promise<IntegrationModuleParts> {
  const {
    createSentryIntegrationProvider,
    createSentryMaintenanceWorker,
    getSentryInstallationByInstallationUuid,
    persistVerifiedUnclaimedInstallation,
    upsertSentryInstallation,
    db: sentryDb,
    migrationsPath: sentryMigrationsPath,
  } = await import('@shipfox/api-integration-sentry');

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
    return await db().transaction(async (tx) => {
      const connection = await upsertIntegrationConnection(
        {
          workspaceId: input.workspaceId,
          provider: 'sentry',
          externalAccountId: input.installationUuid,
          displayName: input.displayName,
          lifecycleStatus: 'active',
        },
        {tx},
      );

      // Promotes the verified-unclaimed row to claimed by setting connection_id.
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
    });
  }

  return {
    provider: createSentryIntegrationProvider({
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
    }),
    database: {
      db: sentryDb,
      migrationsPath: sentryMigrationsPath,
      migrationsTableName: SENTRY_MIGRATIONS_TABLE,
    },
    workers: [createSentryMaintenanceWorker()],
  };
}

export const sentryProviderModule: IntegrationProviderModule = {
  id: 'sentry',
  enabled: config.INTEGRATIONS_ENABLE_SENTRY_PROVIDER,
  load: loadSentryModuleParts,
};
