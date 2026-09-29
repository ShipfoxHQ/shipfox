import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {decodeActionBundle} from '@shipfox/workflow-document';
import {buildPackage, writeBuildOutput} from '../src/build.js';
import {discoverPackages, loadConfig} from '../src/config.js';
import {TEMPLATE_FILES, TEMPLATE_PATH, TemplateRepository} from './fixtures/template-repository.js';
import {buildFixture, TOOL_VERSION} from './helpers.js';

const DIGEST = /^sha256:[0-9a-f]{64}$/;

describe('buildPackage for a template', () => {
  let repository: TemplateRepository;
  beforeEach(() => {
    repository = new TemplateRepository();
  });
  afterEach(() => repository.remove());

  it('encodes the template bundle from the template files and the parts', async () => {
    const built = await buildFixture(repository);

    const files = await decodeActionBundle({
      gzip: built.content.gzip,
      digest: built.content.digest,
    });
    expect(files.map(({path}) => path)).toEqual([
      'GUIDE.md',
      'parts/source/github.yml',
      'parts/tracker/github.yml',
      'parts/tracker/linear.yml',
      'template.yaml',
      'workflow.yml',
    ]);
    expect(built.content.format).toBe('template-bundle@1');
  });

  it('archives the tracked files of the package, and no untracked ones', async () => {
    repository.write('scratch.txt', 'never committed');

    const built = await buildFixture(repository);

    const files = await decodeActionBundle({gzip: built.source.gzip, digest: built.source.digest});
    expect(files.map(({path}) => path)).toEqual([
      'GUIDE.md',
      'README.md',
      'package.json',
      'parts/source/github.yml',
      'parts/tracker/github.yml',
      'parts/tracker/linear.yml',
      'template.yaml',
      'workflow.yml',
    ]);
  });

  it('rejects a binary file in the source archive', async () => {
    repository.write('logo.png', '\u0000PNG');
    repository.commit();

    await expect(buildFixture(repository)).rejects.toThrow('logo.png is a binary file');
  });

  it('stamps the composition format, the builder, and the parsed manifest', async () => {
    const built = await buildFixture(repository);

    expect(built).toMatchObject({
      package: 'shipfox/fixture-template',
      kind: 'template',
      version: '1.0.0',
      workspaceName: '@shipfox/template-fixture-template',
      license: 'MIT',
      composition: 1,
      actions: [],
      builder: {tool: '@shipfox/registry-release', version: TOOL_VERSION, recipe: 1},
      manifest: {title: 'Fixture template'},
    });
    expect(built.fingerprint).toMatch(DIGEST);
  });

  it('builds the same digests in another directory', async () => {
    const other = new TemplateRepository();
    try {
      const [first, second] = await Promise.all([buildFixture(repository), buildFixture(other)]);

      expect(second.content.digest).toBe(first.content.digest);
      expect(second.source.digest).toBe(first.source.digest);
      expect(second.fingerprint).toBe(first.fingerprint);
    } finally {
      other.remove();
    }
  });

  it('changes the fingerprint when the workflow changes', async () => {
    const before = await buildFixture(repository);
    repository.write('workflow.yml', `${TEMPLATE_FILES['workflow.yml']}# tweak\n`);
    repository.commit();

    const after = await buildFixture(repository);

    expect(after.content.digest).not.toBe(before.content.digest);
    expect(after.fingerprint).not.toBe(before.fingerprint);
  });

  it('reads the README and the changelog section of the version', async () => {
    repository.write(
      'CHANGELOG.md',
      '# @shipfox/template-fixture-template\n\n## 1.0.0\n\n### Major changes\n\n- First release.\n',
    );
    repository.commit();

    const built = await buildFixture(repository);

    expect(built.changelog).toBe('### Major changes\n\n- First release.');
    expect(built.readme?.text).toBe('Overview of the fixture template.\n');
    expect(built.readme?.digest).toMatch(DIGEST);
  });

  it('collects the registry actions the template uses', async () => {
    repository.write(
      'parts/source/github.yml',
      `open_pr: |
  - key: open_pr
    uses: shipfox/slack-thread-digest@1.4.2
`,
    );
    repository.commit();

    const built = await buildFixture(repository);

    expect(built.actions).toEqual(['shipfox/slack-thread-digest@1.4.2']);
  });

  it('rejects a local action path', async () => {
    repository.write(
      'parts/source/github.yml',
      `open_pr: |
  - key: open_pr
    uses: ./actions/local
`,
    );
    repository.commit();

    await expect(buildFixture(repository)).rejects.toThrow('can only use registry actions');
  });

  it('rejects an action reference without an exact version', async () => {
    repository.write(
      'parts/source/github.yml',
      `open_pr: |
  - key: open_pr
    uses: shipfox/slack-thread-digest@1
`,
    );
    repository.commit();

    await expect(buildFixture(repository)).rejects.toThrow('Pin an exact version');
  });

  it('rejects a composition the workflow schema refuses', async () => {
    repository.write(
      'parts/tracker/linear.yml',
      `${TEMPLATE_FILES['parts/tracker/linear.yml']}extra: |
  - key: 1
`,
    );
    repository.write(
      'workflow.yml',
      TEMPLATE_FILES['workflow.yml']?.replace('name: Fixture template\n', '') ?? '',
    );
    repository.commit();

    await expect(buildFixture(repository)).rejects.toThrow('does not parse as a workflow');
  });

  it('never reads embedded-templates.yaml', async () => {
    repository.write('embedded-templates.yaml', 'not: [valid');
    repository.commit();

    await expect(buildFixture(repository)).resolves.toBeDefined();
  });

  it('has no action recipe yet', async () => {
    await expect(
      buildPackage({
        configured: {
          package: 'shipfox/an-action',
          kind: 'action',
          path: TEMPLATE_PATH,
          directory: repository.directory,
        },
        toolVersion: TOOL_VERSION,
      }),
    ).rejects.toThrow('the action recipe is not available yet');
  });

  it('writes the blobs and a summary below .shipfox-registry', async () => {
    const built = await buildFixture(repository);

    const directory = await writeBuildOutput({root: repository.root, built});

    expect(directory).toBe(
      join(repository.root, '.shipfox-registry', 'shipfox/fixture-template', '1.0.0'),
    );
    expect(readdirSync(directory).sort()).toEqual([
      'README.md',
      'build.json',
      'content.gz',
      'source.gz',
    ]);
    expect(JSON.parse(readFileSync(join(directory, 'build.json'), 'utf8'))).toMatchObject({
      fingerprint: built.fingerprint,
    });
  });
});

describe('the first-party catalog', () => {
  it('builds every configured template with stable digests', async () => {
    const root = join(import.meta.dirname, '../../..');
    const config = await loadConfig(join(root, 'tools/registry-release/registry.config.yaml'));
    const packages = await discoverPackages({root, config});

    const first = await Promise.all(
      packages.map((configured) => buildPackage({configured, toolVersion: TOOL_VERSION})),
    );
    const second = await Promise.all(
      packages.map((configured) => buildPackage({configured, toolVersion: TOOL_VERSION})),
    );

    expect(first.map(({package: name}) => name)).toContain('shipfox/ticket-to-pr');
    expect(second.map(({fingerprint}) => fingerprint)).toEqual(
      first.map(({fingerprint}) => fingerprint),
    );
    for (const built of first) {
      expect(built.license, built.package).toBe('MIT');
    }
  });
});
