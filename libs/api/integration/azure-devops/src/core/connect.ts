import {randomBytes} from 'node:crypto';
import type {AzureDevOpsServiceHookSetupDto} from '@shipfox/api-integration-azure-devops-dto';
import type {AzureDevOpsCredential} from '#api/client.js';
import {
  type AzureDevOpsClientFactory,
  type AzureDevOpsIntegrationConnection,
  type AzureDevOpsSecretsStore,
  azureDevOpsSecretsNamespace,
  CREDENTIAL_KIND_KEY,
  CREDENTIAL_TOKEN_KEY,
  WEBHOOK_PASSWORD_KEY,
} from './credentials.js';
import {
  AzureDevOpsCredentialRejectedError,
  AzureDevOpsIntegrationProviderError,
  AzureDevOpsOrganizationAlreadyLinkedError,
} from './errors.js';
import {azureDevOpsWebhookUrl} from './webhook-url.js';

export interface ConnectAzureDevOpsConnectionInput {
  workspaceId: string;
  organization: string;
  displayName: string;
  /** Used only when the connection is new; a reconnect keeps the user name it already has. */
  webhookUsername: string;
}

export interface ConnectAzureDevOpsConnectionResult {
  connection: AzureDevOpsIntegrationConnection;
  /** The stored Service Hook user name: the new one, or the one the connection already had. */
  webhookUsername: string;
}

export interface HandleAzureDevOpsConnectParams {
  createClient: AzureDevOpsClientFactory;
  secrets: AzureDevOpsSecretsStore;
  workspaceId: string;
  organization: string;
  token: string;
  editedBy?: string | null | undefined;
  getExistingAzureDevOpsConnection: (input: {
    organization: string;
  }) => Promise<AzureDevOpsIntegrationConnection | undefined>;
  connectAzureDevOpsConnection: (
    input: ConnectAzureDevOpsConnectionInput,
  ) => Promise<ConnectAzureDevOpsConnectionResult>;
  /** Removes a connection this call just created, when its secrets could not be stored. */
  discardAzureDevOpsConnection: (connection: AzureDevOpsIntegrationConnection) => Promise<void>;
}

export interface AzureDevOpsConnectResult {
  connection: AzureDevOpsIntegrationConnection;
  serviceHook: AzureDevOpsServiceHookSetupDto;
}

/**
 * Connects an Azure DevOps organization with a token. The token is checked against the
 * organization before anything is stored, and stored only in workspace secrets. Every connect
 * issues a new Service Hook password. The hook user name is set once per connection and never
 * rotated, so a reconnect whose secret write fails leaves the old user name and password working.
 */
export async function handleAzureDevOpsConnect(
  params: HandleAzureDevOpsConnectParams,
): Promise<AzureDevOpsConnectResult> {
  // Organization URLs are case-insensitive; one canonical form keeps the cross-workspace guard
  // (a unique index on the stored name) from being bypassed by a case variant.
  const organization = params.organization.toLowerCase();
  const credential: AzureDevOpsCredential = {kind: 'pat', token: params.token};
  await assertCredentialWorks(params.createClient, organization, credential);

  const existing = await params.getExistingAzureDevOpsConnection({organization});
  if (existing && existing.workspaceId !== params.workspaceId) {
    throw new AzureDevOpsOrganizationAlreadyLinkedError(organization);
  }

  const webhookPassword = randomBytes(32).toString('base64url');
  const {connection, webhookUsername} = await params.connectAzureDevOpsConnection({
    workspaceId: params.workspaceId,
    organization,
    displayName: `Azure DevOps ${organization}`,
    webhookUsername: `shipfox-${randomBytes(6).toString('hex')}`,
  });

  try {
    await params.secrets.setSecrets({
      workspaceId: connection.workspaceId,
      namespace: azureDevOpsSecretsNamespace(connection.id),
      values: {
        [CREDENTIAL_KIND_KEY]: credential.kind,
        [CREDENTIAL_TOKEN_KEY]: credential.token,
        [WEBHOOK_PASSWORD_KEY]: webhookPassword,
      },
      editedBy: params.editedBy,
    });
  } catch (error) {
    // Secrets live in another module, so they cannot join the connection transaction. Without
    // them a new connection could never authenticate; remove it so the user can simply retry.
    // A reconnect keeps the connection, its unchanged hook user name and its previous secrets.
    if (!existing) await params.discardAzureDevOpsConnection(connection);
    throw error;
  }

  return {
    connection,
    serviceHook: {
      url: azureDevOpsWebhookUrl(connection.id),
      username: webhookUsername,
      password: webhookPassword,
    },
  };
}

async function assertCredentialWorks(
  createClient: AzureDevOpsClientFactory,
  organization: string,
  credential: AzureDevOpsCredential,
): Promise<void> {
  const client = createClient({organization, credential});
  try {
    await client.getConnectionData();
    // Reading repositories proves the token has Code access, which every adapter needs.
    await client.listRepositories();
  } catch (error) {
    if (
      error instanceof AzureDevOpsIntegrationProviderError &&
      (error.reason === 'access-denied' || error.reason === 'repository-not-found')
    ) {
      throw new AzureDevOpsCredentialRejectedError(organization);
    }
    throw error;
  }
}
