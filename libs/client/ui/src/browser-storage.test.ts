import {type BrowserStorage, createTypedBrowserStorage} from './browser-storage.js';

const key = {
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

function storage(initial: Record<string, string> = {}): BrowserStorage {
  const values = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((name) => values.get(name) ?? null),
    setItem: vi.fn((name, value) => values.set(name, value)),
    removeItem: vi.fn((name) => values.delete(name)),
  };
}

describe('createTypedBrowserStorage', () => {
  it('serializes, validates, and removes values', () => {
    const raw = storage();
    const preference = createTypedBrowserStorage(() => raw, key);

    preference.write('dark');
    const read = preference.read();
    preference.remove();

    expect(read).toBe('dark');
    expect(raw.removeItem).toHaveBeenCalledWith(key.key);
  });

  it('treats malformed persisted values as absent', () => {
    const preference = createTypedBrowserStorage(() => storage({[key.key]: '{'}), key);

    expect(preference.read()).toBeUndefined();
  });

  it('does not throw when storage is unavailable or rejects an operation', () => {
    const unavailable = createTypedBrowserStorage<string>(() => {
      throw new Error('storage unavailable');
    }, key);
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
      key,
    );

    expect(unavailable.read()).toBeUndefined();
    expect(() => rejecting.write('dark')).not.toThrow();
    expect(() => rejecting.remove()).not.toThrow();
  });
});
