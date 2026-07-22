import {createTypedBrowserStorage, localStorageOrUndefined} from '@shipfox/client-ui';
import {atom} from 'jotai';

const lastWorkspaceStorageKey = 'shipfox.lastWorkspaceId';

const lastWorkspaceStorage = createTypedBrowserStorage(localStorageOrUndefined, {
  key: lastWorkspaceStorageKey,
  lifetime: 'persistent',
  principalScope: 'principal',
  serialize: (workspaceId: string) => JSON.stringify(workspaceId),
  parse: (raw) => {
    try {
      const parsed: unknown = JSON.parse(raw);
      return typeof parsed === 'string' ? parsed : undefined;
    } catch {
      return undefined;
    }
  },
});

const storedLastWorkspaceIdAtom = atom<string | undefined>(getLastWorkspaceId());

storedLastWorkspaceIdAtom.onMount = (setLastWorkspaceId) => {
  if (typeof window === 'undefined') return undefined;

  const syncFromStorage = (event: StorageEvent) => {
    if (event.key === lastWorkspaceStorageKey) setLastWorkspaceId(getLastWorkspaceId());
  };
  window.addEventListener('storage', syncFromStorage);
  return () => window.removeEventListener('storage', syncFromStorage);
};

export const lastWorkspaceIdAtom = atom(
  (get) => get(storedLastWorkspaceIdAtom),
  (_get, set, workspaceId: string | undefined) => {
    set(storedLastWorkspaceIdAtom, workspaceId);
    if (workspaceId === undefined) lastWorkspaceStorage.remove();
    else lastWorkspaceStorage.write(workspaceId);
  },
);

export function getLastWorkspaceId(): string | undefined {
  return lastWorkspaceStorage.read();
}

export function rememberLastWorkspaceId(workspaceId: string): void {
  lastWorkspaceStorage.write(workspaceId);
}
