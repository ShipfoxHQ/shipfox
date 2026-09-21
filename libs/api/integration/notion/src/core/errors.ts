import {IntegrationProviderError} from '@shipfox/api-integration-spi';
export class NotionConnectionNotFoundError extends Error {
  constructor(connectionId: string) {
    super(`Notion connection not found: ${connectionId}`);
    this.name = 'NotionConnectionNotFoundError';
  }
}

export class NotionAccessTokenMissingError extends Error {
  constructor(connectionId: string) {
    super(`Notion access token is missing for connection: ${connectionId}`);
    this.name = 'NotionAccessTokenMissingError';
  }
}

export class NotionIntegrationProviderError extends IntegrationProviderError {
  constructor(
    reason: ConstructorParameters<typeof IntegrationProviderError>[0],
    message: string,
    retryAfterSeconds?: number | undefined,
    status?: number | undefined,
    public readonly providerErrorCode?: string | undefined,
  ) {
    super(reason, message, retryAfterSeconds, status);
  }
}

export class NotionTokenUnrefreshableError extends Error {
  constructor(public readonly connectionId: string) {
    super(`Notion token cannot be refreshed; reconnect is required: ${connectionId}`);
    this.name = 'NotionTokenUnrefreshableError';
  }
}

export class NotionConnectionAlreadyLinkedError extends Error {
  constructor(connectionId: string) {
    super(`Notion connection is already linked: ${connectionId}`);
    this.name = 'NotionConnectionAlreadyLinkedError';
  }
}

export class NotionInstallationAlreadyLinkedError extends Error {
  constructor(workspaceId: string) {
    super(`Notion workspace is already linked: ${workspaceId}`);
    this.name = 'NotionInstallationAlreadyLinkedError';
  }
}
