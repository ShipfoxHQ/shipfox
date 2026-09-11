import {IntegrationProviderError} from '@shipfox/api-integration-spi';

export class ClickUpIntegrationProviderError extends IntegrationProviderError {}

export class ClickUpInstallStateError extends Error {
  constructor(message = 'Invalid ClickUp install state') {
    super(message);
    this.name = 'ClickUpInstallStateError';
  }
}

export class ClickUpInstallStateActorMismatchError extends Error {
  constructor() {
    super('ClickUp install state was created by a different user');
    this.name = 'ClickUpInstallStateActorMismatchError';
  }
}

export class ClickUpOAuthCallbackError extends Error {
  constructor(
    public readonly providerError: string,
    public readonly providerDescription: string | undefined,
  ) {
    super(providerDescription ?? `ClickUp OAuth callback failed: ${providerError}`);
    this.name = 'ClickUpOAuthCallbackError';
  }
}

export class ClickUpWorkspaceCountError extends Error {
  constructor(public readonly count: number) {
    super(`ClickUp authorization returned ${count} workspaces; authorize exactly one workspace`);
    this.name = 'ClickUpWorkspaceCountError';
  }
}

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
    super(`ClickUp workspace is already linked to a Shipfox workspace: ${teamId}`);
    this.name = 'ClickUpInstallationAlreadyLinkedError';
  }
}
