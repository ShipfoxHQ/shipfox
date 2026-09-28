import {
  REGISTRY_CATALOG_PATH,
  REGISTRY_METADATA_PATH,
  registryCatalogSchema,
  registryMetadataSchema,
  registryNamespacePath,
  registryNamespaceProfileSchema,
} from '@shipfox/registry-format';
import {BootstrapError} from '#bootstrap.js';
import {buildCatalogEntry, jsonBody} from '#indexes.js';
import {prepareRegistry} from '#startup.js';
import type {RegistryStorage} from '#storage/storage.js';
import {
  actionVersionDocument,
  BOOTSTRAP_YAML,
  createTemporaryRegistry,
} from '#test/fixtures/registry.js';
import {testSigningKey} from '#test/fixtures/signing-key.js';

async function readJson(storage: RegistryStorage, key: string): Promise<unknown> {
  const stored = await storage.get(key);
  return stored ? JSON.parse(stored.body.toString('utf8')) : undefined;
}

describe('prepareRegistry', () => {
  let registry: Awaited<ReturnType<typeof createTemporaryRegistry>>;
  const signingKey = testSigningKey();

  beforeEach(async () => {
    registry = await createTemporaryRegistry();
  });

  afterEach(async () => {
    await registry.cleanup();
  });

  const prepare = (bootstrapPath: string) =>
    prepareRegistry({
      storage: registry.storage,
      bootstrapPath,
      publicUrl: 'https://registry.example.com',
      signingKey,
    });

  it('writes the registry metadata, namespace profiles, and an empty catalog', async () => {
    const bootstrapPath = await registry.writeBootstrap();

    await prepare(bootstrapPath);

    const metadata = registryMetadataSchema.parse(
      await readJson(registry.storage, REGISTRY_METADATA_PATH),
    );
    expect(metadata).toEqual({
      publish_url: 'https://registry.example.com',
      keys: [signingKey.publicKey],
    });
    expect(Buffer.from(signingKey.publicKey.public_key, 'base64')).toHaveLength(32);
    const profile = registryNamespaceProfileSchema.parse(
      await readJson(registry.storage, registryNamespacePath('shipfox')),
    );
    expect(profile).toEqual({
      namespace: 'shipfox',
      display_name: 'Shipfox',
      url: 'https://www.shipfox.io',
      verified: true,
    });
    expect(await readJson(registry.storage, registryNamespacePath('acme'))).toMatchObject({
      display_name: 'Acme',
      verified: false,
    });
    expect(await readJson(registry.storage, REGISTRY_CATALOG_PATH)).toEqual({packages: []});
  });

  it('applies featured order and publisher profiles to the existing catalog', async () => {
    const bootstrapPath = await registry.writeBootstrap(
      BOOTSTRAP_YAML.replace('display_name: Shipfox', 'display_name: Shipfox Inc'),
    );
    const staleBootstrap = {featured: [], namespaces: {}, reserved: []};
    const featured = buildCatalogEntry({
      documents: [actionVersionDocument()],
      bootstrap: staleBootstrap,
    });
    const other = buildCatalogEntry({
      documents: [actionVersionDocument({package: 'acme/aaa-first'})],
      bootstrap: staleBootstrap,
    });
    await registry.storage.put({
      key: REGISTRY_CATALOG_PATH,
      body: jsonBody({packages: [other, featured]}),
      contentType: 'application/json',
    });

    await prepare(bootstrapPath);

    const catalog = registryCatalogSchema.parse(
      await readJson(registry.storage, REGISTRY_CATALOG_PATH),
    );
    expect(
      catalog.packages.map(({package: name, featured, publisher}) => ({
        name,
        featured,
        publisher,
      })),
    ).toEqual([
      {
        name: 'shipfox/slack-thread-digest',
        featured: 2,
        publisher: {namespace: 'shipfox', display_name: 'Shipfox Inc', verified: true},
      },
      {
        name: 'acme/aaa-first',
        featured: undefined,
        publisher: {namespace: 'acme', display_name: 'Acme', verified: false},
      },
    ]);
  });

  it.each([
    ['a missing file', undefined, 'ENOENT'],
    ['invalid YAML', 'namespaces: [unclosed', 'Invalid registry bootstrap file'],
    ['an unknown field', `${BOOTSTRAP_YAML}\nfeatures: []\n`, 'Unrecognized key'],
    ['an invalid namespace', 'namespaces: {Shipfox: {profile: {display_name: S}}}', 'namespaces'],
    [
      'a featured package in an undeclared namespace',
      'featured: [other/tool]\nnamespaces: {shipfox: {profile: {display_name: S}}}',
      'names namespace other, which is not declared',
    ],
    [
      'a publisher without numeric ids',
      BOOTSTRAP_YAML.replace('"812345678"', 'ShipfoxHQ'),
      'repository_id must be a numeric id',
    ],
  ])('refuses to start on %s, before writing anything', async (_case, text, message) => {
    const bootstrapPath =
      text === undefined
        ? `${registry.directory}/missing.yaml`
        : await registry.writeBootstrap(text);

    const startup = prepare(bootstrapPath);

    await expect(startup).rejects.toBeInstanceOf(BootstrapError);
    await expect(startup).rejects.toThrow(message);
    expect(await registry.storage.list('')).toEqual([]);
  });
});
