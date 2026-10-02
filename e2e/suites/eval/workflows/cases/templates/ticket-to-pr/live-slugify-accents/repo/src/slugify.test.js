import assert from 'node:assert/strict';
import {test} from 'node:test';
import {slugify} from './slugify.js';

test('joins words with dashes', () => {
  assert.equal(slugify('Hello World'), 'hello-world');
});

test('trims leading and trailing separators', () => {
  assert.equal(slugify('  --Hello!  '), 'hello');
});
