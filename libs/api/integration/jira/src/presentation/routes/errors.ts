import {
  ConnectionSlugConflictError,
  type IntegrationProviderErrorReason,
} from '@shipfox/api-integration-core-dto';
import {ClientError} from '@shipfox/node-fastify';
import {
  JiraAuthorizationScopeMismatchError,
  JiraConnectionAlreadyLinkedError,
  JiraInstallationAlreadyLinkedError,
  JiraInstallStateActorMismatchError,
  JiraInstallStateError,
  JiraIntegrationProviderError,
  JiraOAuthCallbackError,
  JiraOfflineAccessNotGrantedError,
  JiraPendingSelectionNotFoundError,
  JiraSiteSelectionMismatchError,
} from '#core/errors.js';

function providerStatus(reason: IntegrationProviderErrorReason): number {
  if (reason === 'rate-limited') return 429;
  if (reason === 'timeout' || reason === 'provider-unavailable') return 503;
  return 422;
}

export function jiraRouteErrorHandler(error: unknown): never {
  if (error instanceof JiraInstallStateError)
    throw new ClientError(error.message, 'invalid-jira-install-state', {status: 400});
  if (error instanceof JiraInstallStateActorMismatchError)
    throw new ClientError(error.message, 'jira-install-state-actor-mismatch', {status: 403});
  if (error instanceof JiraInstallationAlreadyLinkedError)
    throw new ClientError(error.message, 'jira-installation-already-linked', {status: 409});
  if (error instanceof JiraConnectionAlreadyLinkedError)
    throw new ClientError(error.message, 'jira-connection-already-linked', {status: 409});
  if (error instanceof JiraAuthorizationScopeMismatchError)
    throw new ClientError(error.message, 'jira-authorization-scope-mismatch', {
      status: 422,
      details: {missing_scopes: error.missingScopes},
    });
  if (error instanceof JiraOfflineAccessNotGrantedError)
    throw new ClientError(error.message, 'jira-offline-access-not-granted', {status: 422});
  if (error instanceof JiraSiteSelectionMismatchError)
    throw new ClientError(error.message, 'jira-site-selection-mismatch', {status: 422});
  if (error instanceof JiraPendingSelectionNotFoundError)
    throw new ClientError(error.message, 'jira-pending-selection-not-found', {status: 410});
  if (error instanceof JiraOAuthCallbackError)
    throw new ClientError(error.message, 'jira-oauth-callback-error', {
      status: 422,
      details: {
        error: error.providerError,
        ...(error.providerDescription ? {error_description: error.providerDescription} : {}),
      },
    });
  if (error instanceof ConnectionSlugConflictError)
    throw new ClientError(error.message, 'slug-conflict', {status: 409});
  if (error instanceof JiraIntegrationProviderError)
    throw new ClientError(error.message, error.reason, {
      status: providerStatus(error.reason),
      details: {retry_after_seconds: error.retryAfterSeconds},
    });
  throw error;
}
