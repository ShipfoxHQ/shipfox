import assert from 'node:assert/strict';

import {
  catalogDependencies,
  catalogRange,
  consumerDependencies,
  consumerOverrides,
  findUnsupportedProtocol,
  runtimeEntryPoints,
  safePackageName,
} from '../src/published-package-artifacts.js';

const workspace = {
  catalog: {react: '^19.1.1'},
  catalogs: {testing: {'@testing-library/react': '^16.3.0'}},
};
const directDependencyErrorPattern = /must use a catalog or workspace reference for react/u;
const missingCatalogEntryErrorPattern = /Catalog default does not define missing-package/u;

describe('catalogDependencies', () => {
  test('resolves default and named catalog references', () => {
    const manifest = {
      name: '@fixture/package',
      dependencies: {react: 'catalog:', '@testing-library/react': 'catalog:testing'},
    };

    const dependencies = catalogDependencies(manifest, workspace);

    assert.deepEqual(dependencies, {
      react: '^19.1.1',
      '@testing-library/react': '^16.3.0',
    });
  });

  test('resolves workspace dependency references', () => {
    const manifest = {
      name: '@fixture/package',
      dependencies: {'@shipfox/inter-module': 'workspace:*'},
    };

    const dependencies = catalogDependencies(
      manifest,
      workspace,
      new Map([['@shipfox/inter-module', '0.2.0']]),
    );

    assert.deepEqual(dependencies, {'@shipfox/inter-module': '0.2.0'});
  });

  test('rejects dependency versions outside a catalog', () => {
    const manifest = {name: '@fixture/package', dependencies: {react: '^19.1.1'}};

    const action = () => catalogDependencies(manifest, workspace);

    assert.throws(action, directDependencyErrorPattern);
  });
});

describe('catalogRange', () => {
  test('rejects a missing catalog entry', () => {
    const action = () => catalogRange('catalog:', 'missing-package', workspace);

    assert.throws(action, missingCatalogEntryErrorPattern);
  });
});

describe('consumerDependencies', () => {
  test('installs every packed artifact from its local tarball', () => {
    const tarballs = {
      '@shipfox/react-ui': '/tmp/react-ui.tgz',
      '@shipfox/redact': '/tmp/redact.tgz',
    };

    const dependencies = consumerDependencies(tarballs);

    assert.deepEqual(dependencies, {
      '@shipfox/react-ui': 'file:/tmp/react-ui.tgz',
      '@shipfox/redact': 'file:/tmp/redact.tgz',
    });
  });
});

describe('runtimeEntryPoints', () => {
  test('discovers runtime exports and excludes type-only or data exports', () => {
    const entryPoints = runtimeEntryPoints('@shipfox/example', {
      name: '@shipfox/example',
      exports: {
        '.': {types: './dist/index.d.ts', default: './dist/index.js'},
        './client': './client.d.ts',
        './config': './config.json',
        './runner': './dist/runner.mjs',
      },
    });

    assert.deepEqual(entryPoints, ['@shipfox/example', '@shipfox/example/runner']);
  });
});

describe('consumerOverrides', () => {
  test('pins transitive Shipfox dependencies to packed tarballs', () => {
    const tarballs = {'@shipfox/inter-module': '/tmp/inter-module.tgz'};

    const overrides = consumerOverrides(tarballs);

    assert.deepEqual(overrides, {'@shipfox/inter-module': 'file:/tmp/inter-module.tgz'});
  });
});

describe('findUnsupportedProtocol', () => {
  test('reports the nested path of an unsupported package protocol', () => {
    const manifest = {dependencies: {fixture: 'workspace:*'}};

    const protocolPath = findUnsupportedProtocol(manifest);

    assert.equal(protocolPath, 'package.json.dependencies.fixture');
  });

  test('accepts ordinary dependency ranges', () => {
    const manifest = {dependencies: {fixture: '^1.0.0'}};

    const protocolPath = findUnsupportedProtocol(manifest);

    assert.equal(protocolPath, undefined);
  });
});

describe('safePackageName', () => {
  test('makes scoped package names suitable for tarballs', () => {
    const tarballName = safePackageName('@shipfox/example/package');

    assert.equal(tarballName, 'example-package');
  });
});
