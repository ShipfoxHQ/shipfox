import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {describe, test} from 'node:test';
import {fileURLToPath} from 'node:url';

import {
  assertApplicationReleasePackages,
  computePublicationClosure,
  createApplicationReleasePackages,
  entryPointSupportsRuntimeImport,
  entryPointSupportsTypeResolution,
  listPublicPackageEntryPoints,
  readPublicationClosureConfig,
  readWorkspacePackages,
  validatePublicationState,
} from '../dist/package-closure.js';

const repositoryRoot = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const MISSING_ROOT_ERROR = /Publication root is not a workspace package: @shipfox\/missing/u;
const MISSING_RUNTIME_ERROR = /missing: @shipfox\/runtime/u;
const PRIVATE_RUNTIME_ERROR = /Publication closure package is private: @shipfox\/private-runtime/u;
const UNEXPECTED_RUNTIME_ERROR = /unexpected: @shipfox\/runtime/u;

function workspacePackage(name, options = {}) {
  const directory = `/repo/libs/${name.slice('@shipfox/'.length)}`;
  return {
    directory,
    manifestPath: `${directory}/package.json`,
    manifest: {
      name,
      version: '0.1.0',
      private: options.private ?? false,
      license: 'MIT',
      repository: {
        type: 'git',
        url: 'git+https://github.com/ShipfoxHQ/shipfox.git',
        directory: directory.slice('/repo/'.length),
      },
      imports: {
        '#*': {
          'workspace-source': './src/*',
          development: './src/*',
          default: './dist/*',
        },
      },
      exports: {'.': './dist/index.js'},
      scripts: {build: 'build', type: 'type', 'type:emit': 'type:emit'},
      dependencies: options.dependencies,
      optionalDependencies: options.optionalDependencies,
      peerDependencies: options.peerDependencies,
      devDependencies: options.devDependencies,
    },
  };
}

describe('publication closure', () => {
  test('walks all runtime workspace dependency fields and ignores dev dependencies', () => {
    const packages = new Map([
      [
        '@shipfox/root',
        workspacePackage('@shipfox/root', {
          dependencies: {'@shipfox/runtime': 'workspace:*'},
          optionalDependencies: {'@shipfox/optional-runtime': 'workspace:*'},
          peerDependencies: {'@shipfox/peer-runtime': 'workspace:*'},
          devDependencies: {'@shipfox/test-only': 'workspace:*'},
        }),
      ],
      ['@shipfox/runtime', workspacePackage('@shipfox/runtime')],
      ['@shipfox/optional-runtime', workspacePackage('@shipfox/optional-runtime')],
      ['@shipfox/peer-runtime', workspacePackage('@shipfox/peer-runtime')],
      ['@shipfox/test-only', workspacePackage('@shipfox/test-only')],
    ]);

    const closure = computePublicationClosure(packages, ['@shipfox/root']);

    assert.deepEqual(closure, [
      '@shipfox/optional-runtime',
      '@shipfox/peer-runtime',
      '@shipfox/root',
      '@shipfox/runtime',
    ]);
  });

  test('rejects a missing publication root', () => {
    const compute = () => computePublicationClosure(new Map(), ['@shipfox/missing']);

    assert.throws(compute, MISSING_ROOT_ERROR);
  });

  test('rejects drift between the computed and declared closure', () => {
    const packages = new Map([
      [
        '@shipfox/root',
        workspacePackage('@shipfox/root', {
          dependencies: {'@shipfox/runtime': 'workspace:*'},
        }),
      ],
      ['@shipfox/runtime', workspacePackage('@shipfox/runtime')],
    ]);
    const config = {roots: ['@shipfox/root'], packages: ['@shipfox/root']};

    const validate = () => validatePublicationState(packages, config, '/repo');

    assert.throws(validate, UNEXPECTED_RUNTIME_ERROR);
  });

  test('rejects a public package with a private runtime dependency', () => {
    const packages = new Map([
      [
        '@shipfox/root',
        workspacePackage('@shipfox/root', {
          dependencies: {'@shipfox/private-runtime': 'workspace:*'},
        }),
      ],
      ['@shipfox/private-runtime', workspacePackage('@shipfox/private-runtime', {private: true})],
    ]);
    const config = {
      roots: ['@shipfox/root'],
      packages: ['@shipfox/private-runtime', '@shipfox/root'],
    };

    const validate = () => validatePublicationState(packages, config, '/repo');

    assert.throws(validate, PRIVATE_RUNTIME_ERROR);
  });

  test('rejects an application release missing an expected package', () => {
    const validate = () =>
      assertApplicationReleasePackages(
        [{name: '@shipfox/root', version: '0.1.0'}],
        ['@shipfox/root', '@shipfox/runtime'],
      );

    assert.throws(validate, MISSING_RUNTIME_ERROR);
  });

  test('classifies JavaScript, type-only, and non-module exports', () => {
    const entryPoints = listPublicPackageEntryPoints('@shipfox/example', {
      '.': {
        development: {types: './src/index.ts', default: './src/index.ts'},
        default: {types: './dist/index.d.ts', default: './dist/index.js'},
      },
      './types': {types: './dist/types.d.ts'},
      './package.json': './package.json',
      './styles.css': './dist/styles.css',
    });

    const runtimeEntryPoints = entryPoints
      .filter(({target}) => entryPointSupportsRuntimeImport(target))
      .map(({specifier}) => specifier);
    const typeEntryPoints = entryPoints
      .filter(({target}) => entryPointSupportsTypeResolution(target))
      .map(({specifier}) => specifier);

    assert.deepEqual(runtimeEntryPoints, ['@shipfox/example']);
    assert.deepEqual(typeEntryPoints, ['@shipfox/example', '@shipfox/example/types']);
  });

  test('keeps the repository closure and application-release package set exact', () => {
    const config = readPublicationClosureConfig(
      resolve(repositoryRoot, 'publication-closure.json'),
    );
    const workspacePackages = readWorkspacePackages(repositoryRoot);

    const releasePackages = createApplicationReleasePackages(
      workspacePackages,
      config,
      repositoryRoot,
    );

    assert.deepEqual(
      releasePackages.map(({name}) => name),
      config.packages,
    );
    assert.equal(releasePackages.length, 58);
  });
});
