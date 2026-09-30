import {IntegrationProviderError} from '@shipfox/api-integration-spi';

export class DiscordIntegrationProviderError extends IntegrationProviderError {
  public readonly discordCode?: number | undefined;

  constructor(params: {
    reason: ConstructorParameters<typeof IntegrationProviderError>[0];
    message: string;
    status?: number | undefined;
    retryAfterSeconds?: number | undefined;
    discordCode?: number | undefined;
  }) {
    super(params.reason, params.message, params.retryAfterSeconds, params.status);
    this.discordCode = params.discordCode;
  }
}
