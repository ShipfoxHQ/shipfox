import {
  ConnectionSlugConflictError,
  type IntegrationProviderErrorReason,
} from '@shipfox/api-integration-core-dto';
import {ClientError} from '@shipfox/node-fastify';
import {
  GiteaIntegrationProviderError,
  GiteaOrgAlreadyLinkedError,
  GiteaOrganizationNotFoundError,
} from '#core/errors.js';

function providerStatus(reason: IntegrationProviderErrorReason): number {
  if (reason === 'rate-limited') return 429;
  if (reason === 'timeout' || reason === 'provider-unavailable') return 503;
  return 422;
}

export function giteaRouteErrorHandler(error: unknown): never {
  if (error instanceof GiteaOrganizationNotFoundError) {
    throw new ClientError(error.message, 'gitea-organization-not-found', {status: 404});
  }
  if (error instanceof GiteaOrgAlreadyLinkedError) {
    throw new ClientError(error.message, 'gitea-org-already-linked', {status: 409});
  }
  if (error instanceof ConnectionSlugConflictError) {
    throw new ClientError(error.message, 'slug-conflict', {status: 409});
  }
  if (error instanceof GiteaIntegrationProviderError) {
    throw new ClientError(error.message, error.reason, {
      details: {retry_after_seconds: error.retryAfterSeconds},
      status: providerStatus(error.reason),
    });
  }
  throw error;
}
