import {IntegrationProviderError} from '@shipfox/api-integration-core-dto';

export class SlackIntegrationProviderError extends IntegrationProviderError {}

export class SlackInstallStateError extends Error {
  constructor(message = 'Invalid Slack install state') {
    super(message);
    this.name = 'SlackInstallStateError';
  }
}

export class SlackInstallStateActorMismatchError extends Error {
  constructor() {
    super('Slack install state was created by a different user');
    this.name = 'SlackInstallStateActorMismatchError';
  }
}

export class SlackOAuthCallbackError extends Error {
  constructor(
    public readonly providerError: string,
    public readonly providerDescription: string | undefined,
  ) {
    super(providerDescription ?? `Slack OAuth callback failed: ${providerError}`);
    this.name = 'SlackOAuthCallbackError';
  }
}

export class SlackAuthorizationScopeMismatchError extends Error {
  constructor(public readonly missingScopes: string[]) {
    super(`Slack authorization is missing required scopes: ${missingScopes.join(', ')}`);
    this.name = 'SlackAuthorizationScopeMismatchError';
  }
}

export class SlackEnterpriseInstallUnsupportedError extends Error {
  constructor() {
    super('Slack Enterprise Grid installations are not supported');
    this.name = 'SlackEnterpriseInstallUnsupportedError';
  }
}

export class SlackInstallationAlreadyLinkedError extends Error {
  constructor(teamId: string) {
    super(`Slack team is already linked to another Shipfox workspace: ${teamId}`);
    this.name = 'SlackInstallationAlreadyLinkedError';
  }
}

export class SlackConnectionAlreadyLinkedError extends Error {
  constructor(connectionId: string) {
    super(`Integration connection is already linked to another Slack team: ${connectionId}`);
    this.name = 'SlackConnectionAlreadyLinkedError';
  }
}

export class SlackConnectionNotFoundError extends Error {
  constructor(connectionId: string) {
    super(`Slack integration connection was not found: ${connectionId}`);
    this.name = 'SlackConnectionNotFoundError';
  }
}

export class SlackBotTokenMissingError extends Error {
  constructor(connectionId: string) {
    super(`Slack bot token is missing for connection: ${connectionId}`);
    this.name = 'SlackBotTokenMissingError';
  }
}
