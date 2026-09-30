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

/** An argument rule that depends on what Discord says about the channel, so validation cannot catch it. */
export class DiscordToolArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiscordToolArgumentError';
  }
}

export class DiscordInstallStateError extends Error {
  constructor(message = 'Invalid Discord install state') {
    super(message);
    this.name = 'DiscordInstallStateError';
  }
}

export class DiscordInstallStateActorMismatchError extends Error {
  constructor() {
    super('Discord install state was created by a different user');
    this.name = 'DiscordInstallStateActorMismatchError';
  }
}

export class DiscordOAuthCallbackError extends Error {
  constructor(
    public readonly providerError: string,
    public readonly providerDescription: string | undefined,
  ) {
    super(providerDescription ?? `Discord OAuth callback failed: ${providerError}`);
    this.name = 'DiscordOAuthCallbackError';
  }
}

/** The bot is not a member of the guild, usually because the person lacked Manage Server. */
export class DiscordBotNotInGuildError extends Error {
  constructor() {
    super('Discord bot is not in the server');
    this.name = 'DiscordBotNotInGuildError';
  }
}
