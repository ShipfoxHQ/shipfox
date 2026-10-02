import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseDuration} from './duration.js';

const INVALID = /Invalid duration/;

test('adds up several units', () => {
  assert.equal(parseDuration('1h30m'), 5_400_000);
  assert.equal(parseDuration('1d2h3m4s'), 93_784_000);
});

test('accepts the units in any order', () => {
  assert.equal(parseDuration('30s1m'), 90_000);
});

test('still parses a single unit', () => {
  assert.equal(parseDuration('90s'), 90_000);
});

test('rejects a compound duration with a bad part', () => {
  assert.throws(() => parseDuration('1h30'), INVALID);
  assert.throws(() => parseDuration('1h x 30m'), INVALID);
  assert.throws(() => parseDuration(''), INVALID);
});
