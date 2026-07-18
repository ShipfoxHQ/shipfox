import {atomWithStorage} from 'jotai/utils';

const storageKey = 'shipfox.lastWorkspaceId';

export const lastWorkspaceIdAtom = atomWithStorage<string | undefined>(storageKey, undefined);

export function getLastWorkspaceId(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'string' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function rememberLastWorkspaceId(workspaceId: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(storageKey, JSON.stringify(workspaceId));
}
