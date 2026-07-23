import type {SlackCallbackQueryDto} from '@shipfox/api-integration-slack-dto';
import {ApiError} from '@shipfox/client-api';
import {
  type BrowserStorage,
  type BrowserStorageKey,
  createTypedBrowserStorage,
} from '@shipfox/client-ui';

export const SLACK_INSTALL_WORKSPACE_KEY = 'shipfox.slack-install.workspace-id';
type WorkspaceStorage = BrowserStorage | undefined;

const slackInstallWorkspaceStorageKey = {
  key: SLACK_INSTALL_WORKSPACE_KEY,
  lifetime: 'session',
  principalScope: 'workspace',
  serialize: (workspaceId: string) => workspaceId,
  parse: (value: string) => value || undefined,
} satisfies BrowserStorageKey<string>;

export function saveSlackInstallWorkspace(storage: WorkspaceStorage, workspaceId: string): void {
  installWorkspaceStorage(storage).write(workspaceId);
}
export function readSlackInstallWorkspace(storage: WorkspaceStorage): string | undefined {
  return installWorkspaceStorage(storage).read();
}
export function clearSlackInstallWorkspace(storage: WorkspaceStorage): void {
  installWorkspaceStorage(storage).remove();
}

function installWorkspaceStorage(storage: WorkspaceStorage) {
  return createTypedBrowserStorage(() => storage, slackInstallWorkspaceStorageKey);
}

export function parseSlackCallbackQuery(
  search: Record<string, unknown>,
): SlackCallbackQueryDto | undefined {
  const state = stringParam(search.state);
  if (!state) return undefined;
  const code = stringParam(search.code);
  if (code) return {code, state};
  const error = stringParam(search.error);
  if (!error) return undefined;
  const errorDescription = stringParam(search.error_description);
  return errorDescription ? {error, error_description: errorDescription, state} : {error, state};
}

export function serializeSlackCallbackQuery(query: SlackCallbackQueryDto): string {
  const params = new URLSearchParams();
  if ('code' in query) params.set('code', query.code);
  else {
    params.set('error', query.error);
    if (query.error_description) params.set('error_description', query.error_description);
  }
  params.set('state', query.state);
  return params.toString();
}

export type SlackCallbackFailure = {
  title: string;
  message: string;
  startOver: boolean;
  signIn: boolean;
};
export function classifySlackCallbackError(error: unknown): SlackCallbackFailure {
  if (error instanceof ApiError) {
    if (error.code === 'invalid-slack-install-state')
      return failure(
        'Slack install link expired',
        'Slack install link expired. Start again from workspace settings.',
        true,
      );
    if (error.code === 'slack-install-state-actor-mismatch' || error.code === 'unauthorized')
      return {
        ...failure(
          'Different Shipfox account',
          'Different Shipfox account. Sign in with the account that started this install.',
          true,
        ),
        signIn: true,
      };
    if (['not-found', 'forbidden', 'workspace-inactive'].includes(error.code))
      return failure(
        'Workspace access changed',
        'You no longer have access to this workspace. Return to Shipfox to continue.',
        false,
      );
    if (
      [
        'slack-installation-already-linked',
        'slack-connection-already-linked',
        'slug-conflict',
      ].includes(error.code)
    )
      return failure(
        'Slack already linked',
        'This Slack workspace is already linked and cannot be installed again here.',
        false,
      );
    if (
      [
        'slack-authorization-scope-mismatch',
        'slack-oauth-callback-error',
        'access-denied',
      ].includes(error.code)
    )
      return failure(
        'Slack permissions needed',
        'Slack did not authorize the permissions Shipfox needs. Review the consent and start again.',
        true,
      );
    if (
      error.code === 'slack-enterprise-install-unsupported' ||
      error.code === 'slack-token-rotation-unsupported'
    )
      return failure(
        'Slack install unsupported',
        'This Slack installation is not supported. Return to Shipfox to continue.',
        false,
      );
    if (error.status === 0 || error.code === 'network-error')
      return failure('Could not reach Shipfox', 'Check your connection and start again.', true);
    if (
      error.status >= 500 ||
      error.status === 429 ||
      ['rate-limited', 'timeout', 'provider-unavailable', 'malformed-provider-response'].includes(
        error.code,
      )
    )
      return failure(
        'Slack is temporarily unavailable',
        'Start a new install when Slack is available.',
        true,
      );
  }
  return failure(
    'Slack install could not be completed',
    'Could not complete the Slack install. Start again from workspace settings.',
    true,
  );
}
function failure(title: string, message: string, startOver: boolean): SlackCallbackFailure {
  return {title, message, startOver, signIn: false};
}
function stringParam(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
