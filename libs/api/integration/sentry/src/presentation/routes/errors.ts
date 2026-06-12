import type {IntegrationProviderErrorReason} from '@shipfox/api-integration-core-dto';
import {ClientError} from '@shipfox/node-fastify';
import {
  SentryInstallationAlreadyLinkedError,
  SentryIntegrationProviderError,
} from '#core/errors.js';

function providerStatus(reason: IntegrationProviderErrorReason): number {
  if (reason === 'rate-limited') return 429;
  if (reason === 'timeout' || reason === 'provider-unavailable') return 503;
  return 422;
}

export function sentryRouteErrorHandler(error: unknown): never {
  if (error instanceof SentryInstallationAlreadyLinkedError) {
    throw new ClientError(error.message, 'sentry-installation-already-linked', {status: 409});
  }
  if (error instanceof SentryIntegrationProviderError) {
    throw new ClientError(error.message, error.reason, {
      details: {retry_after_seconds: error.retryAfterSeconds},
      status: providerStatus(error.reason),
    });
  }
  throw error;
}
