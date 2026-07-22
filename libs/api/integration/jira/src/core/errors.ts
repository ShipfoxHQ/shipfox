import {IntegrationProviderError} from '@shipfox/api-integration-spi';

export class JiraConnectionNotFoundError extends Error {
  constructor(connectionId: string) {
    super(`Jira integration connection was not found: ${connectionId}`);
    this.name = 'JiraConnectionNotFoundError';
  }
}

export class JiraAccessTokenMissingError extends Error {
  constructor(connectionId: string) {
    super(`Jira access token is missing for connection: ${connectionId}`);
    this.name = 'JiraAccessTokenMissingError';
  }
}

export class JiraInstallationSiteMismatchError extends Error {
  constructor(connectionId: string, cloudId: string) {
    super(
      `Jira connection is already linked to a different site: ${connectionId} (attempted ${cloudId})`,
    );
    this.name = 'JiraInstallationSiteMismatchError';
  }
}

export class JiraIntegrationProviderError extends IntegrationProviderError {}

export class JiraInstallStateError extends Error {
  constructor(message = 'Invalid Jira install state') {
    super(message);
    this.name = 'JiraInstallStateError';
  }
}

export class JiraInstallStateActorMismatchError extends Error {
  constructor() {
    super('Jira install state was created by a different user');
    this.name = 'JiraInstallStateActorMismatchError';
  }
}

export class JiraOAuthCallbackError extends Error {
  constructor(
    public readonly providerError: string,
    public readonly providerDescription: string | undefined,
  ) {
    super(providerDescription ?? `Jira OAuth callback failed: ${providerError}`);
    this.name = 'JiraOAuthCallbackError';
  }
}

export class JiraAuthorizationScopeMismatchError extends Error {
  constructor(public readonly missingScopes: string[]) {
    super(`Jira authorization is missing usable site scopes: ${missingScopes.join(', ')}`);
    this.name = 'JiraAuthorizationScopeMismatchError';
  }
}

export class JiraOfflineAccessNotGrantedError extends Error {
  constructor() {
    super(
      'Jira authorization did not grant offline access; reconnect and approve the requested scopes',
    );
    this.name = 'JiraOfflineAccessNotGrantedError';
  }
}

export class JiraInstallationAlreadyLinkedError extends Error {
  constructor(cloudId: string) {
    super(`Jira site is already linked to another Shipfox workspace: ${cloudId}`);
    this.name = 'JiraInstallationAlreadyLinkedError';
  }
}

export class JiraConnectionAlreadyLinkedError extends Error {
  constructor(connectionId: string) {
    super(`Integration connection is already linked to another Jira site: ${connectionId}`);
    this.name = 'JiraConnectionAlreadyLinkedError';
  }
}

export class JiraTokenUnrefreshableError extends Error {
  constructor(public readonly connectionId: string) {
    super(`Jira token cannot be refreshed; reconnect is required: ${connectionId}`);
    this.name = 'JiraTokenUnrefreshableError';
  }
}

export class JiraSiteSelectionMismatchError extends Error {
  constructor(cloudId: string) {
    super(`Jira site was not included in the authorized site selection: ${cloudId}`);
    this.name = 'JiraSiteSelectionMismatchError';
  }
}

export class JiraPendingSelectionNotFoundError extends Error {
  constructor() {
    super('The Jira site selection expired or has already been completed; start over');
    this.name = 'JiraPendingSelectionNotFoundError';
  }
}
