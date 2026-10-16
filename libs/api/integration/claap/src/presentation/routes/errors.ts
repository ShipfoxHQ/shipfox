import type {IntegrationProviderErrorReason} from '@shipfox/api-integration-spi';
import {ClientError} from '@shipfox/node-fastify';
import {
  ClaapAlreadyConnectedError,
  ClaapApiKeyPrefixError,
  ClaapConnectionNotFoundError,
  ClaapCredentialVersionMismatchError,
  ClaapInstallationNotFoundError,
  ClaapIntegrationProviderError,
  ClaapInvalidApiKeyError,
  ClaapUnexpectedWorkspaceCountError,
  ClaapWorkspaceMismatchError,
} from '#core/errors.js';

function providerStatus(reason: IntegrationProviderErrorReason, status?: number): number {
  if (status === 401 || reason === 'credentials-unavailable') return 401;
  if (status === 403 || reason === 'access-denied') return 403;
  if (reason === 'timeout' || reason === 'provider-unavailable') return 503;
  if (reason === 'rate-limited') return 429;
  return 422;
}

export function claapRouteErrorHandler(error: unknown): never {
  if (error instanceof ClaapAlreadyConnectedError) {
    throw new ClientError('Claap workspace is already connected', 'already-connected', {
      status: 409,
      details: {connection_id: error.connectionId},
    });
  }
  if (error instanceof ClaapApiKeyPrefixError) {
    throw new ClientError(error.message, 'invalid-api-key-prefix', {status: 400});
  }
  if (error instanceof ClaapInvalidApiKeyError) {
    throw new ClientError(error.message, 'invalid-api-key', {status: 400});
  }
  if (error instanceof ClaapUnexpectedWorkspaceCountError) {
    throw new ClientError(error.message, 'unexpected-workspace-count', {status: 400});
  }
  if (error instanceof ClaapWorkspaceMismatchError) {
    throw new ClientError(error.message, 'workspace-mismatch', {status: 409});
  }
  if (error instanceof ClaapConnectionNotFoundError) {
    throw new ClientError(error.message, 'not-found', {status: 404});
  }
  if (error instanceof ClaapInstallationNotFoundError) {
    throw new ClientError(error.message, 'not-found', {status: 404});
  }
  if (error instanceof ClaapCredentialVersionMismatchError) {
    throw new ClientError(error.message, 'credential-version-conflict', {status: 409});
  }
  if (error instanceof ClaapIntegrationProviderError) {
    throw new ClientError(error.message, error.reason, {
      details: {retry_after_seconds: error.retryAfterSeconds},
      status: providerStatus(error.reason, error.status),
    });
  }
  throw error;
}
