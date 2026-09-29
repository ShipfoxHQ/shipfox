import {REGISTRY_CATALOG_PATH, registryPackagePath} from '@shipfox/registry-format';
import {getRegistryIndex} from '#db/indexes.js';
import {
  createTestKey,
  publishCatalog,
  publishPackageIndex,
  settingsFor,
  startTestRegistry,
  type TestKey,
  type TestRegistry,
} from '#test/fixtures/registry.js';
import {RegistryDisabledError, RegistryUnavailableError} from './errors.js';
import {getCatalog, getPackageIndex} from './indexes.js';
import {purgeOtherRegistries} from './purge-other-registries.js';

const PACKAGE = 'fixture/example';
const PACKAGE_PATH = registryPackagePath(PACKAGE);

let key: TestKey;
let registries: TestRegistry[] = [];

async function newRegistry(): Promise<TestRegistry> {
  const registry = await startTestRegistry();
  registries.push(registry);
  return registry;
}

function requestsFor(registry: TestRegistry, path: string): number {
  return registry.requests.filter((requested) => requested === path).length;
}

beforeAll(async () => {
  key = await createTestKey('reg-1');
});

afterEach(async () => {
  await Promise.all(registries.map((registry) => registry.close()));
  registries = [];
});

describe('getCatalog', () => {
  it('fetches the catalog on a miss and stores its body and etag', async () => {
    const registry = await newRegistry();
    const published = publishCatalog({registry, etag: '"v1"'});
    const settings = settingsFor({registry, keys: [key]});

    const catalog = await getCatalog({settings});

    const stored = await getRegistryIndex({registry: registry.url, key: 'catalog'});
    expect(catalog).toEqual(published);
    expect(stored).toMatchObject({body: published, etag: '"v1"'});
  });

  it('serves a fresh copy without calling the registry again', async () => {
    const registry = await newRegistry();
    publishCatalog({registry, etag: '"v1"'});
    const settings = settingsFor({registry, keys: [key]});
    await getCatalog({settings});

    await getCatalog({settings});

    expect(requestsFor(registry, REGISTRY_CATALOG_PATH)).toBe(1);
  });

  it('keeps serving the last good copy while the registry is down', async () => {
    const registry = await newRegistry();
    const published = publishCatalog({registry, etag: '"v1"'});
    const settings = settingsFor({registry, keys: [key], catalogRefreshSeconds: 0});
    await getCatalog({settings});
    registry.fail(REGISTRY_CATALOG_PATH, 503);

    const first = await getCatalog({settings});
    await vi.waitFor(() => expect(requestsFor(registry, REGISTRY_CATALOG_PATH)).toBe(2));
    const second = await getCatalog({settings});

    expect(first).toEqual(published);
    expect(second).toEqual(published);
  });

  it('reports the registry unavailable when it is down before the first fetch', async () => {
    const registry = await newRegistry();
    registry.fail(REGISTRY_CATALOG_PATH, 503);
    const settings = settingsFor({registry, keys: [key]});

    const result = getCatalog({settings});

    await expect(result).rejects.toBeInstanceOf(RegistryUnavailableError);
  });

  it('refreshes a stale copy in the background and serves the new one afterwards', async () => {
    const registry = await newRegistry();
    const before = publishCatalog({registry, etag: '"v1"'});
    const settings = settingsFor({registry, keys: [key], catalogRefreshSeconds: 0});
    await getCatalog({settings});
    const after = publishCatalog({registry, etag: '"v2"', packages: [PACKAGE, 'fixture/other']});

    const stale = await getCatalog({settings});
    await vi.waitFor(async () => {
      const stored = await getRegistryIndex({registry: registry.url, key: 'catalog'});
      expect(stored?.etag).toBe('"v2"');
    });
    const refreshed = await getCatalog({settings});

    expect(stale).toEqual(before);
    expect(refreshed).toEqual(after);
  });

  it('sends the stored etag and keeps the copy when the registry answers 304', async () => {
    const registry = await newRegistry();
    const published = publishCatalog({registry, etag: '"v1"'});
    const settings = settingsFor({registry, keys: [key], catalogRefreshSeconds: 0});
    await getCatalog({settings});
    const fetchedAt = (await getRegistryIndex({registry: registry.url, key: 'catalog'}))?.fetchedAt;

    await getCatalog({settings});
    await vi.waitFor(async () => {
      const stored = await getRegistryIndex({registry: registry.url, key: 'catalog'});
      expect(stored?.fetchedAt.getTime()).toBeGreaterThan(fetchedAt?.getTime() ?? 0);
    });

    const stored = await getRegistryIndex({registry: registry.url, key: 'catalog'});
    expect(registry.requestHeaders[0]?.['if-none-match']).toBeUndefined();
    expect(registry.requestHeaders[1]?.['if-none-match']).toBe('"v1"');
    expect(stored).toMatchObject({body: published, etag: '"v1"'});
  });

  it('shares one background refresh between concurrent reads', async () => {
    const registry = await newRegistry();
    publishCatalog({registry, etag: '"v1"'});
    const settings = settingsFor({registry, keys: [key], catalogRefreshSeconds: 0});
    await getCatalog({settings});

    await Promise.all([getCatalog({settings}), getCatalog({settings}), getCatalog({settings})]);
    await vi.waitFor(() => expect(requestsFor(registry, REGISTRY_CATALOG_PATH)).toBeGreaterThan(1));

    expect(requestsFor(registry, REGISTRY_CATALOG_PATH)).toBe(2);
  });

  it('does not store a malformed body', async () => {
    const registry = await newRegistry();
    registry.put(REGISTRY_CATALOG_PATH, '{"packages": 3}', {etag: '"bad"'});
    const settings = settingsFor({registry, keys: [key]});

    const result = getCatalog({settings});

    await expect(result).rejects.toBeInstanceOf(RegistryUnavailableError);
    expect(await getRegistryIndex({registry: registry.url, key: 'catalog'})).toBeUndefined();
  });

  it('rejects any request when the registry is disabled', async () => {
    const registry = await newRegistry();
    const settings = {...settingsFor({registry, keys: [key]}), registry: ''};

    const result = getCatalog({settings});

    await expect(result).rejects.toBeInstanceOf(RegistryDisabledError);
  });

  describe('changing registries', () => {
    it('reads only the copy of the configured registry', async () => {
      const first = await newRegistry();
      const second = await newRegistry();
      const firstCatalog = publishCatalog({
        registry: first,
        etag: '"a"',
        packages: ['fixture/alpha'],
      });
      const secondCatalog = publishCatalog({
        registry: second,
        etag: '"b"',
        packages: ['fixture/bravo'],
      });

      const fromFirst = await getCatalog({settings: settingsFor({registry: first, keys: [key]})});
      const fromSecond = await getCatalog({settings: settingsFor({registry: second, keys: [key]})});

      expect(fromFirst).toEqual(firstCatalog);
      expect(fromSecond).toEqual(secondCatalog);
      expect(requestsFor(second, REGISTRY_CATALOG_PATH)).toBe(1);
    });

    it('purges the copies of other registries at startup', async () => {
      const first = await newRegistry();
      const second = await newRegistry();
      publishCatalog({registry: first, etag: '"a"'});
      publishCatalog({registry: second, etag: '"b"'});
      await getCatalog({settings: settingsFor({registry: first, keys: [key]})});
      await getCatalog({settings: settingsFor({registry: second, keys: [key]})});

      await purgeOtherRegistries({settings: settingsFor({registry: second, keys: [key]})});

      expect(await getRegistryIndex({registry: first.url, key: 'catalog'})).toBeUndefined();
      expect(await getRegistryIndex({registry: second.url, key: 'catalog'})).toBeDefined();
    });
  });
});

describe('getPackageIndex', () => {
  it('fetches the index of a package and stores it under the package name', async () => {
    const registry = await newRegistry();
    const published = publishPackageIndex({registry, etag: '"v1"'});
    const settings = settingsFor({registry, keys: [key]});

    const index = await getPackageIndex({settings, package: PACKAGE});

    const stored = await getRegistryIndex({registry: registry.url, key: PACKAGE});
    expect(index).toEqual(published);
    expect(stored).toMatchObject({body: published, etag: '"v1"'});
  });

  it('keeps the catalog and a package index apart', async () => {
    const registry = await newRegistry();
    const catalog = publishCatalog({registry, etag: '"c"'});
    const index = publishPackageIndex({registry, etag: '"p"'});
    const settings = settingsFor({registry, keys: [key]});

    const fromCatalog = await getCatalog({settings});
    const fromIndex = await getPackageIndex({settings, package: PACKAGE});

    expect(fromCatalog).toEqual(catalog);
    expect(fromIndex).toEqual(index);
  });

  it('returns undefined for a package the registry does not know', async () => {
    const registry = await newRegistry();
    const settings = settingsFor({registry, keys: [key]});

    const index = await getPackageIndex({settings, package: PACKAGE});

    expect(index).toBeUndefined();
    expect(await getRegistryIndex({registry: registry.url, key: PACKAGE})).toBeUndefined();
  });

  it('keeps serving the stored index while the registry is down', async () => {
    const registry = await newRegistry();
    const published = publishPackageIndex({registry, etag: '"v1"'});
    const settings = settingsFor({registry, keys: [key], catalogRefreshSeconds: 0});
    await getPackageIndex({settings, package: PACKAGE});
    registry.fail(PACKAGE_PATH, 500);

    const index = await getPackageIndex({settings, package: PACKAGE});

    expect(index).toEqual(published);
  });

  it('refreshes a stale index with the new versions', async () => {
    const registry = await newRegistry();
    publishPackageIndex({registry, etag: '"v1"'});
    const settings = settingsFor({registry, keys: [key], catalogRefreshSeconds: 0});
    await getPackageIndex({settings, package: PACKAGE});
    const after = publishPackageIndex({registry, etag: '"v2"', versions: ['1.0.0', '1.1.0']});

    await getPackageIndex({settings, package: PACKAGE});
    await vi.waitFor(async () => {
      const stored = await getRegistryIndex({registry: registry.url, key: PACKAGE});
      expect(stored?.etag).toBe('"v2"');
    });

    const refreshed = await getPackageIndex({settings, package: PACKAGE});
    expect(refreshed).toEqual(after);
  });

  it('forgets an index the registry no longer knows', async () => {
    const registry = await newRegistry();
    publishPackageIndex({registry, etag: '"v1"'});
    const settings = settingsFor({registry, keys: [key], catalogRefreshSeconds: 0});
    await getPackageIndex({settings, package: PACKAGE});
    registry.put(PACKAGE_PATH, 'gone');
    registry.fail(PACKAGE_PATH, 404);

    await getPackageIndex({settings, package: PACKAGE});
    await vi.waitFor(async () => {
      expect(await getRegistryIndex({registry: registry.url, key: PACKAGE})).toBeUndefined();
    });

    expect(await getPackageIndex({settings, package: PACKAGE})).toBeUndefined();
  });

  it('rejects an index served for another package', async () => {
    const registry = await newRegistry();
    const other = publishPackageIndex({registry, etag: '"o"', package: 'fixture/other'});
    registry.put(PACKAGE_PATH, JSON.stringify(other), {etag: '"o"'});
    const settings = settingsFor({registry, keys: [key]});

    const result = getPackageIndex({settings, package: PACKAGE});

    await expect(result).rejects.toBeInstanceOf(RegistryUnavailableError);
  });
});
