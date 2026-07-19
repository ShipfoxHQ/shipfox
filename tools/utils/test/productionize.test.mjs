import assert from 'node:assert/strict';
import test from 'node:test';

import {
  productionizeExports,
  productionizeImports,
  productionizeManifest,
} from '../src/productionize.js';

const SOURCE_PATH = /\.\/src\//u;

test('productionizes legacy and conditional subpath imports', () => {
  const legacyImports = {'#*': './src/*'};
  const conditionalImports = {
    '#*': {
      types: './src/*',
      'workspace-source': './src/*',
      development: './src/*',
      default: './dist/*',
    },
    '#test/*': './test/*',
  };

  const legacyResult = productionizeImports(legacyImports);
  const conditionalResult = productionizeImports(conditionalImports);

  assert.deepEqual(legacyResult, {'#*': './dist/*'});
  assert.deepEqual(conditionalResult, {'#*': './dist/*', '#test/*': './test/*'});
  assert.notEqual(legacyResult, legacyImports);
  assert.notEqual(conditionalResult, conditionalImports);
});

test('preserves imports that do not need productionization', () => {
  const imports = {'#test/*': './test/*'};

  const result = productionizeImports(imports);

  assert.equal(result, imports);
});

test('removes source type conditions from non-wildcard imports', () => {
  const imports = {
    '#generated': {types: './src/generated.ts', default: './dist/generated.js'},
  };

  const result = productionizeImports(imports);

  assert.deepEqual(result, {'#generated': './dist/generated.js'});
});

test('preserves unchanged array targets by identity and productionizes mixed fallbacks', () => {
  const unchanged = ['./dist/index.js', null];
  const imports = {
    '#unchanged': unchanged,
    '#mixed': [{development: './src/mixed.ts', default: './dist/mixed.js'}, null],
  };

  const result = productionizeImports(imports);

  assert.equal(result['#unchanged'], unchanged);
  assert.deepEqual(result['#mixed'], ['./dist/mixed.js', null]);
});

test('productionizes exports with conditional, wildcard, string, and style targets', () => {
  const exportsField = {
    '.': {
      development: {types: './src/index.ts', default: './src/index.ts'},
      default: {types: './dist/index.d.ts', default: './dist/index.js'},
    },
    './core/*': {
      'workspace-source': './src/core/*.ts',
      default: './dist/core/*.js',
    },
    './styles.css': './dist/styles.css',
    './theme/*': {style: './dist/theme/*.css', default: './dist/theme/*.js'},
  };

  const result = productionizeExports(exportsField);

  assert.deepEqual(result, {
    '.': {types: './dist/index.d.ts', default: './dist/index.js'},
    './core/*': './dist/core/*.js',
    './styles.css': './dist/styles.css',
    './theme/*': {style: './dist/theme/*.css', default: './dist/theme/*.js'},
  });
});

test('productionizes manifests without retaining source targets', () => {
  const manifest = {
    name: '@shipfox/example',
    imports: {
      '#*': {
        'workspace-source': './src/*',
        development: './src/*',
        default: './dist/*',
      },
    },
    exports: {
      '.': {
        development: {types: './src/index.ts', default: './src/index.ts'},
        default: {types: './dist/index.d.ts', default: './dist/index.js'},
      },
    },
  };

  const result = productionizeManifest(manifest);

  assert.deepEqual(result, {
    name: '@shipfox/example',
    imports: {'#*': './dist/*'},
    exports: {'.': {types: './dist/index.d.ts', default: './dist/index.js'}},
  });
  assert.doesNotMatch(JSON.stringify(result), SOURCE_PATH);
});

test('preserves manifest identity when it is already productionized', () => {
  const manifest = {
    name: '@shipfox/example',
    imports: {'#*': './dist/*'},
    exports: {'.': './dist/index.js'},
  };

  const result = productionizeManifest(manifest);

  assert.equal(result, manifest);
});
