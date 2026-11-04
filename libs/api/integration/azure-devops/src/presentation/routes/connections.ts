import {AUTH_USER, requireWorkspaceAccess} from '@shipfox/api-auth-context';
import {
  createAzureDevOpsConnectionBodySchema,
  createAzureDevOpsConnectionResponseSchema,
} from '@shipfox/api-integration-azure-devops-dto';
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
  getExistingAzureDevOpsConnection: (input: {
    organization: string;
  }) => Promise<AzureDevOpsIntegrationConnection | undefined>;
  connectAzureDevOpsConnection: (
    input: ConnectAzureDevOpsConnectionInput,
  ) => Promise<AzureDevOpsIntegrationConnection>;
}

export function createAzureDevOpsConnectionRoutes(
  options: CreateAzureDevOpsConnectionRoutesOptions,
): RouteGroup {
  const createConnectionRoute = defineRoute({
    method: 'POST',
    path: '/connections',
    auth: AUTH_USER,
    description:
      'Connect an Azure DevOps organization to a workspace with a token, and return the Service Hook credentials once.',
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
      });

      return {
        ...toIntegrationConnectionDto(result.connection, {
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
