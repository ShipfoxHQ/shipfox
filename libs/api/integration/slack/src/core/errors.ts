import {IntegrationProviderError} from '@shipfox/api-integration-core-dto';

export class SlackIntegrationProviderError extends IntegrationProviderError {}

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
