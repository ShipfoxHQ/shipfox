import {atomWithStorage} from 'jotai/utils';

const LAST_WORKSPACE_ID_STORAGE_KEY = 'shipfox.lastWorkspaceId';

/**
 * Persists the last active workspace id in localStorage under
 * `shipfox.lastWorkspaceId`.
 *
 * `atomWithStorage` installs a `storage` event subscriber by default, so when
 * one tab switches workspace the atom updates in every other tab and the
 * workspace switcher re-renders to track. The URL in each tab remains the
 * routing truth.
 *
 * `setItem` failures (private browsing, quota) are NOT swallowed by Jotai;
 * callers that write to this atom must wrap the write in try/catch when
 * persistence is best-effort.
 */
export const lastWorkspaceIdAtom = atomWithStorage<string | undefined>(
  LAST_WORKSPACE_ID_STORAGE_KEY,
  undefined,
);

export function getLastWorkspaceId(): string | undefined {
  if (typeof window === 'undefined') return undefined;

  try {
    const raw = window.localStorage.getItem(LAST_WORKSPACE_ID_STORAGE_KEY);
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'string' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function rememberLastWorkspaceId(workspaceId: string): void {
  if (typeof window === 'undefined') return;

  window.localStorage.setItem(LAST_WORKSPACE_ID_STORAGE_KEY, JSON.stringify(workspaceId));
}
