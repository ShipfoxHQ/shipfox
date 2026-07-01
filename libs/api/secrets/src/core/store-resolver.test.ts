import {describe, expect, it} from '@shipfox/vitest/vi';
import {UnknownSecretStoreError} from './errors.js';
import {
  BUILTIN_LOCAL_STORE,
  createSecretStoreResolver,
  type SecretStoreProvider,
} from './store-resolver.js';

describe('secret store resolver', () => {
  it('resolves the local provider and rejects unknown stores', () => {
    const provider: SecretStoreProvider = {
      getSecret: async () => null,
      getSecretsByNamespace: async () => ({}),
    };
    const resolveSecretStore = createSecretStoreResolver(provider);

    expect(resolveSecretStore(BUILTIN_LOCAL_STORE)).toBe(provider);
    expect(() => resolveSecretStore('remote')).toThrow(UnknownSecretStoreError);
  });
});
