import assert from 'node:assert/strict';
import {test} from 'node:test';
import {paginate} from './paginate.js';

const items = [1, 2, 3, 4, 5, 6, 7];

test('the first page starts at the first row', () => {
  assert.deepEqual(paginate(items, {page: 1, pageSize: 3}).items, [1, 2, 3]);
});

test('the last page holds the remaining rows', () => {
  assert.deepEqual(paginate(items, {page: 3, pageSize: 3}).items, [7]);
});

test('a partly filled last page counts as a page', () => {
  assert.equal(paginate(items, {page: 1, pageSize: 3}).totalPages, 3);
});

test('a full last page does not add a page', () => {
  assert.equal(paginate([1, 2, 3, 4, 5, 6], {page: 1, pageSize: 3}).totalPages, 2);
});

test('a page past the end is empty', () => {
  assert.deepEqual(paginate(items, {page: 4, pageSize: 3}).items, []);
});

test('no rows means no pages', () => {
  assert.deepEqual(paginate([], {page: 1, pageSize: 3}), {items: [], page: 1, totalPages: 0});
});
