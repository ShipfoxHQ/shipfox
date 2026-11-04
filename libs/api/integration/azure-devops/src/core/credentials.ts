import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import type {
  AzureDevOpsApiClient,
  AzureDevOpsClientOptions,
  AzureDevOpsCredential,
} from '#api/client.js';

export const azureDevOpsProviderKind = 'azure-devops';

export type AzureDevOpsIntegrationConnection = IntegrationConnection<'azure-devops'>;

/**
 * Looks up the credential stored for one connection. Unlike Gitea's single service account,
 * every Azure DevOps connection carries its own organization and credential.
 */
export interface AzureDevOpsConnectionCredentials {
  resolve(connection: AzureDevOpsIntegrationConnection): Promise<AzureDevOpsCredential>;
}

export type AzureDevOpsClientFactory = (options: AzureDevOpsClientOptions) => AzureDevOpsApiClient;
