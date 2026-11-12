import {
  ConnectionSlugConflictError,
  type IntegrationProviderErrorReason,
} from '@shipfox/api-integration-spi';
import {ClientError} from '@shipfox/node-fastify';
import {
  AzureDevOpsCredentialRejectedError,
  AzureDevOpsIntegrationProviderError,
  AzureDevOpsOrganizationAlreadyLinkedError,
} from '#core/errors.js';

function providerStatus(reason: IntegrationProviderErrorReason): number {
  if (reason === 'rate-limited') return 429;
  if (reason === 'timeout' || reason === 'provider-unavailable') return 503;
  return 422;
}

export function azureDevOpsRouteErrorHandler(error: unknown): never {
  if (error instanceof AzureDevOpsCredentialRejectedError) {
    throw new ClientError(error.message, 'azure-devops-credential-rejected', {status: 422});
  }
  if (error instanceof AzureDevOpsOrganizationAlreadyLinkedError) {
    throw new ClientError(error.message, 'azure-devops-organization-already-linked', {
      status: 409,
    });
  }
  if (error instanceof ConnectionSlugConflictError) {
    throw new ClientError(error.message, 'slug-conflict', {status: 409});
  }
  if (error instanceof AzureDevOpsIntegrationProviderError) {
    throw new ClientError(error.message, error.reason, {
      details: {retry_after_seconds: error.retryAfterSeconds},
      status: providerStatus(error.reason),
    });
  }
  throw error;
}
