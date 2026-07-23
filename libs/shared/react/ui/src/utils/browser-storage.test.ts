import {type BrowserStorage, createTypedBrowserStorage} from './browser-storage.js';

const globalKey = {
  key: 'shipfox.test.preference',
  lifetime: 'persistent' as const,
  principalScope: 'global' as const,
  serialize: (value: string) => JSON.stringify(value),
  parse: (value: string) => {
    try {
      const parsed: unknown = JSON.parse(value);
      return typeof parsed === 'string' ? parsed : undefined;
    } catch {
      return undefined;
    }
  },
};

const privateKey = {
  key: 'shipfox.test.private',
  lifetime: 'persistent' as const,
  principalScope: 'principal' as const,
  serialize: (value: string) => JSON.stringify(value),
  parse: (value: string) => {
    try {
      const parsed: unknown = JSON.parse(value);
      return typeof parsed === 'string' ? parsed : undefined;
    } catch {
      return undefined;
    }
  },
};

const workspaceKey = {
  key: 'shipfox.test.workspace',
  lifetime: 'session' as const,
  principalScope: 'workspace' as const,
  serialize: (value: string) => value,
  parse: (value: string) => value || undefined,
};

function storage(initial: Record<string, string> = {}): BrowserStorage {
  const values = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((name) => values.get(name) ?? null),
    setItem: vi.fn((name, value) => values.set(name, value)),
    removeItem: vi.fn((name) => values.delete(name)),
  };
}

describe('createTypedBrowserStorage', () => {
  it('serializes, validates, and removes global values', () => {
    const raw = storage();
    const preference = createTypedBrowserStorage(() => raw, globalKey);

    preference.write('dark');
    const read = preference.read();
    preference.remove();

    expect(read).toBe('dark');
    expect(raw.removeItem).toHaveBeenCalledWith(globalKey.key);
  });

  it('isolates principal-scoped values by derived storage key', () => {
    const raw = storage();
    const principalA = createTypedBrowserStorage(() => raw, privateKey, {
      principalId: 'principal-a',
    });
    const principalB = createTypedBrowserStorage(() => raw, privateKey, {
      principalId: 'principal-b',
    });

    principalA.write('private A');

    expect(principalA.read()).toBe('private A');
    expect(principalB.read()).toBeUndefined();
    expect(raw.getItem).toHaveBeenCalledWith('shipfox.test.private.principal.principal-b');
  });

  it('isolates workspace-scoped values and ignores an invalid scope', () => {
    const raw = storage();
    const workspaceA = createTypedBrowserStorage(() => raw, workspaceKey, {
      workspaceId: 'workspace-a',
    });
    const workspaceB = createTypedBrowserStorage(() => raw, workspaceKey, {
      workspaceId: 'workspace-b',
    });
    const invalidWorkspace = createTypedBrowserStorage(() => raw, workspaceKey, {
      workspaceId: 'workspace/a',
    });

    workspaceA.write('workspace A');

    expect(workspaceA.read()).toBe('workspace A');
    expect(workspaceB.read()).toBeUndefined();
    expect(invalidWorkspace.read()).toBeUndefined();
    expect(raw.setItem).toHaveBeenCalledWith(
      'shipfox.test.workspace.workspace.workspace-a',
      'workspace A',
    );
  });

  it('supports a scope provider without reusing a previous principal', () => {
    const raw = storage();
    let principalId: string | undefined = 'principal-a';
    const privateStorage = createTypedBrowserStorage(
      () => raw,
      privateKey,
      () => (principalId ? {principalId} : undefined),
    );

    privateStorage.write('private A');
    principalId = 'principal-b';

    expect(privateStorage.read()).toBeUndefined();
  });

  it('treats malformed persisted values as absent', () => {
    const preference = createTypedBrowserStorage(
      () => storage({'shipfox.test.preference': '{'}),
      globalKey,
    );

    expect(preference.read()).toBeUndefined();
  });

  it('does not throw when storage is unavailable or rejects an operation', () => {
    const unavailable = createTypedBrowserStorage<string>(() => {
      throw new Error('storage unavailable');
    }, globalKey);
    const rejecting = createTypedBrowserStorage(
      () => ({
        getItem: () => {
          throw new Error('blocked');
        },
        setItem: () => {
          throw new Error('blocked');
        },
        removeItem: () => {
          throw new Error('blocked');
        },
      }),
      globalKey,
    );

    expect(unavailable.read()).toBeUndefined();
    expect(() => rejecting.write('dark')).not.toThrow();
    expect(() => rejecting.remove()).not.toThrow();
  });
});
