import {Buffer} from 'node:buffer';
import {registryInterModuleContract} from '@shipfox/api-registry-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {createInMemoryInterModuleTransport} from '@shipfox/node-module/inter-module';
import {
  createTestKey,
  publishCatalog,
  publishPackageIndex,
  publishVersion,
  settingsFor,
  startTestRegistry,
  type TestKey,
  type TestRegistry,
} from '#test/fixtures/registry.js';
import {createRegistryInterModulePresentation} from './inter-module.js';

const PACKAGE = 'fixture/example';
const VERSION = '1.0.0';

let key: TestKey;
let registry: TestRegistry;

function createClient(settings = settingsFor({registry, keys: [key]})) {
  const transport = createInMemoryInterModuleTransport();
  const client = transport.createClient(registryInterModuleContract);
  transport.register(createRegistryInterModulePresentation({settings}));
  transport.seal();
  return client;
}

beforeAll(async () => {
  key = await createTestKey('reg-1');
});

beforeEach(async () => {
  registry = await startTestRegistry();
});

afterEach(async () => {
  await registry.close();
});

describe('Registry inter-module presentation', () => {
  it('resolves a version with its content as base64', async () => {
    const published = await publishVersion({registry, key});
    const client = createClient();

    const resolved = await client.resolveVersion({
      package: PACKAGE,
      version: VERSION,
      kind: 'action',
    });

    expect(resolved.digest).toBe(published.document.content.digest);
    expect(resolved.document).toEqual(published.document);
    expect(Buffer.from(resolved.content, 'base64')).toEqual(Buffer.from(published.contentGzip));
  });

  it('returns the source and README of a version', async () => {
    const published = await publishVersion({registry, key, readme: '# Example\n'});
    const client = createClient();

    const source = await client.getSource({package: PACKAGE, version: VERSION});
    const readme = await client.getReadme({package: PACKAGE, version: VERSION});

    expect(Buffer.from(source.source, 'base64')).toEqual(Buffer.from(published.sourceGzip));
    expect(readme).toEqual({readme: '# Example\n'});
  });

  it('returns a null README for a version without one', async () => {
    await publishVersion({registry, key});
    const client = createClient();

    const readme = await client.getReadme({package: PACKAGE, version: VERSION});

    expect(readme).toEqual({readme: null});
  });

  it('returns the catalog and the index of a package', async () => {
    const catalog = publishCatalog({registry, etag: '"c"'});
    const index = publishPackageIndex({registry, etag: '"p"'});
    const client = createClient();

    const fromCatalog = await client.getCatalog({});
    const fromIndex = await client.getPackageIndex({package: PACKAGE});

    expect(fromCatalog).toEqual(catalog);
    expect(fromIndex).toEqual({index});
  });

  it('returns a null index for a package the registry does not know', async () => {
    const client = createClient();

    const result = await client.getPackageIndex({package: PACKAGE});

    expect(result).toEqual({index: null});
  });

  it('mints registry-unavailable for a catalog the registry cannot serve', async () => {
    const client = createClient();

    const error = await client.getCatalog({}).catch((caught: unknown) => caught);

    expect(isInterModuleKnownError(registryInterModuleContract.methods.getCatalog, error)).toBe(
      true,
    );
    expect(error).toHaveProperty('code', 'registry-unavailable');
  });

  it('mints registry-disabled for an index when the registry is disabled', async () => {
    const client = createClient({registry: '', trustedKeys: [], catalogRefreshSeconds: 900});

    const error = await client
      .getPackageIndex({package: PACKAGE})
      .catch((caught: unknown) => caught);

    expect(
      isInterModuleKnownError(registryInterModuleContract.methods.getPackageIndex, error),
    ).toBe(true);
    expect(error).toHaveProperty('code', 'registry-disabled');
  });

  it.each([
    [
      'registry-version-not-found',
      () => createClient().resolveVersion({package: PACKAGE, version: '9.9.9', kind: 'action'}),
      {package: PACKAGE, version: '9.9.9'},
    ],
    [
      'registry-disabled',
      () =>
        createClient({registry: '', trustedKeys: [], catalogRefreshSeconds: 900}).resolveVersion({
          package: PACKAGE,
          version: VERSION,
          kind: 'action',
        }),
      {},
    ],
  ])('mints the %s known error', async (code, call, details) => {
    const error = await call().catch((caught: unknown) => caught);

    expect(isInterModuleKnownError(registryInterModuleContract.methods.resolveVersion, error)).toBe(
      true,
    );
    expect(error).toHaveProperty('code', code);
    expect(error).toHaveProperty('details', details);
  });

  it('mints registry-signature-invalid for an untrusted signature', async () => {
    const otherKey = await createTestKey('reg-2');
    await publishVersion({registry, key: otherKey});
    const client = createClient();

    const error = await client
      .getSource({package: PACKAGE, version: VERSION})
      .catch((caught: unknown) => caught);

    expect(isInterModuleKnownError(registryInterModuleContract.methods.getSource, error)).toBe(
      true,
    );
    expect(error).toMatchObject({
      code: 'registry-signature-invalid',
      details: {package: PACKAGE, version: VERSION},
    });
  });

  it('mints registry-unavailable when the registry cannot be reached', async () => {
    const client = createClient();
    await registry.close();

    const error = await client
      .getReadme({package: PACKAGE, version: VERSION})
      .catch((caught: unknown) => caught);

    expect(isInterModuleKnownError(registryInterModuleContract.methods.getReadme, error)).toBe(
      true,
    );
    expect(error).toHaveProperty('code', 'registry-unavailable');
    expect(error).toHaveProperty('details', {});
  });
});
