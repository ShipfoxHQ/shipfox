import {createRegistrySettings, normalizeRegistryUrl, parseTrustedKeys} from './config.js';

// The SPKI prefix of an Ed25519 key followed by 32 zero bytes.
const PUBLIC_KEY = 'MCowBQYDK2VwAyEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

describe('normalizeRegistryUrl', () => {
  it.each([
    ['', ''],
    ['   ', ''],
    ['https://registry.shipfox.io', 'https://registry.shipfox.io'],
    ['https://registry.shipfox.io/', 'https://registry.shipfox.io'],
    ['HTTPS://Registry.Shipfox.io///', 'https://registry.shipfox.io'],
    ['https://registry.shipfox.io/team/', 'https://registry.shipfox.io/team'],
    ['http://127.0.0.1:8080?x=1#y', 'http://127.0.0.1:8080'],
    ['https://user:secret@registry.shipfox.io', 'https://registry.shipfox.io'],
  ])('normalizes %j to %j', (value, expected) => {
    const normalized = normalizeRegistryUrl(value);

    expect(normalized).toBe(expected);
  });

  it.each(['registry.shipfox.io', 'ftp://registry.shipfox.io'])('rejects %j', (value) => {
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
  it('disables the registry without a URL, whatever the keys are', () => {
    const settings = createRegistrySettings({REGISTRY_URL: '', REGISTRY_TRUSTED_KEYS: '[]'});

    expect(settings).toEqual({registry: '', trustedKeys: []});
  });

  it('requires a trusted key once a URL is set', () => {
    expect(() =>
      createRegistrySettings({
        REGISTRY_URL: 'https://registry.shipfox.io',
        REGISTRY_TRUSTED_KEYS: '[]',
      }),
    ).toThrow('at least one key');
  });

  it('combines the normalized URL and the parsed keys', () => {
    const settings = createRegistrySettings({
      REGISTRY_URL: 'https://registry.shipfox.io/',
      REGISTRY_TRUSTED_KEYS: JSON.stringify([{keyid: 'reg-2026-1', public_key: PUBLIC_KEY}]),
    });

    expect(settings).toEqual({
      registry: 'https://registry.shipfox.io',
      trustedKeys: [{keyid: 'reg-2026-1', public_key: PUBLIC_KEY}],
    });
  });
});
