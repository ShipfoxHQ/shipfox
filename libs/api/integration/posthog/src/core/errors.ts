import {IntegrationProviderError} from '@shipfox/api-integration-spi';

export class PosthogIntegrationProviderError extends IntegrationProviderError {}

export class PosthogMissingScopesError extends Error {
  constructor(public readonly missingScopes: readonly string[]) {
    super('The PostHog API key is missing required read scopes.');
    this.name = 'PosthogMissingScopesError';
  }
}

export class PosthogApiKeyMissingError extends Error {
  constructor(connectionId: string) {
    super(`PostHog API key is missing for connection: ${connectionId}`);
    this.name = 'PosthogApiKeyMissingError';
  }
}

export class PosthogApiKeyPrefixError extends Error {
  constructor() {
    super(
      'PostHog personal API keys must start with phx_. The public project key prefix phc_ is not supported.',
    );
    this.name = 'PosthogApiKeyPrefixError';
  }
}

export class PosthogAlreadyConnectedError extends Error {
  constructor(public readonly connectionId: string) {
    super('PostHog project is already connected');
    this.name = 'PosthogAlreadyConnectedError';
  }
}

export class PosthogNoProjectAccessError extends Error {
  constructor() {
    super('The PostHog API key cannot access any projects.');
    this.name = 'PosthogNoProjectAccessError';
  }
}

export class PosthogProjectNotAccessibleError extends Error {
  constructor(projectId: string) {
    super(`The PostHog API key cannot access project ${projectId}.`);
    this.name = 'PosthogProjectNotAccessibleError';
  }
}

export class PosthogProjectMismatchError extends Error {
  constructor(projectId: string) {
    super(`The replacement PostHog API key cannot access project ${projectId}.`);
    this.name = 'PosthogProjectMismatchError';
  }
}

export class PosthogConnectionNotFoundError extends Error {
  constructor(connectionId: string) {
    super(`PostHog connection not found: ${connectionId}`);
    this.name = 'PosthogConnectionNotFoundError';
  }
}

export class PosthogInstallationNotFoundError extends Error {
  constructor(connectionId: string) {
    super(`PostHog installation not found for connection: ${connectionId}`);
    this.name = 'PosthogInstallationNotFoundError';
  }
}

export class PosthogCredentialVersionMismatchError extends Error {
  constructor(connectionId: string) {
    super(`PostHog connection ${connectionId} was changed while the key was being replaced.`);
    this.name = 'PosthogCredentialVersionMismatchError';
  }
}
