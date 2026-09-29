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

export interface GithubLinkCallbackParams {
  code: string;
  state: string;
}

export interface GithubCallbackSearch {
  code?: string;
  error?: string;
  errorDescription?: string;
  installationId?: number;
  state?: string;
  setupAction?: string;
}

export type GithubCallbackMissingParameter = 'code' | 'installation_id' | 'state';

export type GithubCallbackIntent =
  | {kind: 'request'}
  | {kind: 'provider-error'}
  | {kind: 'complete'; params: GithubCallbackParams}
  | {kind: 'link'; params: GithubLinkCallbackParams}
  | {kind: 'invalid'; missing: GithubCallbackMissingParameter[]; setupAction?: string};

export type GithubCallbackTelemetryOutcome = GithubCallbackIntent['kind'] | 'guest';

export class GithubCallbackIncompleteError extends Error {
  constructor(missing: readonly GithubCallbackMissingParameter[]) {
    const sortedMissing = [...missing].sort();
    super(`GitHub callback missing ${sortedMissing.join(', ')}`);
    this.name = 'GithubCallbackIncompleteError';
  }
}

export function getGithubCallbackTelemetry(
  search: GithubCallbackSearch,
  intent: GithubCallbackIntent,
  authenticated: boolean,
): {
  outcome: GithubCallbackTelemetryOutcome;
  missing: string;
  setup_action: 'install' | 'update' | 'request' | 'other';
  authenticated: boolean;
} {
  return {
    outcome: authenticated ? intent.kind : 'guest',
    missing: intent.kind === 'invalid' ? [...intent.missing].sort().join(',') : '',
    setup_action: normalizeGithubSetupAction(search.setupAction),
    authenticated,
  };
}

function normalizeGithubSetupAction(
  setupAction: string | undefined,
): 'install' | 'update' | 'request' | 'other' {
  if (setupAction === 'install' || setupAction === 'update' || setupAction === 'request') {
    return setupAction;
  }
  return 'other';
}

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
  if (params) return {kind: 'complete', params};
  // The server decides what the state means: the client never decodes it.
  if (search.code && search.state && search.installationId === undefined) {
    return {kind: 'link', params: {code: search.code, state: search.state}};
  }

  const missing: GithubCallbackMissingParameter[] = [];
  if (!search.code) missing.push('code');
  if (search.installationId === undefined) missing.push('installation_id');
  if (!search.state) missing.push('state');
  return {
    kind: 'invalid',
    missing,
    ...(search.setupAction ? {setupAction: search.setupAction} : {}),
  };
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

export function resolveGithubRecoveryWorkspace({
  storedWorkspaceId,
  workspaces,
}: {
  storedWorkspaceId: string | undefined;
  workspaces: readonly {id: string}[];
}): string | undefined {
  const stored = workspaces.find(({id}) => id === storedWorkspaceId);
  if (stored) return stored.id;
  return workspaces.length === 1 ? workspaces[0]?.id : undefined;
}

export function serializeGithubLinkCallback(params: GithubLinkCallbackParams): string {
  return new URLSearchParams({code: params.code, state: params.state}).toString();
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
  | {kind: 'expired'}
  | {kind: 'invalid'}
  | {kind: 'actor-mismatch'}
  | {kind: 'workspace-access-changed'}
  | {kind: 'not-authorized'}
  | {kind: 'already-linked'}
  | {kind: 'no-linkable'; accessible: number; linkedElsewhere: number}
  | {kind: 'too-many-linkable'}
  | {kind: 'suspended'}
  | {kind: 'provider-error'}
  | {kind: 'unknown'};

export function classifyGithubCallbackError(error: unknown): GithubCallbackFailure {
  if (!(error instanceof ApiError)) return {kind: 'unknown'};
  const linkFailure = classifyGithubLinkError(error);
  if (linkFailure) return linkFailure;
  if (error.code === 'invalid-github-install-state') {
    return EXPIRED_STATE_MESSAGE.test(error.message) ? {kind: 'expired'} : {kind: 'invalid'};
  }
  if (error.code === 'github-install-state-actor-mismatch') {
    return {kind: 'actor-mismatch'};
  }
  if (
    error.code === 'not-found' ||
    error.code === 'forbidden' ||
    error.code === 'workspace-inactive'
  ) {
    return {kind: 'workspace-access-changed'};
  }
  if (
    error.code === 'github-installation-not-authorized' ||
    error.code === 'access-denied' ||
    error.code === 'installation-not-found'
  ) {
    return {kind: 'not-authorized'};
  }
  if (error.code === 'github-installation-already-linked' || error.code === 'slug-conflict') {
    return {kind: 'already-linked'};
  }
  if (
    error.code === 'rate-limited' ||
    error.code === 'timeout' ||
    error.code === 'provider-unavailable' ||
    error.code === 'provider-rejected' ||
    error.code === 'malformed-provider-response' ||
    error.code === 'network-error' ||
    error.status === 0 ||
    error.status >= 500
  ) {
    return {kind: 'provider-error'};
  }
  return {kind: 'unknown'};
}

function classifyGithubLinkError(error: ApiError): GithubCallbackFailure | undefined {
  switch (error.code) {
    case 'invalid-github-link-state':
      return EXPIRED_STATE_MESSAGE.test(error.message) ? {kind: 'expired'} : {kind: 'invalid'};
    case 'github-link-state-actor-mismatch':
      return {kind: 'actor-mismatch'};
    case 'github-no-linkable-installation':
      return {kind: 'no-linkable', ...linkableCounts(error.details)};
    case 'invalid-github-link-selection':
      return EXPIRED_STATE_MESSAGE.test(error.message) ? {kind: 'expired'} : {kind: 'invalid'};
    case 'github-too-many-linkable-installations':
      return {kind: 'too-many-linkable'};
    case 'github-installation-suspended':
      return {kind: 'suspended'};
    default:
      return undefined;
  }
}

function linkableCounts(details: unknown): {accessible: number; linkedElsewhere: number} {
  // ApiError.details is the whole response body: the counts sit in its own `details`.
  const payload = isRecord(details) && isRecord(details.details) ? details.details : {};
  const {accessible, linked_elsewhere: linkedElsewhere} = payload;
  return {
    accessible: typeof accessible === 'number' ? accessible : 0,
    linkedElsewhere: typeof linkedElsewhere === 'number' ? linkedElsewhere : 0,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
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
