import {
  ConnectionSlugConflictError,
  type IntegrationProviderErrorReason,
} from '@shipfox/api-integration-spi';
import {ClientError} from '@shipfox/node-fastify';
import {
  GithubInstallationAlreadyLinkedError,
  GithubInstallationNotAuthorizedError,
  GithubInstallStateActorMismatchError,
  GithubInstallStateError,
  GithubIntegrationProviderError,
} from '#core/errors.js';

function providerStatus(reason: IntegrationProviderErrorReason): number {
  if (reason === 'rate-limited') return 429;
  if (reason === 'timeout' || reason === 'provider-unavailable') return 503;
  return 422;
}

export function githubRouteErrorHandler(error: unknown): never {
  if (error instanceof GithubInstallStateError) {
    throw new ClientError(error.message, 'invalid-github-install-state', {status: 400});
  }
  if (error instanceof GithubInstallStateActorMismatchError) {
    throw new ClientError(error.message, 'github-install-state-actor-mismatch', {status: 403});
  }
  if (error instanceof GithubInstallationNotAuthorizedError) {
    throw new ClientError(error.message, 'github-installation-not-authorized', {status: 403});
  }
  if (error instanceof GithubInstallationAlreadyLinkedError) {
    throw new ClientError(error.message, 'github-installation-already-linked', {status: 409});
  }
  if (error instanceof ConnectionSlugConflictError) {
    throw new ClientError(error.message, 'slug-conflict', {status: 409});
  }
  if (error instanceof GithubIntegrationProviderError) {
    throw new ClientError(error.message, error.reason, {
      details: {retry_after_seconds: error.retryAfterSeconds},
      status: providerStatus(error.reason),
    });
  }
  throw error;
}
