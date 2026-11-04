import {azureDevOpsProviderKind} from '@shipfox/api-integration-azure-devops-dto';
import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import type {
  AzureDevOpsApiClient,
  AzureDevOpsClientOptions,
  AzureDevOpsCredential,
} from '#api/client.js';
import {AzureDevOpsIntegrationProviderError} from './errors.js';

export {azureDevOpsProviderKind};

export type AzureDevOpsIntegrationConnection = IntegrationConnection<'azure-devops'>;

/**
 * Looks up the credential stored for one connection. Unlike Gitea's single service account,
 * every Azure DevOps connection carries its own organization and credential.
 */
export interface AzureDevOpsConnectionCredentials {
  resolve(connection: AzureDevOpsIntegrationConnection): Promise<AzureDevOpsCredential>;
}

export type AzureDevOpsClientFactory = (options: AzureDevOpsClientOptions) => AzureDevOpsApiClient;

/** Workspace secrets, already scoped by core to `system/integrations/azure-devops/`. */
export interface AzureDevOpsSecretsStore {
  getSecret(params: {workspaceId: string; namespace: string; key: string}): Promise<string | null>;
  setSecrets(params: {
    workspaceId: string;
    namespace: string;
    values: Record<string, string>;
    editedBy?: string | null | undefined;
  }): Promise<void>;
  deleteSecrets(params: {workspaceId: string; namespace: string}): Promise<number>;
}

export const CREDENTIAL_KIND_KEY = 'credential_kind';
export const CREDENTIAL_TOKEN_KEY = 'credential_token';
export const WEBHOOK_PASSWORD_KEY = 'webhook_password';

/** One secret namespace per connection, so deleting a connection deletes exactly its secrets. */
export function azureDevOpsSecretsNamespace(connectionId: string): string {
  return connectionId;
}

export function createSecretsConnectionCredentials(
  secrets: AzureDevOpsSecretsStore,
): AzureDevOpsConnectionCredentials {
  return {
    async resolve(connection) {
      const namespace = azureDevOpsSecretsNamespace(connection.id);
      const workspaceId = connection.workspaceId;
      const [kind, token] = await Promise.all([
        secrets.getSecret({workspaceId, namespace, key: CREDENTIAL_KIND_KEY}),
        secrets.getSecret({workspaceId, namespace, key: CREDENTIAL_TOKEN_KEY}),
      ]);
      if (!token || (kind !== 'pat' && kind !== 'bearer')) {
        throw new AzureDevOpsIntegrationProviderError(
          'credentials-unavailable',
          `Azure DevOps connection ${connection.slug} has no stored credential; connect it again`,
        );
      }
      return {kind, token};
    },
  };
}
