import {execFile} from 'node:child_process';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {decodeActionBundle} from '@shipfox/workflow-document';
import {parse as parseYaml} from 'yaml';
import {bundleAction} from '../src/action-recipe.js';
import {type BuiltPackage, buildPackage} from '../src/build.js';
import {
  ACTION_PATH,
  ACTION_REPOSITORY_FILES,
  ActionRepository,
} from './fixtures/action-repository.js';
import {TOOL_VERSION} from './helpers.js';

const execFileAsync = promisify(execFile);
// Each build prunes the fixture and installs from the local store.
const BUILD_TIMEOUT = 120_000;

function buildAction(repository: ActionRepository): Promise<BuiltPackage> {
  return buildPackage({configured: repository.configured, toolVersion: TOOL_VERSION});
}

async function contentFiles(built: BuiltPackage) {
  const files = await decodeActionBundle({gzip: built.content.gzip, digest: built.content.digest});
  return Object.fromEntries(files.map(({path, content}) => [path, content]));
}

async function sourceFiles(built: BuiltPackage) {
  const files = await decodeActionBundle({gzip: built.source.gzip, digest: built.source.digest});
  return Object.fromEntries(files.map(({path, content}) => [path, content]));
}

describe('buildPackage for an action', () => {
  let repository: ActionRepository;
  let built: BuiltPackage;
  beforeAll(async () => {
    repository = new ActionRepository();
    built = await buildAction(repository);
  }, BUILD_TIMEOUT);
  afterAll(() => repository.remove());

  it('bundles the manifest, the entry file, and the license', async () => {
    const files = await contentFiles(built);

    expect(Object.keys(files).sort()).toEqual(['LICENSE', 'action.yml', 'index.mjs']);
    expect(files['action.yml']).toBe(
      ACTION_REPOSITORY_FILES[`${ACTION_PATH}/action.yml`]?.replace(
        'main: src/main.ts',
        'main: index.mjs',
      ),
    );
    expect(built.manifest).toMatchObject({name: 'Example', main: 'index.mjs'});
    expect(built.content.format).toBe('action-bundle@1');
  });

  it('bundles workspace packages from source and keeps @shipfox/actions external', async () => {
    const bundle = (await contentFiles(built))['index.mjs'];

    expect(bundle).toContain('import { defineAction } from "@shipfox/actions";');
    expect(bundle).toContain('function duration(value)');
    expect(bundle).toContain('// ../../../format/src/index.ts');
    expect(bundle?.startsWith('import {createRequire as __shipfoxCreateRequire}')).toBe(true);
  });

  it('archives the trimmed build tree without node_modules or unrelated packages', async () => {
    const files = await sourceFiles(built);

    expect(Object.keys(files).sort()).toEqual([
      `${ACTION_PATH}/LICENSE`,
      `${ACTION_PATH}/README.md`,
      `${ACTION_PATH}/action.yml`,
      `${ACTION_PATH}/package.json`,
      `${ACTION_PATH}/src/main.ts`,
      'libs/format/package.json',
      'libs/format/src/index.ts',
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
    ]);
  });

  it('trims the root files to what the install needs', async () => {
    const files = await sourceFiles(built);
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
        const second = await buildAction(other);

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

      expect(inMonorepo).toBe((await contentFiles(built))['index.mjs']);
    },
    BUILD_TIMEOUT,
  );
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

    await expect(buildAction(repository)).rejects.toThrow(
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

  function write(path: string, content: string) {
    mkdirSync(join(directory, path, '..'), {recursive: true});
    writeFileSync(join(directory, path), content);
  }

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
