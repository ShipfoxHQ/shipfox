import assert from 'node:assert/strict';
import {test} from 'node:test';
import {slugify} from './slugify.js';

test('keeps the base letter of an accented letter', () => {
  assert.equal(slugify('Crème brûlée'), 'creme-brulee');
});

test('handles accents on capitals and mixed text', () => {
  assert.equal(slugify('Élan Vital à Paris'), 'elan-vital-a-paris');
});

test('still drops characters that have no base letter', () => {
  assert.equal(slugify('Rock & Roll!'), 'rock-roll');
});

test('keeps the existing behavior', () => {
  assert.equal(slugify('Hello World'), 'hello-world');
  assert.equal(slugify('  --Hello!  '), 'hello');
});
