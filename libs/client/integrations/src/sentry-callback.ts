import {ApiError} from '@shipfox/client-api';

export const SENTRY_INSTALL_WORKSPACE_KEY = 'shipfox.sentry-install.workspace-id';

type WorkspaceStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

// Storage helpers swallow failures (quota, private mode, disabled storage):
// the handoff is an optimization, never a requirement — the callback always
// asks for explicit confirmation and only uses the stored id to pre-select.
export function saveSentryInstallWorkspace(storage: WorkspaceStorage, workspaceId: string): void {
  try {
    storage.setItem(SENTRY_INSTALL_WORKSPACE_KEY, workspaceId);
  } catch {
    // The callback falls back to its sole-workspace pre-selection.
  }
}

export function readSentryInstallWorkspace(storage: WorkspaceStorage): string | undefined {
  try {
    return storage.getItem(SENTRY_INSTALL_WORKSPACE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function clearSentryInstallWorkspace(storage: WorkspaceStorage): void {
  try {
    storage.removeItem(SENTRY_INSTALL_WORKSPACE_KEY);
  } catch {
    // A tab-scoped leftover key is harmless: it only pre-selects.
  }
}

export interface SentryCallbackParams {
  code: string;
  installationId: string;
  /** Display-only: rendered in the confirm copy, never sent to the API. */
  orgSlug?: string | undefined;
}

export function parseSentryCallbackParams(
  search: Record<string, unknown>,
): SentryCallbackParams | undefined {
  const code = stringParam(search.code);
  // Sentry documents camelCase params; accept snake_case defensively.
  const installationId = stringParam(search.installationId) ?? stringParam(search.installation_id);
  if (!code || !installationId) return undefined;

  const orgSlug = stringParam(search.orgSlug) ?? stringParam(search.org_slug);
  return {code, installationId, orgSlug};
}

export interface SentryWorkspaceOption {
  id: string;
  name: string;
}

export type SentryWorkspacePreselection =
  | {kind: 'pick'; preselectedId: string | undefined}
  | {kind: 'none'};

// Sentry's redirect carries no state token, so the callback can never prove it
// belongs to an install the user started — connecting always requires an
// explicit click. The stored id (and a sole workspace) only pre-select.
export function preselectSentryWorkspace(
  storedId: string | undefined,
  workspaces: SentryWorkspaceOption[],
): SentryWorkspacePreselection {
  if (workspaces.length === 0) return {kind: 'none'};
  if (storedId && workspaces.some((workspace) => workspace.id === storedId)) {
    return {kind: 'pick', preselectedId: storedId};
  }
  if (workspaces.length === 1) return {kind: 'pick', preselectedId: workspaces[0]?.id};
  return {kind: 'pick', preselectedId: undefined};
}

export type SentryConnectFailure =
  | {kind: 'retryable'; message: string; retryAfterSeconds?: number | undefined}
  | {kind: 'terminal'; message: string; startOver: boolean};

export function classifySentryConnectError(error: unknown): SentryConnectFailure {
  if (error instanceof ApiError) {
    if (error.code === 'sentry-installation-already-linked') {
      return {
        kind: 'terminal',
        message: 'This Sentry org is already connected to another workspace.',
        // Retrying or starting over would fail identically.
        startOver: false,
      };
    }
    if (error.code === 'rate-limited') {
      return {
        kind: 'retryable',
        message: 'Sentry is rate limiting requests. Try again in a moment.',
        retryAfterSeconds: retryAfterSeconds(error.details),
      };
    }
    if (error.code === 'timeout' || error.code === 'provider-unavailable') {
      return {kind: 'retryable', message: 'Sentry is unreachable. Try again.'};
    }
    if (error.status < 500) {
      // 4xx (access-denied, malformed-provider-response, validation): the grant
      // code is spent or rejected — only a fresh install can recover.
      return {kind: 'terminal', message: error.message, startOver: true};
    }
  }
  return {kind: 'retryable', message: 'Could not connect Sentry. Try again.'};
}

function retryAfterSeconds(details: unknown): number | undefined {
  if (typeof details !== 'object' || details === null) return undefined;
  const value = (details as Record<string, unknown>).retry_after_seconds;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringParam(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
