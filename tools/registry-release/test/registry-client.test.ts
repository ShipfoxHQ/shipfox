import {createRegistryClient, RegistryRequestError} from '../src/registry-client.js';
import {FakeRegistry} from './fixtures/fake-registry.js';
import {publishedDocument} from './fixtures/registry-documents.js';
import {TemplateRepository} from './fixtures/template-repository.js';
import {buildFixture} from './helpers.js';

describe('createRegistryClient', () => {
  it('reads a version document from the signed envelope', async () => {
    const repository = new TemplateRepository();
    try {
      const registry = new FakeRegistry();
      const built = await buildFixture(repository);
      registry.seed(publishedDocument(built));
      const client = createRegistryClient({url: 'https://registry.test/', fetch: registry.fetch});

      const document = await client.getVersionDocument({package: built.package, version: '1.0.0'});

      expect(document?.fingerprint).toBe(built.fingerprint);
      expect(registry.requests[0]?.path).toBe(
        '/v1/packages/shipfox/fixture-template/versions/1.0.0',
      );
    } finally {
      repository.remove();
    }
  });

  it('reads a missing package and version as undefined', async () => {
    const client = createRegistryClient({
      url: 'https://registry.test',
      fetch: new FakeRegistry().fetch,
    });

    await expect(client.getPackageIndex({package: 'shipfox/none'})).resolves.toBeUndefined();
    await expect(
      client.getVersionDocument({package: 'shipfox/none', version: '1.0.0'}),
    ).resolves.toBeUndefined();
  });

  it('throws with the status and body on a server error', async () => {
    const fetch: typeof globalThis.fetch = async () => new Response('database down', {status: 503});
    const client = createRegistryClient({url: 'https://registry.test', fetch});

    const error = await client
      .getPackageIndex({package: 'shipfox/x'})
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RegistryRequestError);
    expect(error).toMatchObject({
      status: 503,
      message: 'GET https://registry.test/v1/packages/shipfox/x returned 503: database down',
    });
  });
});
