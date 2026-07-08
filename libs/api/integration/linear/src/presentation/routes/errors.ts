import {
  ConnectionSlugConflictError,
  type IntegrationProviderErrorReason,
} from '@shipfox/api-integration-core-dto';
import {ClientError} from '@shipfox/node-fastify';
import {
  LinearAuthorizationScopeMismatchError,
  LinearConnectionAlreadyLinkedError,
  LinearInstallationAlreadyLinkedError,
  LinearInstallStateActorMismatchError,
  LinearInstallStateError,
  LinearIntegrationProviderError,
  LinearOAuthCallbackError,
} from '#core/errors.js';

function providerStatus(reason: IntegrationProviderErrorReason): number {
  if (reason === 'rate-limited') return 429;
  if (reason === 'timeout' || reason === 'provider-unavailable') return 503;
  return 422;
}

export function linearRouteErrorHandler(error: unknown): never {
  if (error instanceof LinearInstallStateError) {
    throw new ClientError(error.message, 'invalid-linear-install-state', {status: 400});
  }
  if (error instanceof LinearInstallStateActorMismatchError) {
    throw new ClientError(error.message, 'linear-install-state-actor-mismatch', {status: 403});
  }
  if (error instanceof LinearInstallationAlreadyLinkedError) {
    throw new ClientError(error.message, 'linear-installation-already-linked', {status: 409});
  }
  if (error instanceof LinearConnectionAlreadyLinkedError) {
    throw new ClientError(error.message, 'linear-connection-already-linked', {status: 409});
  }
  if (error instanceof LinearAuthorizationScopeMismatchError) {
    throw new ClientError(error.message, 'linear-authorization-scope-mismatch', {
      status: 422,
      details: {missing_scopes: error.missingScopes},
    });
  }
  if (error instanceof LinearOAuthCallbackError) {
    throw new ClientError(error.message, 'linear-oauth-callback-error', {
      status: 422,
      details: {
        error: error.providerError,
        ...(error.providerDescription ? {error_description: error.providerDescription} : {}),
      },
    });
  }
  if (error instanceof ConnectionSlugConflictError) {
    throw new ClientError(error.message, 'slug-conflict', {status: 409});
  }
  if (error instanceof LinearIntegrationProviderError) {
    throw new ClientError(error.message, error.reason, {
      details: {retry_after_seconds: error.retryAfterSeconds},
      status: providerStatus(error.reason),
    });
  }
  throw error;
}
