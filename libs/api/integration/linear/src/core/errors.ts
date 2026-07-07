import {IntegrationProviderError} from '@shipfox/api-integration-core-dto';

export class LinearIntegrationProviderError extends IntegrationProviderError {}

export class LinearInstallStateError extends Error {
  constructor(message = 'Invalid Linear install state') {
    super(message);
    this.name = 'LinearInstallStateError';
  }
}

export class LinearInstallStateActorMismatchError extends Error {
  constructor() {
    super('Linear install state was created by a different user');
    this.name = 'LinearInstallStateActorMismatchError';
  }
}

export class LinearInstallationAlreadyLinkedError extends Error {
  constructor(organizationId: string) {
    super(`Linear organization is already linked to another Shipfox workspace: ${organizationId}`);
    this.name = 'LinearInstallationAlreadyLinkedError';
  }
}

export class LinearConnectionAlreadyLinkedError extends Error {
  constructor(connectionId: string) {
    super(
      `Integration connection is already linked to another Linear organization: ${connectionId}`,
    );
    this.name = 'LinearConnectionAlreadyLinkedError';
  }
}

export class LinearConnectionNotFoundError extends Error {
  constructor(connectionId: string) {
    super(`Linear integration connection was not found: ${connectionId}`);
    this.name = 'LinearConnectionNotFoundError';
  }
}

export class LinearAccessTokenMissingError extends Error {
  constructor(connectionId: string) {
    super(`Linear access token is missing for connection: ${connectionId}`);
    this.name = 'LinearAccessTokenMissingError';
  }
}

export class LinearTokenUnrefreshableError extends Error {
  constructor(public readonly connectionId: string) {
    super(`Linear token cannot be refreshed; reconnect is required: ${connectionId}`);
    this.name = 'LinearTokenUnrefreshableError';
  }
}
