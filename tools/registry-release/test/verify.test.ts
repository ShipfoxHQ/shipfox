import {buildPackage} from '../src/build.js';
import {createRegistryClient} from '../src/registry-client.js';
import {verifyVersion} from '../src/verify.js';
import {ACTION_PATH, ActionRepository} from './fixtures/action-repository.js';
import {FakeRegistry} from './fixtures/fake-registry.js';
import {publishedActionDocument, publishedDocument} from './fixtures/registry-documents.js';
import {TEMPLATE_FILES, TemplateRepository} from './fixtures/template-repository.js';
import {buildFixture, TOOL_VERSION} from './helpers.js';

describe('verifyVersion', () => {
  let repository: TemplateRepository;
  let registry: FakeRegistry;
  const reference = {namespace: 'shipfox', name: 'fixture-template', version: '1.0.0'};

  const verify = () =>
    verifyVersion({
      reference,
      registry: createRegistryClient({url: 'https://registry.test', fetch: registry.fetch}),
      root: repository.root,
      toolVersion: TOOL_VERSION,
    });

  beforeEach(() => {
    repository = new TemplateRepository();
    registry = new FakeRegistry();
  });
  afterEach(() => repository.remove());

  async function publishAtCommit() {
    const built = await buildFixture(repository);
    const commit = repository.commit();
    registry.seed({
      ...publishedDocument(built),
      provenance: {...publishedDocument(built).provenance, commit},
    });
  }

  it('matches when the provenance commit rebuilds to the same digests', async () => {
    await publishAtCommit();
    // Later changes to the checkout do not matter: only the provenance commit is rebuilt.
    repository.write('workflow.yml', `${TEMPLATE_FILES['workflow.yml']}# later\n`);
    repository.commit();

    const result = await verify();

    expect(result).toEqual({ok: true, mismatches: []});
  });

  it('reports the digests that differ', async () => {
    await publishAtCommit();
    const document = publishedDocument(await buildFixture(repository));
    registry.seed({
      ...document,
      content: {...document.content, digest: `sha256:${'0'.repeat(64)}`},
      provenance: {...document.provenance, commit: repository.commit()},
    });

    const result = await verify();

    expect(result.ok).toBe(false);
    expect(result.mismatches).toEqual([expect.stringContaining('content: rebuilt sha256:')]);
  });

  it('fails for a version the registry does not have', async () => {
    await expect(verify()).rejects.toThrow('shipfox/fixture-template@1.0.0 is not published');
  });
});

describe('verifyVersion for an action', () => {
  let repository: ActionRepository;
  let registry: FakeRegistry;
  afterEach(() => repository.remove());

  it('rebuilds the provenance commit from its own build tree', async () => {
    repository = new ActionRepository();
    registry = new FakeRegistry();
    const built = await buildPackage({
      configured: repository.configured,
      toolVersion: TOOL_VERSION,
    });
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
