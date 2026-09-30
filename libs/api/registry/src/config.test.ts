import {
  createRegistrySettings,
  normalizeRegistryUrl,
  parseTrustedKeys,
  registrySettings,
} from './config.js';

// The SPKI prefix of an Ed25519 key followed by 32 zero bytes.
const PUBLIC_KEY = 'MCowBQYDK2VwAyEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

describe('normalizeRegistryUrl', () => {
  it.each([
    ['', ''],
    ['   ', ''],
    ['https://api.registry.shipfox.io', 'https://api.registry.shipfox.io'],
    ['https://api.registry.shipfox.io/', 'https://api.registry.shipfox.io'],
    ['HTTPS://API.Registry.Shipfox.io///', 'https://api.registry.shipfox.io'],
    ['https://api.registry.shipfox.io/team/', 'https://api.registry.shipfox.io/team'],
    ['http://127.0.0.1:8080?x=1#y', 'http://127.0.0.1:8080'],
    ['https://user:secret@api.registry.shipfox.io', 'https://api.registry.shipfox.io'],
  ])('normalizes %j to %j', (value, expected) => {
    const normalized = normalizeRegistryUrl(value);

    expect(normalized).toBe(expected);
  });

  it.each(['api.registry.shipfox.io', 'ftp://api.registry.shipfox.io'])('rejects %j', (value) => {
    expect(() => normalizeRegistryUrl(value)).toThrow('REGISTRY_URL');
  });
});

describe('parseTrustedKeys', () => {
  it('parses a list of keys', () => {
    const keys = parseTrustedKeys(JSON.stringify([{keyid: 'reg-2026-1', public_key: PUBLIC_KEY}]));

    expect(keys).toEqual([{keyid: 'reg-2026-1', public_key: PUBLIC_KEY}]);
  });

  it.each([
    ['is not JSON', 'nope'],
    ['is not a list', '{}'],
    ['holds a key without an id', JSON.stringify([{public_key: PUBLIC_KEY}])],
    [
      'holds a key that is not an Ed25519 public key',
      JSON.stringify([{keyid: 'a', public_key: 'AAAA'}]),
    ],
  ])('rejects a value that %s', (_name, value) => {
    expect(() => parseTrustedKeys(value)).toThrow('REGISTRY_TRUSTED_KEYS');
  });
});

describe('createRegistrySettings', () => {
  it('disables the registry with an empty URL and no keys', () => {
    const settings = createRegistrySettings({
      REGISTRY_URL: '',
      REGISTRY_TRUSTED_KEYS: '[]',
      REGISTRY_CATALOG_REFRESH_SECONDS: 900,
    });

    expect(settings).toEqual({registry: '', trustedKeys: [], catalogRefreshSeconds: 900});
  });

  it('requires a trusted key once a URL is set', () => {
    expect(() =>
      createRegistrySettings({
        REGISTRY_URL: 'https://api.registry.shipfox.io',
        REGISTRY_TRUSTED_KEYS: '[]',
        REGISTRY_CATALOG_REFRESH_SECONDS: 900,
      }),
    ).toThrow('at least one key');
  });

  it('combines the normalized URL and the parsed keys', () => {
    const settings = createRegistrySettings({
      REGISTRY_URL: 'https://api.registry.shipfox.io/',
      REGISTRY_TRUSTED_KEYS: JSON.stringify([{keyid: 'reg-2026-1', public_key: PUBLIC_KEY}]),
      REGISTRY_CATALOG_REFRESH_SECONDS: 60,
    });

    expect(settings).toEqual({
      registry: 'https://api.registry.shipfox.io',
      trustedKeys: [{keyid: 'reg-2026-1', public_key: PUBLIC_KEY}],
      catalogRefreshSeconds: 60,
    });
  });

  it.each([
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])('rejects a refresh interval of %s', (seconds) => {
    expect(() =>
      createRegistrySettings({
        REGISTRY_URL: '',
        REGISTRY_TRUSTED_KEYS: '[]',
        REGISTRY_CATALOG_REFRESH_SECONDS: seconds,
      }),
    ).toThrow('REGISTRY_CATALOG_REFRESH_SECONDS');
  });

  it('accepts a refresh interval of zero', () => {
    const settings = createRegistrySettings({
      REGISTRY_URL: '',
      REGISTRY_TRUSTED_KEYS: '[]',
      REGISTRY_CATALOG_REFRESH_SECONDS: 0,
    });

    expect(settings.catalogRefreshSeconds).toBe(0);
  });
});

describe('registrySettings', () => {
  it('trusts the central registry by default', () => {
    expect(registrySettings.registry).toBe('https://api.registry.shipfox.io');
    expect(registrySettings.trustedKeys).toEqual([
      {
        keyid: 'reg-2026-1',
        public_key: 'MCowBQYDK2VwAyEAq2fEsoh5zgdS98lzT8GChmTVE2ZunMIZ8DWCDxkYlVU=',
      },
    ]);
  });
});
