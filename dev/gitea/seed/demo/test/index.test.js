import assert from 'node:assert/strict';
import {test} from 'node:test';
import {greet} from '../src/index.js';

test('greets by name', () => {
  assert.equal(greet('Shipfox'), 'Hello, Shipfox!');
});
