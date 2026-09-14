import {
  ConnectionSlugConflictError,
  type IntegrationProviderErrorReason,
} from '@shipfox/api-integration-spi';
import {workspacesInterModuleContract} from '@shipfox/api-workspaces-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {ClientError} from '@shipfox/node-fastify';
import {
  ClickUpConnectionAlreadyLinkedError,
  ClickUpInstallationAlreadyLinkedError,
  ClickUpInstallStateActorMismatchError,
  ClickUpInstallStateError,
  ClickUpIntegrationProviderError,
  ClickUpOAuthCallbackError,
  ClickUpWorkspaceCountError,
} from '#core/errors.js';

function providerStatus(reason: IntegrationProviderErrorReason): number {
  if (reason === 'rate-limited') return 429;
  if (reason === 'timeout' || reason === 'provider-unavailable') return 503;
  return 422;
}

export function clickUpRouteErrorHandler(error: unknown): never {
  if (
    isInterModuleKnownError(workspacesInterModuleContract.methods.requireActiveMembership, error)
  ) {
    throwClickUpWorkspaceMembershipError(error);
  }
  if (error instanceof ClickUpInstallStateError) {
    throw new ClientError(error.message, 'invalid-clickup-install-state', {status: 400});
  }
  if (error instanceof ClickUpInstallStateActorMismatchError) {
    throw new ClientError(error.message, 'clickup-install-state-actor-mismatch', {status: 403});
  }
  if (error instanceof ClickUpWorkspaceCountError) {
    throw new ClientError(error.message, 'clickup-workspace-count', {
      status: 422,
      details: {count: error.count},
    });
  }
  if (error instanceof ClickUpInstallationAlreadyLinkedError) {
    throw new ClientError(error.message, 'clickup-installation-already-linked', {status: 409});
  }
  if (error instanceof ClickUpConnectionAlreadyLinkedError) {
    throw new ClientError(error.message, 'clickup-connection-already-linked', {status: 409});
  }
  if (error instanceof ClickUpOAuthCallbackError) {
    throw new ClientError(error.message, 'clickup-oauth-callback-error', {
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
  if (error instanceof ClickUpIntegrationProviderError) {
    throw new ClientError(error.message, error.reason, {
      status: providerStatus(error.reason),
      details: {retry_after_seconds: error.retryAfterSeconds},
    });
  }
  throw error;
}

function throwClickUpWorkspaceMembershipError(error: {
  code: 'workspace-not-found' | 'membership-required' | 'workspace-inactive';
  details: {workspaceId: string};
}): never {
  if (error.code === 'workspace-not-found') {
    throw new ClientError('Workspace not found', 'not-found', {
      status: 404,
      details: {workspace_id: error.details.workspaceId},
    });
  }
  if (error.code === 'membership-required') {
    throw new ClientError('Workspace membership required', 'forbidden', {
      status: 403,
      details: {workspace_id: error.details.workspaceId},
    });
  }
  throw new ClientError('Workspace is inactive', 'workspace-inactive', {
    status: 403,
    details: {workspace_id: error.details.workspaceId},
  });
}
