import {execFile} from 'node:child_process';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {parse as parseYaml} from 'yaml';
import {bundleAction} from '../src/action-recipe.js';
import type {BuiltPackage} from '../src/build.js';
import {
  ACTION_PATH,
  ACTION_REPOSITORY_FILES,
  ActionRepository,
} from './fixtures/action-repository.js';
import {blobFiles, buildActionFixture, TOOL_VERSION} from './helpers.js';

const execFileAsync = promisify(execFile);
// Each build prunes the fixture and installs from the local store.
const BUILD_TIMEOUT = 120_000;

describe('buildPackage for a JavaScript action', () => {
  let repository: ActionRepository;
  let built: BuiltPackage;
  beforeAll(async () => {
    repository = new ActionRepository();
    built = await buildActionFixture(repository);
  }, BUILD_TIMEOUT);
  afterAll(() => repository.remove());

  it('bundles the manifest, the entry files, and the license', async () => {
    const files = await blobFiles(built.content);

    expect(Object.keys(files).sort()).toEqual(['LICENSE', 'action.yml', 'index.mjs', 'post.mjs']);
    expect(files['action.yml']).toBe(
      ACTION_REPOSITORY_FILES[`${ACTION_PATH}/action.yml`]
        ?.replace('main: src/main.ts', 'main: index.mjs')
        .replace('post: src/post.ts', 'post: post.mjs'),
    );
    expect(built.manifest).toMatchObject({name: 'Example', main: 'index.mjs', post: 'post.mjs'});
    expect(built.content.format).toBe('action-bundle@1');
  });

  it('bundles workspace packages from source and keeps @shipfox/actions external', async () => {
    const bundle = (await blobFiles(built.content))['index.mjs'];

    expect(bundle).toContain('import { defineAction } from "@shipfox/actions";');
    expect(bundle).toContain('function duration(value)');
    expect(bundle).toContain('// ../../../format/src/index.ts');
    expect(bundle?.startsWith('import {createRequire as __shipfoxCreateRequire}')).toBe(true);
  });

  it('archives the trimmed build tree without node_modules or unrelated packages', async () => {
    const files = await blobFiles(built.source);

    expect(Object.keys(files).sort()).toEqual([
      `${ACTION_PATH}/LICENSE`,
      `${ACTION_PATH}/README.md`,
      `${ACTION_PATH}/action.yml`,
      `${ACTION_PATH}/package.json`,
      `${ACTION_PATH}/src/main.ts`,
      `${ACTION_PATH}/src/post.ts`,
      'libs/format/package.json',
      'libs/format/src/index.ts',
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
    ]);
  });

  it('trims the root files to what the install needs', async () => {
    const files = await blobFiles(built.source);
    const lockfile = parseYaml(files['pnpm-lock.yaml'] ?? '');

    expect(JSON.parse(files['package.json'] ?? '')).toEqual({
      name: 'fixture-workspace',
      private: true,
      packageManager: 'pnpm@11.7.0',
    });
    expect(parseYaml(files['pnpm-workspace.yaml'] ?? '')).toMatchObject({
      catalog: {'@types/node': '24.13.2', ms: '2.1.3'},
      overrides: {ms: 'catalog:'},
      minimumReleaseAge: 2880,
    });
    expect(lockfile.importers['.']).toEqual({});
    expect(Object.keys(lockfile.catalogs.default)).toEqual(['@types/node']);
    expect(Object.keys(lockfile.packages)).toEqual(['ms@2.1.3']);
  });

  it('records the production dependencies and the recipe', () => {
    expect(built).toMatchObject({
      package: 'fixture/example',
      kind: 'action',
      version: '1.0.0',
      workspaceName: '@fixture/action-example',
      license: 'MIT',
      dependencies: [{name: 'ms', version: '2.1.3'}],
      actions: [],
      composition: undefined,
      builder: {tool: '@shipfox/registry-release', version: TOOL_VERSION, recipe: 1},
    });
    expect(built.readme?.text).toBe('Formats a duration.\n');
  });

  it(
    'builds the same digests in another directory',
    async () => {
      const other = new ActionRepository();
      try {
        const second = await buildActionFixture(other);

        expect(second.content.digest).toBe(built.content.digest);
        expect(second.source.digest).toBe(built.source.digest);
        expect(second.fingerprint).toBe(built.fingerprint);
      } finally {
        other.remove();
      }
    },
    BUILD_TIMEOUT,
  );

  it(
    'bundles the same code inside the monorepo as from the build tree',
    async () => {
      const toolDirectory = join(import.meta.dirname, '..');
      await execFileAsync(
        'pnpm',
        ['--dir', repository.root, 'install', '--frozen-lockfile', '--ignore-scripts'],
        {cwd: toolDirectory},
      );

      const inMonorepo = await bundleAction({
        directory: join(repository.root, ACTION_PATH),
        main: 'src/main.ts',
      });

      expect(inMonorepo).toBe((await blobFiles(built.content))['index.mjs']);
    },
    BUILD_TIMEOUT,
  );
});
