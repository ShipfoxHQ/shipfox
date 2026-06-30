import type {IntegrationConnection as CoreIntegrationConnection} from '@shipfox/api-integration-core-dto';
import type {ConnectGithubInstallationInput} from '@shipfox/api-integration-github';
import {config} from '#config.js';
import {getIntegrationConnectionById, upsertIntegrationConnection} from '#db/connections.js';
import {db} from '#db/db.js';
import {
  publishIntegrationEventReceived,
  publishSourcePush,
  recordDeliveryOnly,
} from '#db/webhook-deliveries.js';
import type {IntegrationModuleParts, IntegrationProviderModule} from '#providers/types.js';

// Stable migration-tracking table name for the GitHub provider database. This
// must NOT depend on the provider's position in the module `database` array. A
// positional name would shift if a provider is flag-disabled and silently
// re-run migrations against existing tables.
const GITHUB_MIGRATIONS_TABLE = '__drizzle_migrations_integrations_github';

async function loadGithubModuleParts(): Promise<IntegrationModuleParts> {
  const {
    createGithubIntegrationProvider,
    getGithubInstallationByInstallationId,
    db: githubDb,
    migrationsPath: githubMigrationsPath,
    upsertGithubInstallation,
  } = await import('@shipfox/api-integration-github');

  async function getExistingGithubConnection(input: {
    installationId: string;
  }): Promise<CoreIntegrationConnection<'github'> | undefined> {
    const installation = await getGithubInstallationByInstallationId(input.installationId);
    if (!installation) return undefined;
    const connection = await getIntegrationConnectionById(installation.connectionId);
    if (!connection) return undefined;
    return connection as CoreIntegrationConnection<'github'>;
  }

  async function connectGithubInstallation(
    input: ConnectGithubInstallationInput,
  ): Promise<CoreIntegrationConnection<'github'>> {
    return await db().transaction(async (tx) => {
      const connection = await upsertIntegrationConnection(
        {
          workspaceId: input.workspaceId,
          provider: 'github',
          externalAccountId: input.installationId,
          displayName: input.displayName,
          lifecycleStatus: 'active',
        },
        {tx},
      );

      await upsertGithubInstallation(
        {
          connectionId: connection.id,
          ...input.installation,
        },
        {tx},
      );

      return connection as CoreIntegrationConnection<'github'>;
    });
  }

  return {
    provider: createGithubIntegrationProvider({
      getExistingGithubConnection,
      connectGithubInstallation,
      publishIntegrationEventReceived,
      publishSourcePush,
      recordDeliveryOnly,
      getIntegrationConnectionById,
      coreDb: db,
    }),
    database: {
      db: githubDb,
      migrationsPath: githubMigrationsPath,
      migrationsTableName: GITHUB_MIGRATIONS_TABLE,
    },
  };
}

export const githubProviderModule: IntegrationProviderModule = {
  id: 'github',
  enabled: config.INTEGRATIONS_ENABLE_GITHUB_PROVIDER,
  load: loadGithubModuleParts,
};
