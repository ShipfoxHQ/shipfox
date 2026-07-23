export interface BrowserStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface BrowserStorageKey<T> {
  /** Stable browser-storage key. */
  key: string;
  /** How long this value may remain useful: session or persistent. */
  lifetime: 'session' | 'persistent';
  /** Who may reuse it: global, workspace, or authenticated principal. */
  principalScope: 'global' | 'workspace' | 'principal';
  serialize(value: T): string;
  parse(value: string): T | undefined;
}

export interface TypedBrowserStorage<T> {
  read(): T | undefined;
  write(value: T): void;
  remove(): void;
}

/**
 * Best-effort storage for non-authoritative browser preferences and recovery hints.
 * Reads validate untrusted persisted text, and every storage exception degrades to
 * an absent value so privacy mode and quota failures never interrupt user flows.
 */
export function createTypedBrowserStorage<T>(
  getStorage: () => BrowserStorage | undefined,
  definition: BrowserStorageKey<T>,
): TypedBrowserStorage<T> {
  return {
    read() {
      try {
        const raw = getStorage()?.getItem(definition.key);
        return raw === null || raw === undefined ? undefined : definition.parse(raw);
      } catch {
        return undefined;
      }
    },
    write(value) {
      try {
        getStorage()?.setItem(definition.key, definition.serialize(value));
      } catch {
        // Persistence is intentionally non-authoritative.
      }
    },
    remove() {
      try {
        getStorage()?.removeItem(definition.key);
      } catch {
        // Persistence is intentionally non-authoritative.
      }
    },
  };
}

export function localStorageOrUndefined(): BrowserStorage | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }

  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function sessionStorageOrUndefined(): BrowserStorage | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }

  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}
