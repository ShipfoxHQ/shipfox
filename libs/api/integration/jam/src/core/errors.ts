import {IntegrationProviderError} from '@shipfox/api-integration-spi';

export class JamIntegrationProviderError extends IntegrationProviderError {}

export class JamTokenMissingError extends Error {
  constructor(connectionId: string) {
    super(`Jam token is missing for connection: ${connectionId}`);
    this.name = 'JamTokenMissingError';
  }
}

export class JamTokenPrefixError extends Error {
  constructor() {
    super('Jam personal access tokens start with jam_pat_.');
    this.name = 'JamTokenPrefixError';
  }
}

export class JamInvalidTokenError extends Error {
  constructor() {
    super('Jam rejected the token. It may be expired or revoked.');
    this.name = 'JamInvalidTokenError';
  }
}

export class JamMissingReadScopeError extends Error {
  constructor() {
    super(
      'The Jam token does not have MCP read access. Create the token under Settings, MCP in Jam.',
    );
    this.name = 'JamMissingReadScopeError';
  }
}

export class JamMcpUnavailableError extends Error {
  constructor(detail?: string) {
    super(
      detail === undefined || detail === ''
        ? 'The Jam token cannot use the Jam MCP server.'
        : `The Jam token cannot use the Jam MCP server: ${detail}`,
    );
    this.name = 'JamMcpUnavailableError';
  }
}

export class JamAlreadyConnectedError extends Error {
  constructor(public readonly connectionId: string) {
    super('Jam workspace is already connected');
    this.name = 'JamAlreadyConnectedError';
  }
}

export class JamWorkspaceMismatchError extends Error {
  constructor() {
    super('The replacement Jam token belongs to a different Jam workspace.');
    this.name = 'JamWorkspaceMismatchError';
  }
}

export class JamConnectionNotFoundError extends Error {
  constructor(connectionId: string) {
    super(`Jam connection not found: ${connectionId}`);
    this.name = 'JamConnectionNotFoundError';
  }
}

export class JamInstallationNotFoundError extends Error {
  constructor(connectionId: string) {
    super(`Jam installation not found for connection: ${connectionId}`);
    this.name = 'JamInstallationNotFoundError';
  }
}

export class JamCredentialVersionMismatchError extends Error {
  constructor(connectionId: string) {
    super(`Jam connection ${connectionId} was changed while the token was being replaced.`);
    this.name = 'JamCredentialVersionMismatchError';
  }
}
