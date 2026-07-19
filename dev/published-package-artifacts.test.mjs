import assert from 'node:assert/strict';
import {describe, test} from 'node:test';

import {
  catalogDependencies,
  catalogRange,
  consumerDependencies,
  findUnsupportedProtocol,
  safePackageName,
} from './published-package-artifacts.mjs';

const workspace = {
  catalog: {react: '^19.1.1'},
  catalogs: {testing: {'@testing-library/react': '^16.3.0'}},
};
const directDependencyErrorPattern = /must use a catalog for react/u;
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
  test('declares React UI peers without relying on auto-install-peers', () => {
    const tarballs = {
      '@shipfox/react-ui': '/tmp/react-ui.tgz',
      '@shipfox/redact': '/tmp/redact.tgz',
    };

    const dependencies = consumerDependencies(tarballs, {
      react: '^19.0.0',
      'react-dom': '^19.0.0',
    });

    assert.deepEqual(dependencies, {
      '@shipfox/react-ui': 'file:/tmp/react-ui.tgz',
      '@shipfox/redact': 'file:/tmp/redact.tgz',
      react: '^19.0.0',
      'react-dom': '^19.0.0',
    });
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
