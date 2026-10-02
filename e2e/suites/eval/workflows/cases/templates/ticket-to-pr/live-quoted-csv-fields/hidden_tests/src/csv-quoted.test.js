import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseCsv} from './csv.js';

test('keeps a comma inside a quoted field', () => {
  assert.deepEqual(parseCsv('name,city\n"Doe, Jane",Paris\n'), [
    ['name', 'city'],
    ['Doe, Jane', 'Paris'],
  ]);
});

test('reads a doubled quote as one quote', () => {
  assert.deepEqual(parseCsv('"She said ""hi""",x'), [['She said "hi"', 'x']]);
});

test('keeps a line break inside a quoted field', () => {
  assert.deepEqual(parseCsv('"line one\nline two",x\ny,z'), [
    ['line one\nline two', 'x'],
    ['y', 'z'],
  ]);
});

test('keeps a blank line inside a quoted field', () => {
  assert.deepEqual(parseCsv('a,"x\n\ny"\nb'), [['a', 'x\n\ny'], ['b']]);
});

test('keeps empty fields', () => {
  assert.deepEqual(parseCsv('a,,c'), [['a', '', 'c']]);
});

test('still reads plain rows', () => {
  assert.deepEqual(parseCsv('a,b\n1,2\n'), [
    ['a', 'b'],
    ['1', '2'],
  ]);
});
