import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseCsv} from './csv.js';

test('splits rows and fields', () => {
  assert.deepEqual(parseCsv('a,b\n1,2\n'), [
    ['a', 'b'],
    ['1', '2'],
  ]);
});

test('skips empty lines', () => {
  assert.deepEqual(parseCsv('a\n\nb'), [['a'], ['b']]);
});
