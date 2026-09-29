import {Buffer} from 'node:buffer';
import {
  registryContentPath,
  registryReadmePath,
  registrySourcePath,
  registryVersionPath,
} from '@shipfox/registry-format';
import {getRegistryVersion} from '#db/versions.js';
import {
  blobPath,
  createTestKey,
  publishVersion,
  settingsFor,
  signPayload,
  startTestRegistry,
  type TestKey,
  type TestRegistry,
} from '#test/fixtures/registry.js';
import {
  RegistryDisabledError,
  RegistrySchemaUnsupportedError,
  RegistrySignatureInvalidError,
  RegistryUnavailableError,
  RegistryVersionNotFoundError,
} from './errors.js';
import {purgeOtherRegistries} from './purge-other-registries.js';
import {getReadme, getSource, resolveVersion} from './resolve-version.js';

const PACKAGE = 'fixture/example';
const VERSION = '1.0.0';

let key: TestKey;
let otherKey: TestKey;
let registries: TestRegistry[] = [];

async function newRegistry(): Promise<TestRegistry> {
  const registry = await startTestRegistry();
  registries.push(registry);
  return registry;
}

function versionPath(version = VERSION): string {
  return registryVersionPath({package: PACKAGE, version});
}

function storedVersion(registry: TestRegistry) {
  return getRegistryVersion({registry: registry.url, package: PACKAGE, version: VERSION});
}

beforeAll(async () => {
  [key, otherKey] = await Promise.all([createTestKey('reg-1'), createTestKey('reg-2')]);
});

afterEach(async () => {
  await Promise.all(registries.map((registry) => registry.close()));
  registries = [];
});

describe('resolveVersion', () => {
  it('fetches, verifies, and stores a version on a miss', async () => {
    const registry = await newRegistry();
    const published = await publishVersion({registry, key});
    const settings = settingsFor({registry, keys: [key]});

    const resolved = await resolveVersion({
      settings,
      package: PACKAGE,
      version: VERSION,
      kind: 'action',
    });

    const stored = await storedVersion(registry);
    expect(resolved.document).toEqual(published.document);
    expect(resolved.digest).toBe(published.document.content.digest);
    expect(Buffer.from(resolved.content)).toEqual(Buffer.from(published.contentGzip));
    expect(stored).toMatchObject({kind: 'action', digest: resolved.digest, source: null});
  });

  it('serves a stored version without fetching it again', async () => {
    const registry = await newRegistry();
    await publishVersion({registry, key});
    const settings = settingsFor({registry, keys: [key]});
    await resolveVersion({settings, package: PACKAGE, version: VERSION, kind: 'action'});
    const requestsAfterMiss = registry.requests.length;

    const resolved = await resolveVersion({
      settings,
      package: PACKAGE,
      version: VERSION,
      kind: 'action',
    });

    expect(resolved.package).toBe(PACKAGE);
    expect(registry.requests).toHaveLength(requestsAfterMiss);
  });

  it('keeps serving a stored version while the registry is down', async () => {
    const registry = await newRegistry();
    await publishVersion({registry, key});
    const settings = settingsFor({registry, keys: [key]});
    await resolveVersion({settings, package: PACKAGE, version: VERSION, kind: 'action'});
    await registry.close();

    const resolved = await resolveVersion({
      settings,
      package: PACKAGE,
      version: VERSION,
      kind: 'action',
    });

    expect(resolved.version).toBe(VERSION);
  });

  it('rejects a version that is not published', async () => {
    const registry = await newRegistry();
    const settings = settingsFor({registry, keys: [key]});

    const result = resolveVersion({settings, package: PACKAGE, version: '9.9.9', kind: 'action'});

    await expect(result).rejects.toBeInstanceOf(RegistryVersionNotFoundError);
    await expect(result).rejects.toMatchObject({package: PACKAGE, version: '9.9.9'});
  });

  it.each([
    ['answers with a server error', 503],
    ['answers with a forbidden status', 403],
  ])('reports the registry unavailable when it %s', async (_name, status) => {
    const registry = await newRegistry();
    registry.fail(versionPath(), status);
    const settings = settingsFor({registry, keys: [key]});

    const result = resolveVersion({settings, package: PACKAGE, version: VERSION, kind: 'action'});

    await expect(result).rejects.toBeInstanceOf(RegistryUnavailableError);
  });

  it('fetches the content through the content route and follows its redirect', async () => {
    const registry = await newRegistry();
    const published = await publishVersion({registry, key});
    const settings = settingsFor({registry, keys: [key]});

    const result = await resolveVersion({
      settings,
      package: PACKAGE,
      version: VERSION,
      kind: 'action',
    });

    expect(Buffer.from(result.content)).toEqual(Buffer.from(published.contentGzip));
    expect(registry.requests).toEqual([
      versionPath(),
      registryContentPath({package: PACKAGE, version: VERSION}),
      blobPath(published.document.content.digest),
    ]);
  });

  it('reports the registry unavailable when it cannot be reached', async () => {
    const registry = await newRegistry();
    const settings = settingsFor({registry, keys: [key]});
    await registry.close();

    const result = resolveVersion({settings, package: PACKAGE, version: VERSION, kind: 'action'});

    await expect(result).rejects.toBeInstanceOf(RegistryUnavailableError);
  });

  it('reports the registry unavailable when a signed blob is missing', async () => {
    const registry = await newRegistry();
    const published = await publishVersion({registry, key});
    registry.fail(blobPath(published.document.content.digest), 404);
    const settings = settingsFor({registry, keys: [key]});

    const result = resolveVersion({settings, package: PACKAGE, version: VERSION, kind: 'action'});

    await expect(result).rejects.toBeInstanceOf(RegistryUnavailableError);
  });

  it('rejects any request when the registry is disabled', async () => {
    const registry = await newRegistry();
    await publishVersion({registry, key});

    const result = resolveVersion({
      settings: {registry: '', trustedKeys: [key.trusted], catalogRefreshSeconds: 900},
      package: PACKAGE,
      version: VERSION,
      kind: 'action',
    });

    await expect(result).rejects.toBeInstanceOf(RegistryDisabledError);
    expect(registry.requests).toEqual([]);
  });

  describe('verification', () => {
    it('rejects an envelope signed by a key the instance does not trust', async () => {
      const registry = await newRegistry();
      await publishVersion({registry, key: otherKey});
      const settings = settingsFor({registry, keys: [key]});

      const result = resolveVersion({settings, package: PACKAGE, version: VERSION, kind: 'action'});

      await expect(result).rejects.toBeInstanceOf(RegistrySignatureInvalidError);
      await expect(result).rejects.toMatchObject({reason: 'signature-invalid'});
      expect(await storedVersion(registry)).toBeUndefined();
    });

    it('rejects an envelope whose payload was changed after signing', async () => {
      const registry = await newRegistry();
      const published = await publishVersion({registry, key});
      const payload = {...published.document, license: 'GPL-3.0'};
      const tampered = {...published.envelope, payload: btoa(JSON.stringify(payload))};
      registry.put(versionPath(), JSON.stringify(tampered));
      const settings = settingsFor({registry, keys: [key]});

      const result = resolveVersion({settings, package: PACKAGE, version: VERSION, kind: 'action'});

      await expect(result).rejects.toMatchObject({reason: 'signature-invalid'});
      expect(await storedVersion(registry)).toBeUndefined();
    });

    it('rejects a body that is not an envelope', async () => {
      const registry = await newRegistry();
      registry.put(versionPath(), 'not json');
      const settings = settingsFor({registry, keys: [key]});

      const result = resolveVersion({settings, package: PACKAGE, version: VERSION, kind: 'action'});

      await expect(result).rejects.toMatchObject({reason: 'malformed'});
    });

    it("rejects another version's envelope served in its place", async () => {
      const registry = await newRegistry();
      await publishVersion({registry, key, version: VERSION});
      const newer = await publishVersion({registry, key, version: '1.0.1'});
      registry.put(versionPath(), JSON.stringify(newer.envelope));
      const settings = settingsFor({registry, keys: [key]});

      const result = resolveVersion({settings, package: PACKAGE, version: VERSION, kind: 'action'});

      await expect(result).rejects.toBeInstanceOf(RegistrySignatureInvalidError);
      await expect(result).rejects.toMatchObject({reason: 'payload-mismatch'});
      expect(await storedVersion(registry)).toBeUndefined();
    });

    it("rejects another package's envelope served in its place", async () => {
      const registry = await newRegistry();
      await publishVersion({registry, key});
      const other = await publishVersion({registry, key, package: 'fixture/other'});
      registry.put(versionPath(), JSON.stringify(other.envelope));
      const settings = settingsFor({registry, keys: [key]});

      const result = resolveVersion({settings, package: PACKAGE, version: VERSION, kind: 'action'});

      await expect(result).rejects.toMatchObject({reason: 'payload-mismatch'});
    });

    it('rejects a version of another kind than requested', async () => {
      const registry = await newRegistry();
      await publishVersion({registry, key, kind: 'template'});
      const settings = settingsFor({registry, keys: [key]});

      const result = resolveVersion({settings, package: PACKAGE, version: VERSION, kind: 'action'});

      await expect(result).rejects.toMatchObject({reason: 'payload-mismatch'});
    });

    it('rejects a document with an unsupported schema major', async () => {
      const registry = await newRegistry();
      const published = await publishVersion({registry, key});
      const envelope = await signPayload({
        key,
        payload: {...published.document, schema: 'shipfox.registry/version@2'},
      });
      registry.put(versionPath(), JSON.stringify(envelope));
      const settings = settingsFor({registry, keys: [key]});

      const result = resolveVersion({settings, package: PACKAGE, version: VERSION, kind: 'action'});

      await expect(result).rejects.toBeInstanceOf(RegistrySchemaUnsupportedError);
    });

    it('rejects content that does not match the signed digest', async () => {
      const registry = await newRegistry();
      const published = await publishVersion({registry, key});
      registry.put(blobPath(published.document.content.digest), published.sourceGzip);
      const settings = settingsFor({registry, keys: [key]});

      const result = resolveVersion({settings, package: PACKAGE, version: VERSION, kind: 'action'});

      await expect(result).rejects.toMatchObject({reason: 'digest-mismatch'});
      expect(await storedVersion(registry)).toBeUndefined();
    });
  });

  describe('trusted keys', () => {
    it('drops a stored version once its key is no longer trusted', async () => {
      const registry = await newRegistry();
      await publishVersion({registry, key});
      await resolveVersion({
        settings: settingsFor({registry, keys: [key]}),
        package: PACKAGE,
        version: VERSION,
        kind: 'action',
      });

      const result = resolveVersion({
        settings: settingsFor({registry, keys: [otherKey]}),
        package: PACKAGE,
        version: VERSION,
        kind: 'action',
      });

      await expect(result).rejects.toBeInstanceOf(RegistrySignatureInvalidError);
      expect(await storedVersion(registry)).toBeUndefined();
    });

    it('fetches the envelope again when a stored version needs a new key', async () => {
      const registry = await newRegistry();
      await publishVersion({registry, key});
      await resolveVersion({
        settings: settingsFor({registry, keys: [key]}),
        package: PACKAGE,
        version: VERSION,
        kind: 'action',
      });
      await publishVersion({registry, key: otherKey});

      const resolved = await resolveVersion({
        settings: settingsFor({registry, keys: [otherKey]}),
        package: PACKAGE,
        version: VERSION,
        kind: 'action',
      });

      const envelopeRequests = registry.requests.filter((path) => path === versionPath());
      expect(resolved.envelope.signatures[0]?.keyid).toBe('reg-2');
      expect(envelopeRequests).toHaveLength(2);
    });
  });

  describe('changing registries', () => {
    it('reads only the rows of the configured registry', async () => {
      const first = await newRegistry();
      const second = await newRegistry();
      await publishVersion({registry: first, key, variant: 'first'});
      const fromSecond = await publishVersion({registry: second, key, variant: 'second'});
      await resolveVersion({
        settings: settingsFor({registry: first, keys: [key]}),
        package: PACKAGE,
        version: VERSION,
        kind: 'action',
      });

      const resolved = await resolveVersion({
        settings: settingsFor({registry: second, keys: [key]}),
        package: PACKAGE,
        version: VERSION,
        kind: 'action',
      });

      expect(resolved.digest).toBe(fromSecond.document.content.digest);
      expect(await storedVersion(first)).toBeDefined();
      expect(await storedVersion(second)).toBeDefined();
    });

    it('purges the rows of other registries at startup', async () => {
      const first = await newRegistry();
      const second = await newRegistry();
      await publishVersion({registry: first, key, variant: 'first'});
      await publishVersion({registry: second, key, variant: 'second'});
      const settingsOfFirst = settingsFor({registry: first, keys: [key]});
      const settingsOfSecond = settingsFor({registry: second, keys: [key]});
      const params = {package: PACKAGE, version: VERSION, kind: 'action'} as const;
      await resolveVersion({settings: settingsOfFirst, ...params});
      await resolveVersion({settings: settingsOfSecond, ...params});

      await purgeOtherRegistries({settings: settingsOfSecond});

      expect(await storedVersion(first)).toBeUndefined();
      expect(await storedVersion(second)).toBeDefined();
    });

    it('purges every row when the registry is disabled', async () => {
      const registry = await newRegistry();
      await publishVersion({registry, key});
      await resolveVersion({
        settings: settingsFor({registry, keys: [key]}),
        package: PACKAGE,
        version: VERSION,
        kind: 'action',
      });

      await purgeOtherRegistries({
        settings: {registry: '', trustedKeys: [], catalogRefreshSeconds: 900},
      });

      expect(await storedVersion(registry)).toBeUndefined();
    });
  });
});

describe('getSource', () => {
  it('fetches the source once and serves it from the stored version', async () => {
    const registry = await newRegistry();
    const published = await publishVersion({registry, key, kind: 'template'});
    const settings = settingsFor({registry, keys: [key]});
    const sourcePath = registrySourcePath({package: PACKAGE, version: VERSION});

    const first = await getSource({settings, package: PACKAGE, version: VERSION});
    const second = await getSource({settings, package: PACKAGE, version: VERSION});

    expect(Buffer.from(first)).toEqual(Buffer.from(published.sourceGzip));
    expect(Buffer.from(second)).toEqual(Buffer.from(published.sourceGzip));
    expect(registry.requests.filter((path) => path === sourcePath)).toHaveLength(1);
    expect((await storedVersion(registry))?.source).not.toBeNull();
  });

  it('rejects a source that does not match the signed digest', async () => {
    const registry = await newRegistry();
    const published = await publishVersion({registry, key});
    registry.put(blobPath(published.document.source.digest), published.contentGzip);
    const settings = settingsFor({registry, keys: [key]});

    const result = getSource({settings, package: PACKAGE, version: VERSION});

    await expect(result).rejects.toMatchObject({reason: 'digest-mismatch'});
    expect((await storedVersion(registry))?.source).toBeNull();
  });
});

describe('getReadme', () => {
  it('returns nothing for a version without a README', async () => {
    const registry = await newRegistry();
    await publishVersion({registry, key});
    const settings = settingsFor({registry, keys: [key]});

    const readme = await getReadme({settings, package: PACKAGE, version: VERSION});

    expect(readme).toBeUndefined();
  });

  it('fetches the README once and serves it from the stored version', async () => {
    const registry = await newRegistry();
    await publishVersion({registry, key, readme: '# Example\n'});
    const settings = settingsFor({registry, keys: [key]});
    const readmePath = registryReadmePath({package: PACKAGE, version: VERSION});

    const first = await getReadme({settings, package: PACKAGE, version: VERSION});
    const second = await getReadme({settings, package: PACKAGE, version: VERSION});

    expect(first).toBe('# Example\n');
    expect(second).toBe('# Example\n');
    expect(registry.requests.filter((path) => path === readmePath)).toHaveLength(1);
  });

  it('rejects a README that does not match the signed digest', async () => {
    const registry = await newRegistry();
    await publishVersion({registry, key, readme: '# Example\n'});
    registry.put(registryReadmePath({package: PACKAGE, version: VERSION}), '# Tampered\n');
    const settings = settingsFor({registry, keys: [key]});

    const result = getReadme({settings, package: PACKAGE, version: VERSION});

    await expect(result).rejects.toMatchObject({reason: 'digest-mismatch'});
    expect((await storedVersion(registry))?.readme).toBeNull();
  });
});
