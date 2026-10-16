import type {IntegrationProviderErrorReason} from '@shipfox/api-integration-spi';
import {ClientError} from '@shipfox/node-fastify';
import {
  JamAlreadyConnectedError,
  JamConnectionNotFoundError,
  JamCredentialVersionMismatchError,
  JamInstallationNotFoundError,
  JamIntegrationProviderError,
  JamInvalidTokenError,
  JamMcpUnavailableError,
  JamMissingReadScopeError,
  JamTokenPrefixError,
  JamWorkspaceMismatchError,
} from '#core/errors.js';

function providerStatus(reason: IntegrationProviderErrorReason, status?: number): number {
  if (status === 401 || reason === 'credentials-unavailable') return 401;
  if (status === 403 || reason === 'access-denied') return 403;
  if (reason === 'timeout' || reason === 'provider-unavailable') return 503;
  if (reason === 'rate-limited') return 429;
  return 422;
}

export function jamRouteErrorHandler(error: unknown): never {
  if (error instanceof JamAlreadyConnectedError) {
    throw new ClientError('Jam workspace is already connected', 'already-connected', {
      status: 409,
      details: {connection_id: error.connectionId},
    });
  }
  if (error instanceof JamTokenPrefixError) {
    throw new ClientError(error.message, 'invalid-token-prefix', {status: 400});
  }
  if (error instanceof JamInvalidTokenError) {
    throw new ClientError(error.message, 'invalid-token', {status: 400});
  }
  if (error instanceof JamMissingReadScopeError) {
    throw new ClientError(error.message, 'missing-read-scope', {status: 400});
  }
  if (error instanceof JamMcpUnavailableError) {
    throw new ClientError(error.message, 'mcp-unavailable', {status: 400});
  }
  if (error instanceof JamWorkspaceMismatchError) {
    throw new ClientError(error.message, 'workspace-mismatch', {status: 409});
  }
  if (error instanceof JamConnectionNotFoundError) {
    throw new ClientError(error.message, 'not-found', {status: 404});
  }
  if (error instanceof JamInstallationNotFoundError) {
    throw new ClientError(error.message, 'not-found', {status: 404});
  }
  if (error instanceof JamCredentialVersionMismatchError) {
    throw new ClientError(error.message, 'credential-version-conflict', {status: 409});
  }
  if (error instanceof JamIntegrationProviderError) {
    throw new ClientError(error.message, error.reason, {
      details: {retry_after_seconds: error.retryAfterSeconds},
      status: providerStatus(error.reason, error.status),
    });
  }
  throw error;
}
