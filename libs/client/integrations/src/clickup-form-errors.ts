import {ApiError} from '@shipfox/client-api';

export interface ClickUpCallbackFailure {
  title: string;
  message: string;
  startOver: boolean;
  signIn: boolean;
}

export function classifyClickUpCallbackError(error: unknown): ClickUpCallbackFailure {
  if (error instanceof ApiError) return classifyClickUpApiError(error);
  return failure(
    'ClickUp install could not be completed',
    'Could not complete the ClickUp install. Start again from workspace settings.',
    true,
  );
}

function classifyClickUpApiError(error: ApiError): ClickUpCallbackFailure {
  switch (error.code) {
    case 'invalid-clickup-install-state':
      return failure(
        'ClickUp install link expired',
        'ClickUp install link expired. Start again from workspace settings.',
        true,
      );
    case 'clickup-install-state-actor-mismatch':
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
    case 'clickup-installation-already-linked':
    case 'clickup-connection-already-linked':
      return failure(
        'ClickUp already linked',
        'This ClickUp workspace is already linked to another workspace.',
        false,
      );
    case 'clickup-workspace-count':
      return failure(
        'One ClickUp workspace required',
        'Authorize exactly one ClickUp workspace, then start the install again.',
        true,
      );
    case 'clickup-oauth-callback-error':
    case 'access-denied':
      return failure(
        'ClickUp permissions needed',
        'ClickUp did not authorize the install. Review the consent and start again.',
        true,
      );
    case 'network-error':
      return failure('Could not reach Shipfox', 'Check your connection and start again.', true);
    case 'rate-limited':
    case 'timeout':
    case 'provider-unavailable':
    case 'malformed-provider-response':
      return failure(
        'ClickUp is temporarily unavailable',
        'Start a new install when ClickUp is available.',
        true,
      );
    case 'slug-conflict':
      return failure(
        'ClickUp install could not be completed',
        'Could not complete the ClickUp install. Start again from workspace settings.',
        true,
      );
  }
  if (error.status === 0) {
    return failure('Could not reach Shipfox', 'Check your connection and start again.', true);
  }
  if (error.status >= 500 || error.status === 429) {
    return failure(
      'ClickUp is temporarily unavailable',
      'Start a new install when ClickUp is available.',
      true,
    );
  }
  return failure(
    'ClickUp install could not be completed',
    'Could not complete the ClickUp install. Start again from workspace settings.',
    true,
  );
}

function failure(title: string, message: string, startOver: boolean): ClickUpCallbackFailure {
  return {title, message, startOver, signIn: false};
}
