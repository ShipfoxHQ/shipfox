import {
  azureDevOpsEventCatalog,
  azureDevOpsProviderKind,
} from '@shipfox/api-integration-azure-devops-dto';
import type {
  GetIntegrationConnectionByIdFn,
  PublishIntegrationEventReceivedFn,
  PublishSourcePushFn,
  RecordDeliveryOnlyFn,
} from '@shipfox/api-integration-spi';
import {repositoryScopeResources} from '@shipfox/api-integration-spi';
import type {NodePgDatabase} from 'drizzle-orm/node-postgres';
import {createAzureDevOpsApiClient} from '#api/client.js';
import {AzureDevOpsAgentToolsProvider} from '#core/agent-tools-provider.js';
import type {ConnectAzureDevOpsConnectionInput} from '#core/connect.js';
import {azureDevOpsConnectionExternalUrl} from '#core/connection-url.js';
import {
  type AzureDevOpsClientFactory,
  type AzureDevOpsIntegrationConnection,
  type AzureDevOpsSecretsStore,
  azureDevOpsSecretsNamespace,
  createSecretsConnectionCredentials,
} from '#core/credentials.js';
import {AzureDevOpsSourceControlProvider} from '#core/source-control.js';
import {createAzureDevOpsWebhookProcessor} from '#core/webhook-processor.js';
import {deleteAzureDevOpsConnectionByConnectionId} from '#db/connections.js';
import {closeDb, db} from '#db/db.js';
import {migrationsPath} from '#db/migrations.js';
import {createAzureDevOpsConnectionRoutes} from '#presentation/routes/connections.js';
import {createAzureDevOpsWebhookRoutes} from '#presentation/routes/webhooks.js';

export type {
  AzureDevOpsApiClient,
  AzureDevOpsClientOptions,
  AzureDevOpsCredential,
  AzureDevOpsPullRequest,
  AzureDevOpsRepository,
} from '#api/client.js';
export {createAzureDevOpsApiClient} from '#api/client.js';
export type {
  AzureDevOpsAgentToolCatalogEntry,
  AzureDevOpsAgentToolId,
  AzureDevOpsAgentToolRequiredScope,
} from '#core/agent-tools.js';
export {
  azureDevOpsAgentToolCatalog,
  azureDevOpsAgentToolSelectionCatalog,
} from '#core/agent-tools.js';
export {AzureDevOpsAgentToolsProvider} from '#core/agent-tools-provider.js';
export type {ConnectAzureDevOpsConnectionInput} from '#core/connect.js';
export {handleAzureDevOpsConnect} from '#core/connect.js';
export {
  type AzureDevOpsClientFactory,
  type AzureDevOpsConnectionCredentials,
  type AzureDevOpsIntegrationConnection,
  type AzureDevOpsSecretsStore,
  azureDevOpsProviderKind,
} from '#core/credentials.js';
export {
  AzureDevOpsCredentialRejectedError,
  AzureDevOpsIntegrationProviderError,
  AzureDevOpsOrganizationAlreadyLinkedError,
} from '#core/errors.js';
export {AzureDevOpsSourceControlProvider} from '#core/source-control.js';
export {createAzureDevOpsWebhookProcessor} from '#core/webhook-processor.js';
export type {AzureDevOpsConnection, UpsertAzureDevOpsConnectionParams} from '#db/connections.js';
export {
  getAzureDevOpsConnectionByConnectionId,
  getAzureDevOpsConnectionByOrganization,
  upsertAzureDevOpsConnection,
} from '#db/connections.js';
export {closeDb, db, migrationsPath};

export interface CreateAzureDevOpsIntegrationProviderOptions {
  createClient?: AzureDevOpsClientFactory | undefined;
  secrets: AzureDevOpsSecretsStore;
  getExistingAzureDevOpsConnection: (input: {
    organization: string;
  }) => Promise<AzureDevOpsIntegrationConnection | undefined>;
  connectAzureDevOpsConnection: (
    input: ConnectAzureDevOpsConnectionInput,
  ) => Promise<AzureDevOpsIntegrationConnection>;
  coreDb: () => NodePgDatabase<Record<string, unknown>>;
  publishSourcePush: PublishSourcePushFn;
  publishIntegrationEventReceived: PublishIntegrationEventReceivedFn;
  recordDeliveryOnly: RecordDeliveryOnlyFn;
  getIntegrationConnectionById: GetIntegrationConnectionByIdFn;
}

export function createAzureDevOpsIntegrationProvider(
  options: CreateAzureDevOpsIntegrationProviderOptions,
) {
  const createClient = options.createClient ?? createAzureDevOpsApiClient;
  const credentials = createSecretsConnectionCredentials(options.secrets);
  const sourceControl = new AzureDevOpsSourceControlProvider(createClient, credentials);
  const webhookProcessor = createAzureDevOpsWebhookProcessor({
    coreDb: options.coreDb,
    secrets: options.secrets,
    publishSourcePush: options.publishSourcePush,
    publishIntegrationEventReceived: options.publishIntegrationEventReceived,
    recordDeliveryOnly: options.recordDeliveryOnly,
    getIntegrationConnectionById: options.getIntegrationConnectionById,
  });

  return {
    provider: azureDevOpsProviderKind,
    displayName: 'Azure DevOps',
    eventCatalog: azureDevOpsEventCatalog,
    ...repositoryScopeResources(sourceControl),
    adapters: {
      source_control: sourceControl,
      agent_tools: new AzureDevOpsAgentToolsProvider({createClient, credentials}),
    },
    connectionExternalUrl(connection: {externalAccountId: string}): Promise<string | undefined> {
      return Promise.resolve(azureDevOpsConnectionExternalUrl(connection.externalAccountId));
    },
    async deleteConnectionRecords(
      connection: AzureDevOpsIntegrationConnection,
      transaction: {tx: unknown},
    ): Promise<void> {
      await deleteAzureDevOpsConnectionByConnectionId(connection.id, {tx: transaction.tx});
    },
    async deleteConnectionSecrets(connection: AzureDevOpsIntegrationConnection): Promise<void> {
      await options.secrets.deleteSecrets({
        workspaceId: connection.workspaceId,
        namespace: azureDevOpsSecretsNamespace(connection.id),
      });
    },
    routes: [
      createAzureDevOpsConnectionRoutes({
        createClient,
        secrets: options.secrets,
        getExistingAzureDevOpsConnection: options.getExistingAzureDevOpsConnection,
        connectAzureDevOpsConnection: options.connectAzureDevOpsConnection,
      }),
      createAzureDevOpsWebhookRoutes({processor: webhookProcessor}),
    ],
    webhookProcessors: [{routeIds: ['azure-devops'] as const, processor: webhookProcessor}],
  };
}
