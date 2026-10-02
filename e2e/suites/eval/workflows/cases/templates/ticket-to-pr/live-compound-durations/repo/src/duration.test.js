import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseDuration} from './duration.js';

const INVALID = /Invalid duration/;

test('parses a single unit', () => {
  assert.equal(parseDuration('90s'), 90_000);
  assert.equal(parseDuration('2h'), 7_200_000);
});

test('rejects text that is not a duration', () => {
  assert.throws(() => parseDuration('soon'), INVALID);
});
