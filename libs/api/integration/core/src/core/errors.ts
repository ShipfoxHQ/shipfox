import type {ManagedSeedFileProblem} from '@shipfox/api-integration-managed-vcs';
import {
  ConnectionSlugConflictError,
  type IntegrationConnectionProviderAccess,
  IntegrationProviderError,
  type IntegrationProviderErrorReason,
} from '@shipfox/api-integration-spi';
import type {IntegrationCapability, IntegrationProviderKind} from '#core/entities/provider.js';
import type {RepositoryAuthorizationDenial} from '#core/repository-authorizer.js';

export class IntegrationConnectionNotFoundError extends Error {
  constructor(connectionId: string) {
    super(`Integration connection not found: ${connectionId}`);
  }
}

export class IntegrationConnectionInactiveError extends Error {
  constructor(
    connectionId: string,
    public readonly providerAccess?: IntegrationConnectionProviderAccess | undefined,
  ) {
    super(`Integration connection is not active: ${connectionId}`);
  }
}

export class IntegrationConnectionWorkspaceMismatchError extends Error {
  constructor(connectionId: string) {
    super(`Integration connection does not belong to the requested workspace: ${connectionId}`);
  }
}

export class IntegrationConnectionProviderChangedError extends Error {
  constructor(connectionId: string) {
    super(`Integration connection provider changed: ${connectionId}`);
  }
}

export class IntegrationConnectionAlreadyExistsError extends Error {
  constructor(
    public readonly workspaceId: string,
    public readonly provider: IntegrationProviderKind,
    public readonly externalAccountId: string,
  ) {
    super(`Integration connection already exists: ${workspaceId}/${provider}/${externalAccountId}`);
    this.name = 'IntegrationConnectionAlreadyExistsError';
  }
}

export class IntegrationCapabilityUnavailableError extends Error {
  constructor(
    public readonly capability: IntegrationCapability,
    public readonly provider: IntegrationProviderKind,
  ) {
    super(`Integration provider ${provider} does not expose ${capability}`);
  }
}

export class IntegrationCheckoutUnsupportedError extends Error {
  constructor(public readonly provider: IntegrationProviderKind) {
    super(`Integration provider ${provider} does not support checkout operations`);
  }
}

export class IntegrationHistoryUnsupportedError extends Error {
  constructor(public readonly provider: IntegrationProviderKind) {
    super(`Integration provider ${provider} does not keep commit history`);
  }
}

export class IntegrationProviderUnavailableError extends Error {
  constructor(public readonly provider: IntegrationProviderKind) {
    super(`No integration provider registered for ${provider}`);
  }
}

export class RepositoryAuthorizerConfigurationError extends Error {
  constructor() {
    super('Repository authorization is enabled but the Projects client is not configured');
    this.name = 'RepositoryAuthorizerConfigurationError';
  }
}

export class IntegrationRepositoryAuthorizationError extends Error {
  constructor(public readonly reason: RepositoryAuthorizationDenial) {
    super(`Repository authorization denied: ${reason}`);
    this.name = 'IntegrationRepositoryAuthorizationError';
  }
}

export class WebhookProcessorNotConfiguredError extends Error {
  constructor(public readonly routeId: string) {
    super(`No webhook processor is configured for ${routeId}`);
    this.name = 'WebhookProcessorNotConfiguredError';
  }
}

export {ConnectionSlugConflictError, IntegrationProviderError, type IntegrationProviderErrorReason};

export class ManagedSeedFileRefusedError extends Error {
  constructor(
    public readonly problem: ManagedSeedFileProblem,
    public readonly path: string,
  ) {
    super(`The managed repository refused the seed files: ${problem}`);
    this.name = 'ManagedSeedFileRefusedError';
  }
}

export class ManagedProjectConflictError extends Error {
  constructor(public readonly projectId: string) {
    super(`Project ${projectId} already has a managed repository in another workspace`);
    this.name = 'ManagedProjectConflictError';
  }
}

export type ConfigLinkRefusalCode =
  | 'project-not-managed'
  | 'already-moved'
  | 'move-in-progress'
  | 'link-unsupported'
  | 'connection-inactive'
  | 'repository-in-use'
  | 'repository-empty'
  | 'config-exists'
  | 'pull-request-closed'
  | 'source-already-bound'
  | 'source-changed'
  | 'no-pull-request'
  | 'pull-request-not-closed';

/**
 * A definite answer to a move request. Most codes leave the managed repository free again.
 * `source-changed` does not: the move stays resumable.
 */
export class ConfigLinkRefusedError extends Error {
  constructor(
    public readonly code: ConfigLinkRefusalCode,
    message: string,
  ) {
    super(message);
    this.name = 'ConfigLinkRefusedError';
  }
}

/** The pull request may exist, so the managed repository stays read-only until a retry resolves it. */
export class ConfigLinkUnconfirmedError extends Error {
  constructor(options?: {cause?: unknown}) {
    super('We could not confirm the move. Retry to finish it.', options);
    this.name = 'ConfigLinkUnconfirmedError';
  }
}

/** Why a managed repository refused a commit, which the caller can act on. */
export type ConfigCommitRefusal =
  | 'repository-read-only'
  | 'protected-branch'
  | 'branch-invalid'
  | 'stale-head'
  | 'path-not-allowed'
  | 'content-not-text'
  | 'file-too-large'
  | 'file-not-found'
  | 'too-many-changes'
  | 'commit-too-large'
  | 'no-changes';

export class ConfigCommitRefusedError extends Error {
  constructor(
    public readonly refusal: ConfigCommitRefusal,
    public readonly details: {branch?: string; path?: string; head?: string | null},
  ) {
    super(`The config commit was refused: ${refusal}`);
    this.name = 'ConfigCommitRefusedError';
  }
}

/** The project's config lives in a linked repository, which only its own tools write to. */
export class ConfigRepositoryReadOnlyError extends Error {
  constructor(public readonly repository: string) {
    super(`The config of this project lives in ${repository}, which Shipfox does not write to`);
    this.name = 'ConfigRepositoryReadOnlyError';
  }
}
