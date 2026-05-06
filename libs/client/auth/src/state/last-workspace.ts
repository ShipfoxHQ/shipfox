import {atomWithStorage} from 'jotai/utils';

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
  'shipfox.lastWorkspaceId',
  undefined,
);
