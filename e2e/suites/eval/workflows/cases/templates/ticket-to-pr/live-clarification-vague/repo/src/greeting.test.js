import assert from 'node:assert/strict';
import {test} from 'node:test';
import {greet} from './greeting.js';

test('greets by name', () => {
  assert.equal(greet('Ada'), 'Hello, Ada!');
});
