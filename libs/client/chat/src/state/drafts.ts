import {
  type BrowserStorageKey,
  createTypedBrowserStorage,
  sessionStorageOrUndefined,
  type TypedBrowserStorage,
} from '@shipfox/client-ui';

type Drafts = Record<string, string>;

// Bounds what an abandoned tab leaves in session storage.
const MAX_DRAFTS = 20;

const draftsKey = {
  key: 'shipfox.chat.drafts',
  lifetime: 'session',
  principalScope: 'principal',
  serialize: (drafts: Drafts) => JSON.stringify(drafts),
  parse: (raw: string) => {
    try {
      const value: unknown = JSON.parse(raw);
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
      return Object.fromEntries(
        Object.entries(value).filter((entry): entry is [string, string] => {
          return typeof entry[1] === 'string';
        }),
      );
    } catch {
      return undefined;
    }
  },
} satisfies BrowserStorageKey<Drafts>;

/** A draft belongs to one conversation, or to the new conversation of a project. */
export function draftKey(projectId: string, conversationId: string | undefined): string {
  return `${projectId}:${conversationId ?? 'new'}`;
}

export interface DraftStore {
  read(key: string): string;
  write(key: string, text: string): void;
}

export function createDraftStore(userId: string | undefined): DraftStore {
  const storage: TypedBrowserStorage<Drafts> = createTypedBrowserStorage(
    sessionStorageOrUndefined,
    draftsKey,
    () => (userId ? {principalId: userId} : undefined),
  );
  return {
    read: (key) => storage.read()?.[key] ?? '',
    write: (key, text) => {
      const {[key]: _previous, ...rest} = storage.read() ?? {};
      const kept = Object.entries(rest).slice(-(MAX_DRAFTS - 1));
      storage.write(Object.fromEntries(text ? [...kept, [key, text]] : kept));
    },
  };
}
