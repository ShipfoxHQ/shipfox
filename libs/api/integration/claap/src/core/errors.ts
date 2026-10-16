import {IntegrationProviderError} from '@shipfox/api-integration-spi';

export class ClaapIntegrationProviderError extends IntegrationProviderError {}

export class ClaapApiKeyMissingError extends Error {
  constructor(connectionId: string) {
    super(`Claap API key is missing for connection: ${connectionId}`);
    this.name = 'ClaapApiKeyMissingError';
  }
}

export class ClaapApiKeyPrefixError extends Error {
  constructor() {
    super('Claap API keys must start with cla_.');
    this.name = 'ClaapApiKeyPrefixError';
  }
}

export class ClaapInvalidApiKeyError extends Error {
  constructor() {
    super('Claap did not accept the API key.');
    this.name = 'ClaapInvalidApiKeyError';
  }
}

export class ClaapUnexpectedWorkspaceCountError extends Error {
  constructor(public readonly count: number) {
    super(`The Claap API key must belong to exactly one workspace, but Claap returned ${count}.`);
    this.name = 'ClaapUnexpectedWorkspaceCountError';
  }
}

export class ClaapAlreadyConnectedError extends Error {
  constructor(public readonly connectionId: string) {
    super('Claap workspace is already connected');
    this.name = 'ClaapAlreadyConnectedError';
  }
}

export class ClaapWorkspaceMismatchError extends Error {
  constructor(workspaceName: string) {
    super(`The replacement Claap API key belongs to another workspace than ${workspaceName}.`);
    this.name = 'ClaapWorkspaceMismatchError';
  }
}

export class ClaapConnectionNotFoundError extends Error {
  constructor(connectionId: string) {
    super(`Claap connection not found: ${connectionId}`);
    this.name = 'ClaapConnectionNotFoundError';
  }
}

export class ClaapInstallationNotFoundError extends Error {
  constructor(connectionId: string) {
    super(`Claap installation not found for connection: ${connectionId}`);
    this.name = 'ClaapInstallationNotFoundError';
  }
}

export class ClaapCredentialVersionMismatchError extends Error {
  constructor(connectionId: string) {
    super(`Claap connection ${connectionId} was changed while the key was being replaced.`);
    this.name = 'ClaapCredentialVersionMismatchError';
  }
}
