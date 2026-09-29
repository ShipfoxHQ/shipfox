import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {run} from '../src/commands.js';
import {FakeRegistry} from './fixtures/fake-registry.js';
import {publishedDocument} from './fixtures/registry-documents.js';
import {TEMPLATE_FILES, TEMPLATE_PATH, TemplateRepository} from './fixtures/template-repository.js';
import {buildFixture} from './helpers.js';

const CONFIG = `registry: https://api.registry.test
namespace: shipfox
packages:
  - {kind: template, path: libs/shared/workflow/catalog/templates/*}
`;

describe('run', () => {
  let repository: TemplateRepository;
  let registry: FakeRegistry;
  let out: string;
  let err: string;

  const cli = (argv: string[], env: Record<string, string> = {}) =>
    run(argv, {
      cwd: repository.root,
      env,
      stdout: (text) => {
        out += text;
      },
      stderr: (text) => {
        err += text;
      },
      fetch: registry.fetch,
    });

  beforeEach(() => {
    repository = new TemplateRepository();
    repository.writeAt('tools/registry-release/registry.config.yaml', CONFIG);
    repository.writeAt('.changeset/README.md', '# Changesets\n');
    repository.commit();
    registry = new FakeRegistry();
    out = '';
    err = '';
  });
  afterEach(() => repository.remove());

  it('builds a package by directory and prints its digests', async () => {
    const code = await cli([
      'build',
      TEMPLATE_PATH,
      '--config',
      'tools/registry-release/registry.config.yaml',
    ]);

    expect(code).toBe(0);
    expect(JSON.parse(out.slice(0, out.lastIndexOf('}') + 1))).toMatchObject({
      package: 'shipfox/fixture-template',
      version: '1.0.0',
      content: {digest: expect.stringContaining('sha256:')},
    });
    expect(
      existsSync(
        join(repository.root, '.shipfox-registry/shipfox/fixture-template/1.0.0/content.gz'),
      ),
    ).toBe(true);
  });

  it('refuses to build a directory that is not configured', async () => {
    await expect(
      cli(['build', 'libs', '--config', 'tools/registry-release/registry.config.yaml']),
    ).rejects.toThrow('is not a package in registry.config.yaml');
  });

  it('passes check --mode pr for an unpublished package', async () => {
    const code = await cli([
      'check',
      '--mode',
      'pr',
      '--config',
      'tools/registry-release/registry.config.yaml',
    ]);

    expect(code).toBe(0);
    expect(out).toBe('Registry check passed.\n');
  });

  it('fails check --mode pr for a change with no changeset, and reads the changeset once added', async () => {
    registry.seed(publishedDocument(await buildFixture(repository)));
    repository.write('workflow.yml', `${TEMPLATE_FILES['workflow.yml']}# tweak\n`);
    repository.commit();
    const args = [
      'check',
      '--mode',
      'pr',
      '--config',
      'tools/registry-release/registry.config.yaml',
    ];

    expect(await cli(args)).toBe(1);
    expect(out).toContain('error: shipfox/fixture-template:');

    repository.writeAt(
      '.changeset/tweak.md',
      `---\n'@shipfox/template-fixture-template': patch\n---\n\nTweaks it.\n`,
    );
    out = '';
    expect(await cli(args)).toBe(0);
  });

  it('requires a mode for check', async () => {
    await expect(
      cli(['check', '--config', 'tools/registry-release/registry.config.yaml']),
    ).rejects.toThrow('check needs --mode pr or --mode release');
  });

  it('publishes with the OIDC audience of the registry override', async () => {
    const env = {
      ACTIONS_ID_TOKEN_REQUEST_URL: 'https://token.actions.test/oidc',
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'bearer',
    };
    const calls: string[] = [];
    const routed = new FakeRegistry();
    const fetch: typeof globalThis.fetch = (input, init) => {
      if (String(input).startsWith('https://token.actions.test')) {
        calls.push(String(input));
        return Promise.resolve(Response.json({value: 'jwt'}));
      }
      return routed.fetch(input, init);
    };

    const code = await run(
      [
        'publish',
        '--registry',
        'https://staging.registry.test/',
        '--config',
        'tools/registry-release/registry.config.yaml',
      ],
      {cwd: repository.root, env, stdout: () => undefined, stderr: () => undefined, fetch},
    );

    expect(code).toBe(0);
    expect(calls).toEqual([
      'https://token.actions.test/oidc?audience=https%3A%2F%2Fstaging.registry.test',
    ]);
    expect(routed.publishes.map(({package: name}) => name)).toEqual(['shipfox/fixture-template']);
  });

  it('exits 1 with the refusals when a publish check fails', async () => {
    registry.seed(publishedDocument(await buildFixture(repository)));
    repository.write('workflow.yml', `${TEMPLATE_FILES['workflow.yml']}# tweak\n`);
    repository.commit();

    const code = await cli(['publish', '--config', 'tools/registry-release/registry.config.yaml']);

    expect(code).toBe(1);
    expect(err).toContain('The release check failed');
  });

  it('prints usage for no command and for an unknown one', async () => {
    expect(await cli([])).toBe(1);
    expect(out).toContain('Usage: shipfox-registry-release');
    expect(await cli(['nope', '--config', 'tools/registry-release/registry.config.yaml'])).toBe(1);
    expect(err).toContain('Unknown command nope');
  });
});
