import {ApiError} from '@shipfox/client-api';

export interface NotionCallbackFailure {
  title: string;
  message: string;
  startOver: boolean;
  signIn: boolean;
}

export function classifyNotionCallbackError(error: unknown): NotionCallbackFailure {
  if (error instanceof ApiError) return classifyNotionApiError(error);
  return failure(
    'Notion install could not be completed',
    'Could not complete the Notion install. Start again from workspace settings.',
    true,
  );
}

function classifyNotionApiError(error: ApiError): NotionCallbackFailure {
  switch (error.code) {
    case 'invalid-notion-install-state':
      return failure(
        'Notion install link expired',
        'Notion install link expired. Start again from workspace settings.',
        true,
      );
    case 'notion-install-state-actor-mismatch':
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
    case 'notion-installation-already-linked':
    case 'notion-connection-already-linked':
      return failure(
        'Notion already linked',
        'This Notion workspace is already linked to another workspace.',
        false,
      );
    case 'notion-oauth-callback-error':
    case 'notion-access-denied':
    case 'access-denied':
      return failure(
        'Notion access was not granted',
        'Notion did not grant access. This can happen if the person cancelled or the workspace restricts connections.',
        true,
      );
    case 'network-error':
      return failure('Could not reach Shipfox', 'Check your connection and start again.', true);
    case 'rate-limited':
    case 'timeout':
    case 'provider-unavailable':
    case 'malformed-provider-response':
      return failure(
        'Notion is temporarily unavailable',
        'Start a new install when Notion is available.',
        true,
      );
    case 'slug-conflict':
      return failure(
        'Notion install could not be completed',
        'Could not complete the Notion install. Start again from workspace settings.',
        true,
      );
  }
  if (error.status === 0) {
    return failure('Could not reach Shipfox', 'Check your connection and start again.', true);
  }
  if (error.status >= 500 || error.status === 429) {
    return failure(
      'Notion is temporarily unavailable',
      'Start a new install when Notion is available.',
      true,
    );
  }
  return failure(
    'Notion install could not be completed',
    'Could not complete the Notion install. Start again from workspace settings.',
    true,
  );
}

function failure(title: string, message: string, startOver: boolean): NotionCallbackFailure {
  return {title, message, startOver, signIn: false};
}
