import type {ConnectSentryInstallationInput} from '@shipfox/api-integration-sentry';
import type {IntegrationConnection as CoreIntegrationConnection} from '@shipfox/api-integration-spi';
import {config} from '#config.js';
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

// Stable migration-tracking table name for the Sentry provider database. This
// must NOT depend on the provider's position in the module `database` array. A
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

  const integrationProvider = createSentryIntegrationProvider({
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

  return {
    provider: integrationProvider,
    webhookProcessors: integrationProvider.webhookProcessors,
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
