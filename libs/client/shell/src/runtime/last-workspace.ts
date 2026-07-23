import {createTypedBrowserStorage, localStorageOrUndefined} from '@shipfox/client-ui';
import {atom} from 'jotai';

const lastWorkspaceStorageKey = {
  key: 'shipfox.lastWorkspaceId',
  lifetime: 'persistent',
  principalScope: 'principal',
  serialize: (workspaceId: string) => JSON.stringify(workspaceId),
  parse: (raw: string) => {
    try {
      const parsed: unknown = JSON.parse(raw);
      return typeof parsed === 'string' ? parsed : undefined;
    } catch {
      return undefined;
    }
  },
} as const;

/** The current workspace selection for consumers that need in-memory UI state. */
export const lastWorkspaceIdAtom = atom<string | undefined>(undefined);

export function getLastWorkspaceId(principalId: string): string | undefined {
  return lastWorkspaceStorage(principalId).read();
}

export function rememberLastWorkspaceId(principalId: string, workspaceId: string): void {
  lastWorkspaceStorage(principalId).write(workspaceId);
}

function lastWorkspaceStorage(principalId: string) {
  return createTypedBrowserStorage(localStorageOrUndefined, lastWorkspaceStorageKey, {
    principalId,
  });
}
