import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {bundleAction} from '../src/action-recipe.js';
import {ACTION_PATH, ActionRepository} from './fixtures/action-repository.js';
import {blobFiles, buildActionFixture} from './helpers.js';

// A JavaScript action prunes and installs a build tree, so its recipe tests are in
// action-recipe.integration.test.ts. These tests never spawn turbo or pnpm.

const COMPOSITE_FILES: Record<string, string> = {
  [`${ACTION_PATH}/package.json`]: `${JSON.stringify({
    name: '@fixture/action-example',
    private: true,
    version: '1.0.0',
    license: 'MIT',
  })}\n`,
  [`${ACTION_PATH}/action.yml`]: `name: Example
description: Digests a thread, then briefs it.
steps:
  - key: digest
    uses: shipfox/slack-thread-digest@1.0.0
  - uses: acme/notify@2.0.0
  - run: $\{{ action.path }}/scripts/brief.sh
`,
  [`${ACTION_PATH}/scripts/brief.sh`]: '#!/bin/sh\necho brief\n',
  [`${ACTION_PATH}/LICENSE`]: 'MIT License\n',
  [`${ACTION_PATH}/README.md`]: 'Briefs a thread.\n',
  [`${ACTION_PATH}/CHANGELOG.md`]: '# Changelog\n',
};

describe('buildPackage for a composite action', () => {
  let repository: ActionRepository;
  afterEach(() => repository.remove());

  it('bundles the directory as written, without the package metadata files', async () => {
    repository = new ActionRepository(COMPOSITE_FILES);

    const built = await buildActionFixture(repository);

    expect(Object.keys(await blobFiles(built.content)).sort()).toEqual([
      'LICENSE',
      'action.yml',
      'scripts/brief.sh',
    ]);
    expect((await blobFiles(built.content))['action.yml']).toBe(
      COMPOSITE_FILES[`${ACTION_PATH}/action.yml`],
    );
    expect(Object.keys(await blobFiles(built.source)).sort()).toEqual([
      'CHANGELOG.md',
      'LICENSE',
      'README.md',
      'action.yml',
      'package.json',
      'scripts/brief.sh',
    ]);
    expect(built).toMatchObject({
      kind: 'action',
      content: {format: 'action-bundle@1'},
      actions: ['acme/notify@2.0.0', 'shipfox/slack-thread-digest@1.0.0'],
      dependencies: [],
      builder: {recipe: 1},
    });
  });

  it.each([
    ['a repository path', './libs/catalog/actions/other'],
    ['an action.path path', '$' + '{{ action.path }}/steps/notify'],
  ])('rejects a step that uses %s', async (_name, uses) => {
    repository = new ActionRepository({
      ...COMPOSITE_FILES,
      [`${ACTION_PATH}/action.yml`]: `name: Example\ndescription: Uses a path.\nsteps:\n  - uses: ${uses}\n`,
    });

    await expect(buildActionFixture(repository)).rejects.toThrow(`uses ${uses}`);
  });

  it('rejects more files than a repository action holds', async () => {
    const prompts = Object.fromEntries(
      Array.from({length: 100}, (_, index) => [`${ACTION_PATH}/prompts/${index}.md`, 'x\n']),
    );
    repository = new ActionRepository({...COMPOSITE_FILES, ...prompts});

    await expect(buildActionFixture(repository)).rejects.toThrow('at most 100 files');
  });
});

describe('buildPackage for an action that breaks a rule', () => {
  let repository: ActionRepository | undefined;
  afterEach(() => repository?.remove());

  it('rejects @shipfox/actions as a production dependency', async () => {
    repository = new ActionRepository();
    repository.write(
      `${ACTION_PATH}/package.json`,
      JSON.stringify({
        name: '@fixture/action-example',
        version: '1.0.0',
        license: 'MIT',
        dependencies: {'@fixture/format': 'workspace:*', '@shipfox/actions': 'workspace:*'},
      }),
    );

    await expect(buildActionFixture(repository)).rejects.toThrow(
      '@shipfox/actions must be in devDependencies',
    );
  });
});

describe('bundleAction', () => {
  let directory: string;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'registry-release-bundle-'));
  });
  afterEach(() => rmSync(directory, {recursive: true, force: true}));

  function writeIn(root: string, path: string, content: string) {
    mkdirSync(join(root, path, '..'), {recursive: true});
    writeFileSync(join(root, path), content);
  }
  const write = (path: string, content: string) => writeIn(directory, path, content);

  it('bundles the same code in another directory', async () => {
    const files = {
      'node_modules/dependency/package.json': '{"name": "dependency", "main": "index.js"}',
      'node_modules/dependency/index.js': 'module.exports = (value) => value + " ms";\n',
      'node_modules/@fixture/format/package.json': JSON.stringify({
        name: '@fixture/format',
        exports: {'.': {'workspace-source': './src/index.ts', default: './dist/index.js'}},
      }),
      'node_modules/@fixture/format/src/index.ts':
        "import format from 'dependency';\nexport const duration = (value: number) => format(value);\n",
      'main.ts':
        "import {defineAction} from '@shipfox/actions';\nimport {duration} from '@fixture/format';\nexport default defineAction(() => duration(90));\n",
    };
    for (const [path, content] of Object.entries(files)) write(path, content);
    const other = mkdtempSync(join(tmpdir(), 'registry-release-bundle-'));
    try {
      for (const [path, content] of Object.entries(files)) writeIn(other, path, content);

      const [first, second] = await Promise.all([
        bundleAction({directory, main: 'main.ts'}),
        bundleAction({directory: other, main: 'main.ts'}),
      ]);

      expect(second).toBe(first);
      expect(first).toContain('// node_modules/@fixture/format/src/index.ts');
      expect(first).toContain('from "@shipfox/actions"');
    } finally {
      rmSync(other, {recursive: true, force: true});
    }
  });

  it('rejects a require it cannot resolve, in a dependency too', async () => {
    write('node_modules/dynamic/package.json', '{"name": "dynamic", "main": "index.js"}');
    write('node_modules/dynamic/index.js', 'module.exports = (name) => require(name);\n');
    write('main.ts', "import load from 'dynamic';\nexport default load;\n");

    await expect(bundleAction({directory, main: 'main.ts'})).rejects.toThrow(
      'node_modules/dynamic/index.js:1: This call to "require" will not be bundled',
    );
  });

  it('rejects a dynamic import it cannot resolve', async () => {
    write('main.ts', 'export default (name: string) => import(name);\n');

    await expect(bundleAction({directory, main: 'main.ts'})).rejects.toThrow(
      'This "import" expression will not be bundled',
    );
  });

  it('rejects a native module', async () => {
    write('addon.node', 'not really native');
    write('main.ts', "import addon from './addon.node';\nexport default addon;\n");

    await expect(bundleAction({directory, main: 'main.ts'})).rejects.toThrow(
      'No loader is configured for ".node" files',
    );
  });
});
