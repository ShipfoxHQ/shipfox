import type {IntegrationConnection as CoreIntegrationConnection} from '@shipfox/api-integration-core-dto';
import type {ConnectGiteaConnectionInput} from '@shipfox/api-integration-gitea';
import {config} from '#config.js';
import {getIntegrationConnectionById, upsertIntegrationConnection} from '#db/connections.js';
import {db} from '#db/db.js';
import type {IntegrationModuleParts, IntegrationProviderModule} from '#providers/types.js';

// Stable migration-tracking table name for the Gitea provider database. This
// must NOT depend on the provider's position in the module `database` array. A
// positional name would shift if a provider is flag-disabled and silently
// re-run migrations against existing tables.
const GITEA_MIGRATIONS_TABLE = '__drizzle_migrations_integrations_gitea';

async function loadGiteaModuleParts(): Promise<IntegrationModuleParts> {
  const {
    createGiteaIntegrationProvider,
    getGiteaConnectionByOrg,
    upsertGiteaConnection,
    db: giteaDb,
    migrationsPath: giteaMigrationsPath,
  } = await import('@shipfox/api-integration-gitea');

  async function getExistingGiteaConnection(input: {
    org: string;
  }): Promise<CoreIntegrationConnection<'gitea'> | undefined> {
    const row = await getGiteaConnectionByOrg(input.org);
    if (!row) return undefined;
    const connection = await getIntegrationConnectionById(row.connectionId);
    if (!connection) return undefined;
    return connection as CoreIntegrationConnection<'gitea'>;
  }

  async function connectGiteaConnection(
    input: ConnectGiteaConnectionInput,
  ): Promise<CoreIntegrationConnection<'gitea'>> {
    return await db().transaction(async (tx) => {
      const connection = await upsertIntegrationConnection(
        {
          workspaceId: input.workspaceId,
          provider: 'gitea',
          externalAccountId: input.org,
          displayName: input.displayName,
          lifecycleStatus: 'active',
        },
        {tx},
      );

      await upsertGiteaConnection(
        {
          connectionId: connection.id,
          org: input.org,
        },
        {tx},
      );

      return connection as CoreIntegrationConnection<'gitea'>;
    });
  }

  return {
    provider: createGiteaIntegrationProvider({
      getExistingGiteaConnection,
      connectGiteaConnection,
    }),
    database: {
      db: giteaDb,
      migrationsPath: giteaMigrationsPath,
      migrationsTableName: GITEA_MIGRATIONS_TABLE,
    },
  };
}

export const giteaProviderModule: IntegrationProviderModule = {
  id: 'gitea',
  enabled: config.INTEGRATIONS_ENABLE_GITEA_PROVIDER,
  load: loadGiteaModuleParts,
};
