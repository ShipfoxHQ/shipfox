import {
  REGISTRY_CATALOG_PATH,
  registryCatalogSchema,
  registryPackageIndexPath,
  registryPackageIndexSchema,
} from '@shipfox/registry-format';
import {parseBootstrap} from '#bootstrap.js';
import {reindexRegistry} from '#reindex.js';
import type {RegistryStorage} from '#storage/storage.js';
import {
  actionVersionDocument,
  BOOTSTRAP_YAML,
  createTemporaryRegistry,
  digest,
  putVersionEnvelope,
} from '#test/fixtures/registry.js';

async function readJson(storage: RegistryStorage, key: string): Promise<unknown> {
  const stored = await storage.get(key);
  return stored ? JSON.parse(stored.body.toString('utf8')) : undefined;
}

describe('reindexRegistry', () => {
  let registry: Awaited<ReturnType<typeof createTemporaryRegistry>>;
  const bootstrap = parseBootstrap({path: 'bootstrap.yaml', text: BOOTSTRAP_YAML});

  beforeEach(async () => {
    registry = await createTemporaryRegistry();
  });

  afterEach(async () => {
    await registry.cleanup();
  });

  it('rebuilds package indexes and the catalog from version envelopes', async () => {
    await putVersionEnvelope(registry.storage, actionVersionDocument());
    await putVersionEnvelope(
      registry.storage,
      actionVersionDocument({
        version: '1.10.0',
        published_at: '2026-10-03T09:00:00Z',
        content: {digest: digest('c'), bytes: 100, format: 'action-bundle@1'},
        bump: 'minor',
        manifest: {name: 'Slack digest', description: 'Digests threads.'},
        derived: {
          ...actionVersionDocument().derived,
          capabilities: {
            slack: {provider: 'slack', selectors: ['conversations.replies'], allow_write: true},
          },
        },
      }),
    );
    await putVersionEnvelope(
      registry.storage,
      actionVersionDocument({
        version: '1.2.0',
        published_at: '2026-10-02T09:00:00Z',
        bump: 'minor',
      }),
    );

    const result = await reindexRegistry({storage: registry.storage, bootstrap});

    expect(result).toEqual({packages: 1, versions: 3, skipped: []});
    const index = registryPackageIndexSchema.parse(
      await readJson(registry.storage, registryPackageIndexPath('shipfox/slack-thread-digest')),
    );
    expect(index.versions).toEqual([
      {
        version: '1.0.0',
        digest: digest('a'),
        published_at: '2026-10-01T09:00:00Z',
        capability_change: false,
      },
      {
        version: '1.2.0',
        digest: digest('a'),
        published_at: '2026-10-02T09:00:00Z',
        bump: 'minor',
        capability_change: false,
      },
      {
        version: '1.10.0',
        digest: digest('c'),
        published_at: '2026-10-03T09:00:00Z',
        bump: 'minor',
        capability_change: true,
      },
    ]);
    const catalog = registryCatalogSchema.parse(
      await readJson(registry.storage, REGISTRY_CATALOG_PATH),
    );
    expect(catalog.packages).toEqual([
      {
        package: 'shipfox/slack-thread-digest',
        kind: 'action',
        title: 'Slack digest',
        summary: 'Digests threads.',
        keywords: [],
        integrations: ['slack'],
        latest: '1.10.0',
        published_at: '2026-10-03T09:00:00Z',
        first_published_at: '2026-10-01T09:00:00Z',
        featured: 2,
        publisher: {namespace: 'shipfox', display_name: 'Shipfox', verified: true},
      },
    ]);
  });

  it('repairs a corrupted catalog', async () => {
    await putVersionEnvelope(registry.storage, actionVersionDocument());
    await registry.storage.put({
      key: REGISTRY_CATALOG_PATH,
      body: Buffer.from('{"packages": ['),
      contentType: 'application/json',
    });

    await reindexRegistry({storage: registry.storage, bootstrap});

    const catalog = registryCatalogSchema.parse(
      await readJson(registry.storage, REGISTRY_CATALOG_PATH),
    );
    expect(catalog.packages.map((entry) => entry.package)).toEqual(['shipfox/slack-thread-digest']);
  });

  it('skips a version whose payload names another package', async () => {
    const document = actionVersionDocument({package: 'shipfox/other-action'});
    await putVersionEnvelope(registry.storage, document);
    const stored = await registry.storage.get(
      'v1/packages/shipfox/other-action/versions/1.0.0.json',
    );
    await registry.storage.put({
      key: 'v1/packages/shipfox/slack-thread-digest/versions/1.0.0.json',
      body: stored?.body ?? Buffer.from(''),
      contentType: 'application/json',
    });

    const result = await reindexRegistry({storage: registry.storage, bootstrap});

    expect(result.packages).toBe(1);
    expect(result.skipped).toEqual([
      {
        key: 'v1/packages/shipfox/slack-thread-digest/versions/1.0.0.json',
        reason: 'payload names shipfox/other-action@1.0.0',
      },
    ]);
  });
});
