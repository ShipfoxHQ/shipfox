import {closeApp, createApp, type FastifyInstance} from '@shipfox/node-fastify';
import {
  REGISTRY_CATALOG_PATH,
  REGISTRY_METADATA_PATH,
  registryBlobPath,
  registryVersionPath,
} from '@shipfox/registry-format';
import {readRoutes} from '#reads.js';
import {prepareRegistry} from '#startup.js';
import {
  actionVersionDocument,
  createTemporaryRegistry,
  digest,
  putVersionEnvelope,
} from '#test/fixtures/registry.js';
import {testSigningKey} from '#test/fixtures/signing-key.js';

describe('read routes', () => {
  let registry: Awaited<ReturnType<typeof createTemporaryRegistry>>;
  let app: FastifyInstance;

  beforeEach(async () => {
    registry = await createTemporaryRegistry();
    await prepareRegistry({
      storage: registry.storage,
      bootstrapPath: await registry.writeBootstrap(),
      publicUrl: 'https://registry.example.com',
      signingKey: testSigningKey(),
    });
    app = await createApp({routes: readRoutes(registry.storage), swagger: false});
  });

  afterEach(async () => {
    await closeApp();
    await registry.cleanup();
  });

  it('serves the catalog and the registry metadata as JSON', async () => {
    const catalog = await app.inject({method: 'GET', url: `/${REGISTRY_CATALOG_PATH}`});
    const metadata = await app.inject({method: 'GET', url: `/${REGISTRY_METADATA_PATH}`});

    expect(catalog.statusCode).toBe(200);
    expect(catalog.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(catalog.headers['cache-control']).toBe('no-cache');
    expect(catalog.json()).toEqual({packages: []});
    expect(metadata.statusCode).toBe(200);
    expect(metadata.json()).toMatchObject({publish_url: 'https://registry.example.com'});
  });

  it('serves version envelopes and blobs as immutable', async () => {
    const document = actionVersionDocument();
    await putVersionEnvelope(registry.storage, document);
    await registry.storage.put({
      key: registryBlobPath(digest('a')),
      body: Buffer.from([0x1f, 0x8b, 0x00]),
      contentType: 'application/octet-stream',
      ifNoneMatch: '*',
    });

    const envelope = await app.inject({method: 'GET', url: `/${registryVersionPath(document)}`});
    const blob = await app.inject({method: 'GET', url: `/${registryBlobPath(digest('a'))}`});

    expect(envelope.statusCode).toBe(200);
    expect(envelope.json()).toMatchObject({signatures: [{keyid: 'test-key'}]});
    expect(envelope.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(blob.statusCode).toBe(200);
    expect(blob.headers['content-type']).toBe('application/octet-stream');
    expect(blob.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(blob.rawPayload).toEqual(Buffer.from([0x1f, 0x8b, 0x00]));
  });

  it('answers a matching If-None-Match with 304', async () => {
    const first = await app.inject({method: 'GET', url: `/${REGISTRY_CATALOG_PATH}`});

    const second = await app.inject({
      method: 'GET',
      url: `/${REGISTRY_CATALOG_PATH}`,
      headers: {'if-none-match': String(first.headers.etag)},
    });

    expect(second.statusCode).toBe(304);
    expect(second.body).toBe('');
  });

  it.each([
    '/v1/packages/shipfox/missing/index.json',
    '/v1/../_registry/jti/abc',
    '/v1/%2E%2E/_registry/jti/abc',
    '/_registry/jti/abc',
    '/v1/%00',
  ])('answers %s with 404', async (url) => {
    await registry.storage.put({
      key: '_registry/jti/abc',
      body: Buffer.from('secret'),
      contentType: 'application/octet-stream',
    });

    const response = await app.inject({method: 'GET', url});

    expect(response.statusCode).toBe(404);
  });
});
