import type {BuiltPackage} from '../src/build.js';
import {publishPackages, ReleaseCheckFailedError} from '../src/publish.js';
import {createRegistryClient} from '../src/registry-client.js';
import {FakeRegistry} from './fixtures/fake-registry.js';
import {publishedDocument} from './fixtures/registry-documents.js';
import {TEMPLATE_FILES, TemplateRepository} from './fixtures/template-repository.js';
import {buildFixture} from './helpers.js';

describe('publishPackages', () => {
  let repository: TemplateRepository;
  let registry: FakeRegistry;
  let template: BuiltPackage;
  const oidc = vi.fn(async () => 'github-oidc-token');
  const log = vi.fn();

  const publish = (packages: BuiltPackage[]) =>
    publishPackages({
      packages,
      registry: createRegistryClient({url: 'https://registry.test', fetch: registry.fetch}),
      requestOidcToken: oidc,
      log,
    });

  beforeEach(async () => {
    vi.clearAllMocks();
    repository = new TemplateRepository();
    registry = new FakeRegistry();
    template = await buildFixture(repository);
  });
  afterEach(() => repository.remove());

  it('exchanges the OIDC token, then uploads the new version', async () => {
    const published = await publish([template]);

    expect(published.map(({package: name}) => name)).toEqual(['shipfox/fixture-template']);
    expect(registry.requests.map(({method, path}) => `${method} ${path}`)).toContain(
      'POST /v1/publish/token',
    );
    const exchange = registry.requests.find(({path}) => path === '/v1/publish/token');
    expect(JSON.parse(exchange?.body as string)).toEqual({oidc_token: 'github-oidc-token'});
    const upload = registry.requests.find(({method}) => method === 'PUT');
    expect(upload).toMatchObject({
      path: '/v1/packages/shipfox/fixture-template/versions/1.0.0',
      headers: {authorization: 'Bearer publish-token'},
    });
  });

  it('sends the draft, both blobs, and the README', async () => {
    await publish([template]);

    const [upload] = registry.publishes;
    expect(Object.keys(upload?.parts ?? {}).sort()).toEqual([
      'content',
      'draft',
      'readme',
      'source',
    ]);
    expect(JSON.parse(upload?.parts.draft ?? '')).toEqual({
      kind: 'template',
      license: 'MIT',
      builder: template.builder,
      composition: 1,
      path: template.path,
    });
    expect(upload?.parts.readme).toBe('Overview of the fixture template.\n');
  });

  it('sends the dependencies of an action, without a composition', async () => {
    await publish([
      {
        ...template,
        package: 'shipfox/an-action',
        kind: 'action',
        manifest: {description: 'An action.'},
        composition: template.composition,
        dependencies: [{name: 'ms', version: '2.1.3'}],
      },
    ]);

    const [upload] = registry.publishes;
    expect(JSON.parse(upload?.parts.draft ?? '')).toEqual({
      kind: 'action',
      license: 'MIT',
      builder: template.builder,
      dependencies: [{name: 'ms', version: '2.1.3'}],
      path: template.path,
    });
  });

  it('publishes actions before templates, then by name', async () => {
    const action = (name: string): BuiltPackage => ({
      ...template,
      package: `shipfox/${name}`,
      kind: 'action',
      manifest: {description: 'An action.'},
    });

    await publish([template, action('zeta'), action('alpha')]);

    expect(registry.publishes.map(({package: name}) => name)).toEqual([
      'shipfox/alpha',
      'shipfox/zeta',
      'shipfox/fixture-template',
    ]);
  });

  it('skips a version the registry already has and continues with the rest', async () => {
    const other: BuiltPackage = {...template, package: 'shipfox/other'};
    registry.seed(publishedDocument(template));

    const published = await publish([template, other]);

    expect(published.map(({package: name}) => name)).toEqual(['shipfox/other']);
  });

  it('asks for no OIDC token when everything is published', async () => {
    registry.seed(publishedDocument(template));

    const published = await publish([template]);

    expect(published).toEqual([]);
    expect(oidc).not.toHaveBeenCalled();
    expect(registry.requests.some(({method}) => method === 'POST')).toBe(false);
    expect(log).toHaveBeenCalledWith('Every version is already published.');
  });

  it('publishes nothing when the release check fails', async () => {
    registry.seed(publishedDocument(template));
    repository.write('workflow.yml', `${TEMPLATE_FILES['workflow.yml']}# tweak\n`);
    repository.commit();
    const changed = await buildFixture(repository);

    await expect(publish([changed])).rejects.toBeInstanceOf(ReleaseCheckFailedError);

    expect(oidc).not.toHaveBeenCalled();
    expect(registry.publishes).toEqual([]);
  });

  it('reports the registry refusal of an upload', async () => {
    const refusing = new FakeRegistry();
    const fetch: typeof globalThis.fetch = async (input, init) =>
      init?.method === 'PUT'
        ? new Response('changed without a version bump', {status: 409})
        : refusing.fetch(input, init);

    await expect(
      publishPackages({
        packages: [template],
        registry: createRegistryClient({url: 'https://registry.test', fetch}),
        requestOidcToken: oidc,
        log,
      }),
    ).rejects.toThrow('returned 409: changed without a version bump');
  });
});
