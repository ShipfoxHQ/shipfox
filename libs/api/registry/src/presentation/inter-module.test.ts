import {Buffer} from 'node:buffer';
import {registryInterModuleContract} from '@shipfox/api-registry-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {createInMemoryInterModuleTransport} from '@shipfox/node-module/inter-module';
import {
  createTestKey,
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

  it.each([
    [
      'registry-version-not-found',
      () => createClient().resolveVersion({package: PACKAGE, version: '9.9.9', kind: 'action'}),
      {package: PACKAGE, version: '9.9.9'},
    ],
    [
      'registry-disabled',
      () =>
        createClient({registry: '', trustedKeys: []}).resolveVersion({
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
    expect(error).toMatchObject({code, details});
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
    expect(error).toMatchObject({code: 'registry-unavailable', details: {}});
  });
});
