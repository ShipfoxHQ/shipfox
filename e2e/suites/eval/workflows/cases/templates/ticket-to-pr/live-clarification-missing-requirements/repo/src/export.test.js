import assert from 'node:assert/strict';
import {test} from 'node:test';
import {exportRows} from './export.js';

test('writes one line per row', () => {
  assert.equal(
    exportRows([
      {id: 1, name: 'a'},
      {id: 2, name: 'b'},
    ]),
    '1,a\n2,b',
  );
});
