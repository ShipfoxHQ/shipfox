import type {IntegrationProviderErrorReason} from '@shipfox/api-integration-spi';
import {ClientError} from '@shipfox/node-fastify';
import {
  PosthogAlreadyConnectedError,
  PosthogApiKeyPrefixError,
  PosthogConnectionNotFoundError,
  PosthogCredentialVersionMismatchError,
  PosthogInstallationNotFoundError,
  PosthogIntegrationProviderError,
  PosthogNoProjectAccessError,
  PosthogProjectMismatchError,
  PosthogProjectNotAccessibleError,
} from '#core/errors.js';

function providerStatus(reason: IntegrationProviderErrorReason, status?: number): number {
  if (status === 401 || reason === 'credentials-unavailable') return 401;
  if (status === 403 || reason === 'access-denied') return 403;
  if (reason === 'timeout' || reason === 'provider-unavailable') return 503;
  if (reason === 'rate-limited') return 429;
  return 422;
}

export function posthogRouteErrorHandler(error: unknown): never {
  if (error instanceof PosthogAlreadyConnectedError) {
    throw new ClientError('PostHog project is already connected', 'already-connected', {
      status: 409,
      details: {connection_id: error.connectionId},
    });
  }
  if (error instanceof PosthogApiKeyPrefixError) {
    throw new ClientError(error.message, 'invalid-api-key-prefix', {status: 400});
  }
  if (error instanceof PosthogNoProjectAccessError) {
    throw new ClientError(error.message, 'no-project-access', {status: 400});
  }
  if (error instanceof PosthogProjectNotAccessibleError) {
    throw new ClientError(error.message, 'project-not-accessible', {status: 400});
  }
  if (error instanceof PosthogProjectMismatchError) {
    throw new ClientError(error.message, 'project-mismatch', {status: 400});
  }
  if (error instanceof PosthogConnectionNotFoundError) {
    throw new ClientError(error.message, 'not-found', {status: 404});
  }
  if (error instanceof PosthogInstallationNotFoundError) {
    throw new ClientError(error.message, 'not-found', {status: 404});
  }
  if (error instanceof PosthogCredentialVersionMismatchError) {
    throw new ClientError(error.message, 'credential-version-conflict', {status: 409});
  }
  if (error instanceof PosthogIntegrationProviderError) {
    throw new ClientError(error.message, error.reason, {
      details: {retry_after_seconds: error.retryAfterSeconds},
      status: providerStatus(error.reason, error.status),
    });
  }
  throw error;
}
