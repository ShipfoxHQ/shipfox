import assert from 'node:assert/strict';
import test from 'node:test';
import {productionizeImports} from '../dist/turbo.js';

test('productionizes legacy source subpath imports', () => {
  const imports = {'#*': './src/*'};

  const result = productionizeImports(imports);

  assert.deepEqual(result, {'#*': './dist/*'});
  assert.notEqual(result, imports);
});

test('productionizes conditional source subpath imports', () => {
  const imports = {
    '#*': {
      'workspace-source': './src/*',
      development: './src/*',
      default: './dist/*',
    },
    '#test/*': './test/*',
  };

  const result = productionizeImports(imports);

  assert.deepEqual(result, {'#*': './dist/*', '#test/*': './test/*'});
  assert.notEqual(result, imports);
});

test('leaves missing subpath imports unchanged', () => {
  const imports = {'#test/*': './test/*'};

  const result = productionizeImports(imports);

  assert.equal(result, imports);
});

test('leaves production subpath imports unchanged', () => {
  const imports = {'#*': './dist/*'};

  const result = productionizeImports(imports);

  assert.equal(result, imports);
});
