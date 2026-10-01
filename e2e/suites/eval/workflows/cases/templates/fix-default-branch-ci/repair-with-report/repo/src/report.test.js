import assert from 'node:assert/strict';
import {test} from 'node:test';
import {formatReport} from './report.js';

test('prints one line per row', () => {
  const rows = [
    {name: 'open', total: 3},
    {name: 'closed', total: 5},
  ];

  assert.equal(formatReport(rows), 'open: 3\nclosed: 5');
});
