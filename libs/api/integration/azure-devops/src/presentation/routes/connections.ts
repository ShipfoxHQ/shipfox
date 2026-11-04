import {AUTH_USER, requireWorkspaceAccess} from '@shipfox/api-auth-context';
import {
  createAzureDevOpsConnectionBodySchema,
  createAzureDevOpsConnectionResponseSchema,
} from '@shipfox/api-integration-azure-devops-dto';
import type {IntegrationCapabilityDto} from '@shipfox/api-integration-core-dto';
import {defineRoute, type RouteGroup} from '@shipfox/node-fastify';
import {type ConnectAzureDevOpsConnectionInput, handleAzureDevOpsConnect} from '#core/connect.js';
import {azureDevOpsConnectionExternalUrl} from '#core/connection-url.js';
import type {
  AzureDevOpsClientFactory,
  AzureDevOpsIntegrationConnection,
  AzureDevOpsSecretsStore,
} from '#core/credentials.js';
import {toIntegrationConnectionDto} from '#presentation/dto/integrations.js';
import {azureDevOpsRouteErrorHandler} from './errors.js';

export interface CreateAzureDevOpsConnectionRoutesOptions {
  createClient: AzureDevOpsClientFactory;
  secrets: AzureDevOpsSecretsStore;
  /** The provider's capabilities, derived from its registered adapters. */
  capabilities: IntegrationCapabilityDto[];
  getExistingAzureDevOpsConnection: (input: {
    organization: string;
  }) => Promise<AzureDevOpsIntegrationConnection | undefined>;
  connectAzureDevOpsConnection: (
    input: ConnectAzureDevOpsConnectionInput,
  ) => Promise<AzureDevOpsIntegrationConnection>;
  discardAzureDevOpsConnection: (connection: AzureDevOpsIntegrationConnection) => Promise<void>;
}

export function createAzureDevOpsConnectionRoutes(
  options: CreateAzureDevOpsConnectionRoutesOptions,
): RouteGroup {
  const createConnectionRoute = defineRoute({
    method: 'POST',
    path: '/connections',
    auth: AUTH_USER,
    description:
      'Connect an Azure DevOps organization to a workspace with a token, and return new Service Hook credentials.',
    schema: {
      body: createAzureDevOpsConnectionBodySchema,
      response: {200: createAzureDevOpsConnectionResponseSchema},
    },
    errorHandler: azureDevOpsRouteErrorHandler,
    handler: async (request) => {
      const {workspace_id: workspaceId, organization, token} = request.body;
      const access = requireWorkspaceAccess({request, workspaceId});
      const result = await handleAzureDevOpsConnect({
        createClient: options.createClient,
        secrets: options.secrets,
        workspaceId,
        organization,
        token,
        editedBy: access.userId,
        getExistingAzureDevOpsConnection: options.getExistingAzureDevOpsConnection,
        connectAzureDevOpsConnection: options.connectAzureDevOpsConnection,
        discardAzureDevOpsConnection: options.discardAzureDevOpsConnection,
      });

      return {
        ...toIntegrationConnectionDto(result.connection, {
          capabilities: options.capabilities,
          externalUrl: azureDevOpsConnectionExternalUrl(result.connection.externalAccountId),
        }),
        service_hook: result.serviceHook,
      };
    },
  });

  return {
    prefix: '/integrations/azure-devops',
    routes: [createConnectionRoute],
  };
}
