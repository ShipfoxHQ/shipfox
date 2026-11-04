import type {
  AzureDevOpsSecretsStore,
  ConnectAzureDevOpsConnectionInput,
} from '@shipfox/api-integration-azure-devops';
import type {IntegrationConnection as CoreIntegrationConnection} from '@shipfox/api-integration-spi';
import {config} from '#config.js';
import type {IntegrationCapability} from '#core/entities/provider.js';
import {getIntegrationProviderCapabilities} from '#core/providers/registry.js';
import {
  deleteIntegrationConnection,
  getIntegrationConnectionById,
  resolveUniqueConnectionSlug,
  upsertIntegrationConnection,
} from '#db/connections.js';
import {db} from '#db/db.js';
import {
  publishIntegrationEventReceived,
  publishSourcePush,
  recordDeliveryOnly,
} from '#db/webhook-deliveries.js';
import {retryConnectionSlugCollision, slugifyConnectionSlug} from '#providers/connection-slug.js';
import type {
  IntegrationModuleParts,
  IntegrationProviderModule,
  IntegrationProviderModuleLoadOptions,
} from '#providers/types.js';

const AZURE_DEVOPS_PROVIDER = 'azure-devops';

// Without configured secret storage the provider cannot hold a token, so connecting fails loudly
// instead of creating a connection that can never authenticate.
const unconfiguredSecrets: AzureDevOpsSecretsStore = {
  getSecret: () => Promise.resolve(null),
  setSecrets: () => Promise.reject(new Error('Azure DevOps token storage is not configured')),
  deleteSecrets: () => Promise.resolve(0),
};

async function loadAzureDevOpsModuleParts(
  options: IntegrationProviderModuleLoadOptions = {},
): Promise<IntegrationModuleParts> {
  const {
    createAzureDevOpsIntegrationProvider,
    deleteAzureDevOpsConnectionByConnectionId,
    getAzureDevOpsConnectionByOrganization,
    upsertAzureDevOpsConnection,
    db: azureDevOpsDb,
    migrationsPath: azureDevOpsMigrationsPath,
  } = await import('@shipfox/api-integration-azure-devops');
  let providerCapabilities: IntegrationCapability[] = [];
  const secrets: AzureDevOpsSecretsStore = options.secrets?.azureDevOps ?? unconfiguredSecrets;

  async function getExistingAzureDevOpsConnection(input: {
    organization: string;
  }): Promise<CoreIntegrationConnection<'azure-devops'> | undefined> {
    const row = await getAzureDevOpsConnectionByOrganization(input.organization);
    if (!row) return undefined;
    const connection = await getIntegrationConnectionById(row.connectionId);
    return connection as CoreIntegrationConnection<'azure-devops'> | undefined;
  }

  async function connectAzureDevOpsConnection(
    input: ConnectAzureDevOpsConnectionInput,
  ): Promise<CoreIntegrationConnection<'azure-devops'>> {
    return await retryConnectionSlugCollision(() =>
      db().transaction(async (tx) => {
        const baseSlug = slugifyConnectionSlug(`azure_devops_${input.organization}`, {
          fallback: 'azure_devops',
        });
        const slug = await resolveUniqueConnectionSlug(
          {
            workspaceId: input.workspaceId,
            provider: AZURE_DEVOPS_PROVIDER,
            externalAccountId: input.organization,
            baseSlug,
          },
          {tx},
        );
        const connection = await upsertIntegrationConnection(
          {
            workspaceId: input.workspaceId,
            provider: AZURE_DEVOPS_PROVIDER,
            externalAccountId: input.organization,
            slug,
            displayName: input.displayName,
            lifecycleStatus: 'active',
            capabilities: providerCapabilities,
          },
          {tx},
        );
        await upsertAzureDevOpsConnection(
          {
            connectionId: connection.id,
            organization: input.organization,
            webhookUsername: input.webhookUsername,
          },
          {tx},
        );
        return connection as CoreIntegrationConnection<'azure-devops'>;
      }),
    );
  }

  async function discardAzureDevOpsConnection(
    connection: CoreIntegrationConnection<'azure-devops'>,
  ): Promise<void> {
    await db().transaction(async (tx) => {
      await deleteAzureDevOpsConnectionByConnectionId(connection.id, {tx});
      await deleteIntegrationConnection({id: connection.id}, {tx});
    });
  }

  const integrationProvider = createAzureDevOpsIntegrationProvider({
    secrets,
    getExistingAzureDevOpsConnection,
    connectAzureDevOpsConnection,
    discardAzureDevOpsConnection,
    publishSourcePush,
    publishIntegrationEventReceived,
    recordDeliveryOnly,
    getIntegrationConnectionById,
    coreDb: db,
  });
  providerCapabilities = getIntegrationProviderCapabilities(integrationProvider.adapters);

  return {
    provider: integrationProvider,
    webhookProcessors: integrationProvider.webhookProcessors,
    database: {
      db: azureDevOpsDb,
      migrationsPath: azureDevOpsMigrationsPath,
      databaseNamespace: 'integrations_azure_devops',
    },
  };
}

export const azureDevOpsProviderModule: IntegrationProviderModule = {
  id: AZURE_DEVOPS_PROVIDER,
  enabled: config.INTEGRATIONS_ENABLE_AZURE_DEVOPS_PROVIDER,
  load: loadAzureDevOpsModuleParts,
};
