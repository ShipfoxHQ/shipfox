import {
  ConnectionSlugConflictError,
  type IntegrationProviderErrorReason,
} from '@shipfox/api-integration-spi';
import {workspacesInterModuleContract} from '@shipfox/api-workspaces-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {ClientError} from '@shipfox/node-fastify';
import {
  DiscordBotNotInGuildError,
  DiscordInstallStateActorMismatchError,
  DiscordInstallStateError,
  DiscordIntegrationProviderError,
  DiscordOAuthCallbackError,
} from '#core/errors.js';
import {
  DiscordConnectionAlreadyLinkedError,
  DiscordInstallationAlreadyLinkedError,
} from '#db/installations.js';

function providerStatus(reason: IntegrationProviderErrorReason): number {
  if (reason === 'rate-limited') return 429;
  if (reason === 'timeout' || reason === 'provider-unavailable') return 503;
  return 422;
}

export function discordRouteErrorHandler(error: unknown): never {
  if (
    isInterModuleKnownError(workspacesInterModuleContract.methods.requireActiveMembership, error)
  ) {
    throwDiscordWorkspaceMembershipError(error);
  }
  if (error instanceof DiscordInstallStateError) {
    throw new ClientError(error.message, 'invalid-discord-install-state', {status: 400});
  }
  if (error instanceof DiscordInstallStateActorMismatchError) {
    throw new ClientError(error.message, 'discord-install-state-actor-mismatch', {status: 403});
  }
  if (error instanceof DiscordInstallationAlreadyLinkedError) {
    throw new ClientError(
      'Discord server is already linked to another workspace',
      'discord-installation-already-linked',
      {status: 409},
    );
  }
  if (error instanceof DiscordConnectionAlreadyLinkedError) {
    throw new ClientError(error.message, 'discord-connection-already-linked', {status: 409});
  }
  if (error instanceof DiscordBotNotInGuildError) {
    throw new ClientError(error.message, 'discord-bot-not-in-guild', {status: 422});
  }
  if (error instanceof DiscordOAuthCallbackError) {
    throw new ClientError(error.message, 'discord-oauth-callback-error', {
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
  if (error instanceof DiscordIntegrationProviderError) {
    throw new ClientError(error.message, error.reason, {
      status: providerStatus(error.reason),
      details: {retry_after_seconds: error.retryAfterSeconds},
    });
  }
  throw error;
}

function throwDiscordWorkspaceMembershipError(error: {
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
