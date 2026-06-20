import assert from 'node:assert/strict';
import {test} from 'node:test';
import {handler} from '../src/handler.js';

test('responds with ok', () => {
  let body;
  handler({}, {end: (chunk) => (body = chunk)});
  assert.equal(body, 'ok');
});
