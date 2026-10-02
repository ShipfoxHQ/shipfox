import assert from 'node:assert/strict';
import {test} from 'node:test';
import {paginate} from './paginate.js';

test('counts the pages of an evenly divided list', () => {
  const result = paginate([1, 2, 3, 4, 5, 6], {page: 1, pageSize: 3});

  assert.equal(result.totalPages, 2);
});

test('echoes the page it was asked for', () => {
  assert.equal(paginate([1, 2, 3], {page: 1, pageSize: 3}).page, 1);
});
