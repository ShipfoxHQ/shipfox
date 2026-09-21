import {IntegrationProviderError} from '@shipfox/api-integration-spi';

export class PosthogIntegrationProviderError extends IntegrationProviderError {}

export class PosthogApiKeyMissingError extends Error {
  constructor(connectionId: string) {
    super(`PostHog API key is missing for connection: ${connectionId}`);
    this.name = 'PosthogApiKeyMissingError';
  }
}
