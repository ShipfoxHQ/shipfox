import assert from 'node:assert/strict';
import {test} from 'node:test';
import {report} from './report.js';

test('prints one line per row', () => {
  assert.equal(report([], [{name: 'open', total: 3}]), 'open: 3');
});
