import {closeApp} from '@shipfox/node-fastify';
import type {
  RegistryCatalog,
  RegistryEnvelope,
  RegistryMetadata,
  RegistryNamespaceProfile,
  RegistryPackageIndex,
} from '@shipfox/registry-format';
import {eq} from 'drizzle-orm';
import {db} from '#db/db.js';
import {packages} from '#db/schema/packages.js';
import {FileRegistryStorage} from '#storage/file.js';
import {
  ACTION_DRAFT,
  actionFiles,
  bundleOf,
  sourceArchive,
  TEMPLATE_DRAFT,
  templateFiles,
} from '#test/fixtures/packages.js';
import {
  documentOf,
  envelopeOf,
  type PublishApp,
  startPublishApp,
} from '#test/fixtures/publisher.js';
import {
  BOOTSTRAP_YAML,
  createTemporaryRegistry,
  resetRegistryDatabase,
} from '#test/fixtures/registry.js';
import {testSigningKey} from '#test/fixtures/signing-key.js';

const ACTION = 'shipfox/slack-thread-digest';
const README = '# Slack thread digest\n\nSummarizes a thread.\n';
const IMMUTABLE = 'public, max-age=31536000, immutable';
const DOWNLOAD_HOST = 'content.registry.example.com';
const ETAG_PATTERN = /^"[\w-]+"$/;

class PresigningStorage extends FileRegistryStorage {
  readonly presigned: {key: string; expiresInSeconds: number}[] = [];

  override presignGet(params: {key: string; expiresInSeconds: number}): Promise<string> {
    this.presigned.push(params);
    return Promise.resolve(
      `https://${DOWNLOAD_HOST}/${params.key}?X-Amz-Expires=${params.expiresInSeconds}`,
    );
  }
}

describe('registry read routes', () => {
  const signingKey = testSigningKey();
  let registry: Awaited<ReturnType<typeof createTemporaryRegistry>>;
  let storage: PresigningStorage;
  let api: PublishApp;

  async function start({presign = false, downloadTtlSeconds = 300} = {}) {
    storage = new PresigningStorage(`${registry.directory}/storage`);
    api = await startPublishApp({
      signingKey,
      storage: presign ? storage : registry.storage,
      bootstrapPath: await registry.writeBootstrap(BOOTSTRAP_YAML),
      downloadTtlSeconds,
    });
  }

  async function publishAction({version = '1.0.0', readme}: {version?: string; readme?: string}) {
    const input = version === '1.0.0' ? {} : {limit: {type: 'number'}};
    const response = await api.publish({
      version,
      draft: ACTION_DRAFT,
      content: await bundleOf(
        actionFiles({inputs: {channel: {type: 'string', required: true}, ...input}}),
      ),
      source: await sourceArchive({'package.json': `{"version": "${version}"}`}),
      ...(readme === undefined ? {} : {readme}),
    });
    expect(response.statusCode).toBe(201);
    return envelopeOf(response);
  }

  beforeEach(async () => {
    registry = await createTemporaryRegistry();
    await resetRegistryDatabase();
    await start();
  });

  afterEach(async () => {
    await closeApp();
    await registry.cleanup();
  });

  describe('GET /.well-known/shipfox-registry.json', () => {
    it('lists the public key and the publish URL', async () => {
      const response = await api.get('/.well-known/shipfox-registry.json');

      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('public, max-age=300');
      expect(response.json<RegistryMetadata>()).toEqual({
        publish_url: 'https://registry.example.com',
        keys: [signingKey.publicKey],
      });
    });
  });

  describe('GET /v1/packages', () => {
    beforeEach(async () => {
      await publishAction({});
      const template = await api.publish({
        name: 'ticket-to-pr',
        draft: TEMPLATE_DRAFT,
        content: await bundleOf(templateFiles({title: 'Task to pull request'})),
      });
      expect(template.statusCode).toBe(201);
      const other = await api.publish({
        name: 'unlisted-digest',
        draft: TEMPLATE_DRAFT,
        content: await bundleOf(templateFiles({title: 'Unlisted digest'})),
      });
      expect(other.statusCode).toBe(201);
    });

    it('lists entries with the featured ones first, in the operator order', async () => {
      const response = await api.get('/v1/packages');

      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('public, max-age=60');
      const catalog = response.json<RegistryCatalog>();
      expect(catalog.packages.map(({package: name, featured}) => [name, featured])).toEqual([
        ['shipfox/ticket-to-pr', 1],
        [ACTION, 2],
        ['shipfox/unlisted-digest', undefined],
      ]);
      expect(catalog.next_cursor).toBeUndefined();
      expect(catalog.packages[1]).toMatchObject({
        kind: 'action',
        title: 'Slack thread digest',
        summary: 'Summarizes a Slack thread.',
        latest: '1.0.0',
        publisher: {namespace: 'shipfox', display_name: 'Shipfox', verified: true},
      });
    });

    it('filters by kind', async () => {
      const response = await api.get('/v1/packages?kind=action');

      expect(response.json<RegistryCatalog>().packages.map((entry) => entry.package)).toEqual([
        ACTION,
      ]);
    });

    it('searches names, titles, and summaries without case', async () => {
      const response = await api.get('/v1/packages?q=UNLISTED');

      expect(response.json<RegistryCatalog>().packages.map((entry) => entry.package)).toEqual([
        'shipfox/unlisted-digest',
      ]);
    });

    it('treats search wildcards as text', async () => {
      const response = await api.get('/v1/packages?q=%25');

      expect(response.json<RegistryCatalog>().packages).toEqual([]);
    });

    it('answers a matching If-None-Match with 304', async () => {
      const first = await api.get('/v1/packages');
      const etag = String(first.headers.etag);

      const second = await api.get('/v1/packages', {'if-none-match': etag});

      expect(etag).toMatch(ETAG_PATTERN);
      expect(second.statusCode).toBe(304);
      expect(second.body).toBe('');
      expect(second.headers.etag).toBe(etag);
    });

    it('refuses a cursor it did not issue', async () => {
      const response = await api.get('/v1/packages?cursor=not-a-cursor');

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({code: 'invalid-cursor'});
    });

    it('leaves out a package that is not public', async () => {
      await db().update(packages).set({visibility: 'private'}).where(eq(packages.name, ACTION));

      const response = await api.get('/v1/packages');

      expect(response.json<RegistryCatalog>().packages.map((entry) => entry.package)).not.toContain(
        ACTION,
      );
    });
  });

  describe('GET /v1/namespaces/:namespace', () => {
    it('returns the profile', async () => {
      const response = await api.get('/v1/namespaces/shipfox');

      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('public, max-age=300');
      expect(response.json<RegistryNamespaceProfile>()).toEqual({
        namespace: 'shipfox',
        display_name: 'Shipfox',
        url: 'https://www.shipfox.io',
        verified: true,
      });
    });

    it('keeps a suspended namespace readable', async () => {
      const response = await api.get('/v1/namespaces/acme');

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({namespace: 'acme', display_name: 'Acme', verified: false});
    });

    it.each(['nobody', 'Not_A_Slug'])('answers 404 for %s', async (namespace) => {
      const response = await api.get(`/v1/namespaces/${namespace}`);

      expect(response.statusCode).toBe(404);
    });
  });

  describe('GET /v1/packages/:namespace/:name', () => {
    it('lists every version, lowest first, with its content digest', async () => {
      const first = await publishAction({});
      const second = await publishAction({version: '1.1.0'});

      const response = await api.get(`/v1/packages/${ACTION}`);

      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('public, max-age=60');
      expect(response.headers.etag).toBeDefined();
      expect(response.json<RegistryPackageIndex>()).toEqual({
        package: ACTION,
        kind: 'action',
        versions: [
          {
            version: '1.0.0',
            digest:
              documentOf(first).content && (documentOf(first).content as {digest: string}).digest,
            published_at: documentOf(first).published_at,
            capability_change: false,
          },
          {
            version: '1.1.0',
            digest: (documentOf(second).content as {digest: string}).digest,
            published_at: documentOf(second).published_at,
            bump: 'minor',
            capability_change: false,
          },
        ],
      });
    });

    it('answers 404 for an unknown package', async () => {
      const response = await api.get('/v1/packages/shipfox/missing');

      expect(response.statusCode).toBe(404);
    });
  });

  describe('a published version', () => {
    let envelope: RegistryEnvelope;

    beforeEach(async () => {
      envelope = await publishAction({readme: README});
    });

    it('serves the stored envelope as immutable', async () => {
      const response = await api.get(`/v1/packages/${ACTION}/versions/1.0.0`);

      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe(IMMUTABLE);
      expect(response.json()).toEqual(envelope);
    });

    it('serves the README as immutable Markdown', async () => {
      const response = await api.get(`/v1/packages/${ACTION}/versions/1.0.0/readme`);

      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe(IMMUTABLE);
      expect(response.headers['content-type']).toBe('text/markdown; charset=utf-8');
      expect(response.body).toBe(README);
    });

    it('answers 404 for a version without a README', async () => {
      await publishAction({version: '1.1.0'});

      const response = await api.get(`/v1/packages/${ACTION}/versions/1.1.0/readme`);

      expect(response.statusCode).toBe(404);
    });

    it.each([
      '',
      '/readme',
      '/content',
      '/source',
    ])('answers 404 for an unknown version on %s', async (route) => {
      const response = await api.get(`/v1/packages/${ACTION}/versions/9.9.9${route}`);

      expect(response.statusCode).toBe(404);
    });

    it.each([
      '',
      '/readme',
      '/content',
      '/source',
    ])('answers 404 for an unknown package on %s', async (route) => {
      const response = await api.get(`/v1/packages/shipfox/missing/versions/1.0.0${route}`);

      expect(response.statusCode).toBe(404);
    });

    it.each([
      '',
      '/content',
    ])('answers 404 for a version that is not exact on %s', async (route) => {
      const response = await api.get(`/v1/packages/${ACTION}/versions/1${route}`);

      expect(response.statusCode).toBe(404);
    });

    it.each([
      '',
      '/readme',
      '/content',
      '/source',
    ])('answers 404 for a package that is not public on %s', async (route) => {
      await db().update(packages).set({visibility: 'private'}).where(eq(packages.name, ACTION));

      const response = await api.get(`/v1/packages/${ACTION}/versions/1.0.0${route}`);

      expect(response.statusCode).toBe(404);
    });

    describe('with a store that cannot presign', () => {
      it.each([
        ['content', 'content'],
        ['source', 'source'],
      ])('streams the %s bytes after the access check', async (route, part) => {
        const response = await api.get(`/v1/packages/${ACTION}/versions/1.0.0/${route}`);

        const {digest} = documentOf(envelope)[part] as {digest: string};
        const stored = await registry.storage.get(`blobs/sha256/${digest.slice('sha256:'.length)}`);
        expect(response.statusCode).toBe(200);
        expect(response.headers['cache-control']).toBe('no-store');
        expect(response.headers['content-type']).toBe('application/gzip');
        expect(response.headers['content-disposition']).toBe('attachment');
        expect(response.rawPayload.equals(stored?.body ?? Buffer.alloc(0))).toBe(true);
      });
    });

    describe('with a store that presigns', () => {
      beforeEach(async () => {
        await closeApp();
        await start({presign: true, downloadTtlSeconds: 120});
      });

      it.each([
        ['content', 'content'],
        ['source', 'source'],
      ])('redirects %s to the presigned URL without caching', async (route, part) => {
        const response = await api.get(`/v1/packages/${ACTION}/versions/1.0.0/${route}`);

        const {digest} = documentOf(envelope)[part] as {digest: string};
        const key = `blobs/sha256/${digest.slice('sha256:'.length)}`;
        expect(response.statusCode).toBe(307);
        expect(response.headers['cache-control']).toBe('no-store');
        expect(response.headers.location).toBe(`https://${DOWNLOAD_HOST}/${key}?X-Amz-Expires=120`);
        expect(storage.presigned).toEqual([{key, expiresInSeconds: 120}]);
      });
    });
  });

  it('has no route that serves a blob by digest', async () => {
    const envelope = await publishAction({});
    const {digest} = documentOf(envelope).content as {digest: string};

    const response = await api.get(`/blobs/sha256/${digest.slice('sha256:'.length)}`);

    expect(response.statusCode).toBe(404);
  });
});
