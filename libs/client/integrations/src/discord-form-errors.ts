import {ApiError} from '@shipfox/client-api';

export interface DiscordCallbackFailure {
  title: string;
  message: string;
  startOver: boolean;
  signIn: boolean;
}

export function classifyDiscordCallbackError(error: unknown): DiscordCallbackFailure {
  if (error instanceof ApiError) return classifyDiscordApiError(error);
  return failure(
    'Discord install could not be completed',
    'Could not complete the Discord install. Start again from workspace settings.',
    true,
  );
}

function classifyDiscordApiError(error: ApiError): DiscordCallbackFailure {
  switch (error.code) {
    case 'invalid-discord-install-state':
      return failure(
        'Discord install link expired',
        'Discord install link expired. Start again from workspace settings.',
        true,
      );
    case 'discord-install-state-actor-mismatch':
    case 'unauthorized':
      return {
        ...failure(
          'Different Shipfox account',
          'Different Shipfox account. Sign in with the account that started this install.',
          true,
        ),
        signIn: true,
      };
    case 'not-found':
    case 'forbidden':
    case 'workspace-inactive':
      return failure(
        'Workspace access changed',
        'You no longer have access to this workspace. Return to Shipfox to continue.',
        false,
      );
    case 'discord-installation-already-linked':
    case 'discord-connection-already-linked':
      return failure(
        'Discord server already linked',
        'This Discord server is already linked to another workspace.',
        false,
      );
    case 'discord-bot-not-in-guild':
      return failure(
        'Discord bot was not installed',
        'Shipfox could not find its bot in this server. Check that you have Manage Server permission and approve the install again.',
        true,
      );
    case 'discord-oauth-callback-error':
    case 'discord-access-denied':
    case 'access-denied':
      return failure(
        'Discord access was not granted',
        'Discord did not grant access. This can happen if the person cancelled or the server install was not approved.',
        true,
      );
    case 'network-error':
      return failure('Could not reach Shipfox', 'Check your connection and start again.', true);
    case 'rate-limited':
    case 'timeout':
    case 'provider-unavailable':
    case 'malformed-provider-response':
      return failure(
        'Discord is temporarily unavailable',
        'Start a new install when Discord is available.',
        true,
      );
    case 'slug-conflict':
      return failure(
        'Discord install could not be completed',
        'Could not complete the Discord install. Start again from workspace settings.',
        true,
      );
  }
  if (error.status === 0) {
    return failure('Could not reach Shipfox', 'Check your connection and start again.', true);
  }
  if (error.status >= 500 || error.status === 429) {
    return failure(
      'Discord is temporarily unavailable',
      'Start a new install when Discord is available.',
      true,
    );
  }
  return failure(
    'Discord install could not be completed',
    'Could not complete the Discord install. Start again from workspace settings.',
    true,
  );
}

function failure(title: string, message: string, startOver: boolean): DiscordCallbackFailure {
  return {title, message, startOver, signIn: false};
}
