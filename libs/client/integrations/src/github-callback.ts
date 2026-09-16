import {ApiError} from '@shipfox/client-api';
import {
  type BrowserStorage,
  type BrowserStorageKey,
  createTypedBrowserStorage,
} from '@shipfox/client-ui';

export const GITHUB_INSTALL_WORKSPACE_KEY = 'shipfox.github-install.workspace-id';
const EXPIRED_STATE_MESSAGE = /expired/iu;

type WorkspaceStorage = BrowserStorage | undefined;

const githubInstallWorkspaceStorageKey = {
  key: GITHUB_INSTALL_WORKSPACE_KEY,
  lifetime: 'session',
  // The callback checks this one-shot navigation hint against the current
  // memberships. Signed state and the callback API remain authoritative.
  principalScope: 'global',
  serialize: (workspaceId: string) => workspaceId,
  parse: (value: string) => value || undefined,
} satisfies BrowserStorageKey<string>;

export function saveGithubInstallWorkspace(storage: WorkspaceStorage, workspaceId: string): void {
  installWorkspaceStorage(storage).write(workspaceId);
}

export function readGithubInstallWorkspace(storage: WorkspaceStorage): string | undefined {
  return installWorkspaceStorage(storage).read();
}

export function clearGithubInstallWorkspace(storage: WorkspaceStorage): void {
  installWorkspaceStorage(storage).remove();
}

function installWorkspaceStorage(storage: WorkspaceStorage) {
  return createTypedBrowserStorage(() => storage, githubInstallWorkspaceStorageKey);
}

export interface GithubCallbackParams {
  code: string;
  installationId: number;
  state: string;
  setupAction?: string;
}

export interface GithubCallbackSearch {
  code?: string;
  error?: string;
  errorDescription?: string;
  installationId?: number;
  state?: string;
  setupAction?: string;
}

export type GithubCallbackIntent =
  | {kind: 'request'}
  | {kind: 'provider-error'}
  | {kind: 'complete'; params: GithubCallbackParams}
  | {kind: 'invalid'};

export function parseGithubCallbackSearch(input: Record<string, unknown>): GithubCallbackSearch {
  const code = stringParam(input.code);
  const error = stringParam(input.error);
  const errorDescription = stringParam(input.error_description);
  const installationId = numberParam(input.installation_id);
  const state = stringParam(input.state);
  const setupAction = stringParam(input.setup_action);
  return {
    ...(code ? {code} : {}),
    ...(error ? {error} : {}),
    ...(errorDescription ? {errorDescription} : {}),
    ...(installationId === undefined ? {} : {installationId}),
    ...(state ? {state} : {}),
    ...(setupAction ? {setupAction} : {}),
  };
}

export function classifyGithubCallback(search: GithubCallbackSearch): GithubCallbackIntent {
  if (search.setupAction === 'request') return {kind: 'request'};
  if (search.error) return {kind: 'provider-error'};

  const params = githubCallbackParams(search);
  return params ? {kind: 'complete', params} : {kind: 'invalid'};
}

export function githubCallbackParams(
  search: GithubCallbackSearch,
): GithubCallbackParams | undefined {
  const {code, installationId, state} = search;
  if (!code || installationId === undefined || !state) return undefined;
  return search.setupAction
    ? {code, installationId, state, setupAction: search.setupAction}
    : {code, installationId, state};
}

export function serializeGithubCallback(params: GithubCallbackParams): string {
  const search = new URLSearchParams();
  search.set('code', params.code);
  search.set('installation_id', params.installationId.toString());
  search.set('state', params.state);
  if (params.setupAction) search.set('setup_action', params.setupAction);
  return search.toString();
}

export type GithubCallbackFailure =
  | {kind: 'expired'; retryable: false}
  | {kind: 'invalid'; retryable: false}
  | {kind: 'actor-mismatch'; retryable: false}
  | {kind: 'not-authorized'; retryable: false}
  | {kind: 'already-linked'; retryable: false}
  | {kind: 'provider-error'; retryable: true}
  | {kind: 'unknown'; retryable: true};

export function classifyGithubCallbackError(error: unknown): GithubCallbackFailure {
  if (!(error instanceof ApiError)) return {kind: 'unknown', retryable: true};
  if (error.code === 'invalid-github-install-state') {
    return EXPIRED_STATE_MESSAGE.test(error.message)
      ? {kind: 'expired', retryable: false}
      : {kind: 'invalid', retryable: false};
  }
  if (error.code === 'github-install-state-actor-mismatch') {
    return {kind: 'actor-mismatch', retryable: false};
  }
  if (error.code === 'github-installation-not-authorized') {
    return {kind: 'not-authorized', retryable: false};
  }
  if (error.code === 'github-installation-already-linked' || error.code === 'slug-conflict') {
    return {kind: 'already-linked', retryable: false};
  }
  if (
    error.code === 'rate-limited' ||
    error.code === 'timeout' ||
    error.code === 'provider-unavailable' ||
    error.code === 'network-error' ||
    error.status === 0 ||
    error.status >= 500
  ) {
    return {kind: 'provider-error', retryable: true};
  }
  return {kind: 'unknown', retryable: true};
}

function stringParam(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberParam(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  if (typeof value === 'string' && value.length > 0) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
  }
  return undefined;
}
