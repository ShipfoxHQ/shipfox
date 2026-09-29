import {
  ConnectionSlugConflictError,
  type IntegrationProviderErrorReason,
} from '@shipfox/api-integration-spi';
import {workspacesInterModuleContract} from '@shipfox/api-workspaces-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {ClientError} from '@shipfox/node-fastify';
import {
  GithubInstallationAlreadyLinkedError,
  GithubInstallationNotAuthorizedError,
  GithubInstallStateActorMismatchError,
  GithubInstallStateError,
  GithubIntegrationProviderError,
  GithubLinkStateActorMismatchError,
  GithubLinkStateError,
  GithubMultipleLinkableInstallationsError,
  GithubNoLinkableInstallationError,
} from '#core/errors.js';

export function githubRouteErrorCode(error: unknown): string | undefined {
  try {
    githubRouteErrorHandler(error);
  } catch (translated) {
    if (translated instanceof ClientError) return translated.code;
  }
  return undefined;
}

function providerStatus(reason: IntegrationProviderErrorReason): number {
  if (reason === 'rate-limited') return 429;
  if (reason === 'timeout' || reason === 'provider-unavailable') return 503;
  return 422;
}

export function githubRouteErrorHandler(error: unknown): never {
  if (
    isInterModuleKnownError(workspacesInterModuleContract.methods.requireActiveMembership, error)
  ) {
    throwGithubWorkspaceMembershipError(error);
  }
  if (error instanceof GithubLinkStateError) {
    throw new ClientError(error.message, 'invalid-github-link-state', {status: 400});
  }
  if (error instanceof GithubLinkStateActorMismatchError) {
    throw new ClientError(error.message, 'github-link-state-actor-mismatch', {status: 403});
  }
  if (error instanceof GithubNoLinkableInstallationError) {
    throw new ClientError(error.message, 'github-no-linkable-installation', {
      status: 409,
      details: {accessible: error.accessible, linked_elsewhere: error.linkedElsewhere},
    });
  }
  if (error instanceof GithubMultipleLinkableInstallationsError) {
    throw new ClientError(error.message, 'github-multiple-linkable-installations', {
      status: 409,
      details: {count: error.count},
    });
  }
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

function throwGithubWorkspaceMembershipError(error: {
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
