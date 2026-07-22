import {createTypedBrowserStorage, localStorageOrUndefined} from '@shipfox/client-ui';
import {atom} from 'jotai';

const lastWorkspaceStorage = createTypedBrowserStorage(localStorageOrUndefined, {
  key: 'shipfox.lastWorkspaceId',
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
