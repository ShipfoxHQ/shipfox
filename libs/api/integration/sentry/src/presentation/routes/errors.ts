import {
  ConnectionSlugConflictError,
  type IntegrationProviderErrorReason,
} from '@shipfox/api-integration-spi';
import {ClientError} from '@shipfox/node-fastify';
import {
  SentryClaimProofMismatchError,
  SentryInstallationAlreadyLinkedError,
  SentryInstallationDeletedError,
  SentryIntegrationProviderError,
  SentryVerificationInProgressError,
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
  if (error instanceof SentryInstallationDeletedError) {
    throw new ClientError(error.message, 'sentry-installation-deleted', {status: 409});
  }
  if (error instanceof SentryClaimProofMismatchError) {
    throw new ClientError(error.message, 'sentry-claim-proof-mismatch', {status: 403});
  }
  if (error instanceof ConnectionSlugConflictError) {
    throw new ClientError(error.message, 'slug-conflict', {status: 409});
  }
  if (error instanceof SentryVerificationInProgressError) {
    // Retryable: a concurrent webhook is mid-exchange. 503 + retry_after lands in
    // the client backoff that already treats >= 500 as retryable.
    throw new ClientError(error.message, 'sentry-verification-in-progress', {
      status: 503,
      details: {retry_after_seconds: error.retryAfterSeconds},
    });
  }
  if (error instanceof SentryIntegrationProviderError) {
    throw new ClientError(error.message, error.reason, {
      details: {retry_after_seconds: error.retryAfterSeconds},
      status: providerStatus(error.reason),
    });
  }
  throw error;
}
