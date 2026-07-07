import {
  type IntegrationConnection as CoreIntegrationConnection,
  slugifyConnectionSlug,
} from '@shipfox/api-integration-core-dto';
import type {
  ConnectLinearInstallationInput,
  LinearSecretsStore,
} from '@shipfox/api-integration-linear';
import {config} from '#config.js';
import {
  getIntegrationConnectionById,
  resolveUniqueConnectionSlug,
  upsertIntegrationConnection,
} from '#db/connections.js';
import {db} from '#db/db.js';
import {retryConnectionSlugCollision} from '#providers/connection-slug.js';
import type {IntegrationModuleParts, IntegrationProviderModule} from '#providers/types.js';

const LINEAR_MIGRATIONS_TABLE = '__drizzle_migrations_integrations_linear';

async function loadLinearModuleParts(
  options: Parameters<IntegrationProviderModule['load']>[0] = {},
): Promise<IntegrationModuleParts> {
  const {
    createLinearTokenStore,
    createLinearIntegrationProvider,
    getLinearInstallationByOrganizationId,
    db: linearDb,
    migrationsPath: linearMigrationsPath,
    upsertLinearInstallation,
  } = await import('@shipfox/api-integration-linear');

  async function getExistingLinearConnection(input: {
    organizationId: string;
  }): Promise<CoreIntegrationConnection<'linear'> | undefined> {
    const installation = await getLinearInstallationByOrganizationId(input.organizationId);
    if (!installation) return undefined;
    const connection = await getIntegrationConnectionById(installation.connectionId);
    if (!connection) return undefined;
    return connection as CoreIntegrationConnection<'linear'>;
  }

  async function connectLinearInstallation(
    input: ConnectLinearInstallationInput,
  ): Promise<CoreIntegrationConnection<'linear'>> {
    return await retryConnectionSlugCollision(() =>
      db().transaction(async (tx) => {
        const baseSlug = slugifyConnectionSlug(`linear_${input.organizationUrlKey}`, {
          fallback: 'linear',
        });
        const slug = await resolveUniqueConnectionSlug(
          {
            workspaceId: input.workspaceId,
            provider: 'linear',
            externalAccountId: input.organizationId,
            baseSlug,
          },
          {tx},
        );
        const connection = await upsertIntegrationConnection(
          {
            workspaceId: input.workspaceId,
            provider: 'linear',
            externalAccountId: input.organizationId,
            slug,
            displayName: input.displayName,
            lifecycleStatus: 'active',
          },
          {tx},
        );

        await upsertLinearInstallation(
          {
            connectionId: connection.id,
            organizationId: input.organizationId,
            organizationUrlKey: input.organizationUrlKey,
            appUserId: input.appUserId,
            scopes: input.scopes,
            tokenExpiresAt: input.tokenExpiresAt,
            status: 'installed',
          },
          {tx},
        );

        return connection as CoreIntegrationConnection<'linear'>;
      }),
    );
  }

  const fallbackSecrets: LinearSecretsStore = {
    getSecret: () => Promise.resolve(null),
    setSecrets: () => Promise.reject(new Error('Linear token storage is not configured')),
  };
  const secrets = options.secrets ?? fallbackSecrets;
  const tokenStore = createLinearTokenStore({
    resolveConnection: async (connectionId) => getIntegrationConnectionById(connectionId),
    secrets,
  });

  return {
    provider: createLinearIntegrationProvider({
      routes: {
        tokenStore,
        getExistingLinearConnection,
        connectLinearInstallation,
      },
    }),
    database: {
      db: linearDb,
      migrationsPath: linearMigrationsPath,
      migrationsTableName: LINEAR_MIGRATIONS_TABLE,
    },
  };
}

export const linearProviderModule: IntegrationProviderModule = {
  id: 'linear',
  enabled: config.INTEGRATIONS_ENABLE_LINEAR_PROVIDER,
  load: loadLinearModuleParts,
};
