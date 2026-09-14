import {IntegrationProviderError} from '@shipfox/api-integration-spi';

export class ClickUpConnectionNotFoundError extends Error {
  constructor(connectionId: string) {
    super(`ClickUp connection not found: ${connectionId}`);
    this.name = 'ClickUpConnectionNotFoundError';
  }
}

export class ClickUpAccessTokenMissingError extends Error {
  constructor(connectionId: string) {
    super(`ClickUp access token is missing for connection: ${connectionId}`);
    this.name = 'ClickUpAccessTokenMissingError';
  }
}

export class ClickUpConnectionAlreadyLinkedError extends Error {
  constructor(connectionId: string) {
    super(`ClickUp connection is already linked: ${connectionId}`);
    this.name = 'ClickUpConnectionAlreadyLinkedError';
  }
}

export class ClickUpInstallationAlreadyLinkedError extends Error {
  constructor(teamId: string) {
    super(`ClickUp workspace is already linked: ${teamId}`);
    this.name = 'ClickUpInstallationAlreadyLinkedError';
  }
}

export class ClickUpIntegrationProviderError extends IntegrationProviderError {}
