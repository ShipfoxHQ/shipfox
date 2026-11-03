import {createRegistryClient} from '../src/registry-client.js';
import {verifyVersion} from '../src/verify.js';
import {ACTION_PATH, ActionRepository} from './fixtures/action-repository.js';
import {FakeRegistry} from './fixtures/fake-registry.js';
import {publishedActionDocument} from './fixtures/registry-documents.js';
import {buildActionFixture, TOOL_VERSION} from './helpers.js';

describe('verifyVersion for an action', () => {
  let repository: ActionRepository | undefined;
  let registry: FakeRegistry;
  afterEach(() => repository?.remove());

  it('rebuilds the provenance commit from its own build tree', async () => {
    repository = new ActionRepository();
    registry = new FakeRegistry();
    const built = await buildActionFixture(repository);
    const published = publishedActionDocument({package: built.package, version: built.version});
    registry.seed({
      ...published,
      content: {...published.content, digest: built.content.digest},
      source: {...published.source, digest: built.source.digest},
      provenance: {...published.provenance, commit: repository.commit(), path: ACTION_PATH},
    });
    repository.write(`${ACTION_PATH}/src/main.ts`, 'export default () => ({});\n');
    repository.commit();

    const result = await verifyVersion({
      reference: {namespace: 'fixture', name: 'example', version: '1.0.0'},
      registry: createRegistryClient({url: 'https://registry.test', fetch: registry.fetch}),
      root: repository.root,
      toolVersion: TOOL_VERSION,
    });

    expect(result).toEqual({ok: true, mismatches: []});
  }, 120_000);
});
