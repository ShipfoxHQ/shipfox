import assert from 'node:assert/strict';
import {describe, test} from 'node:test';
import {
  apiContextPackagePaths,
  auditApiContextInventory,
  auditRepository,
} from './api-context-inventory.mjs';

describe('auditApiContextInventory', () => {
  test('requires every API implementation package to have one classification', () => {
    const errors = auditApiContextInventory([...apiContextPackagePaths(), 'libs/api/new-context']);

    assert.deepEqual(errors, ['Unclassified API implementation package: libs/api/new-context']);
  });

  test('accepts the repository inventory', async () => {
    const errors = await auditRepository();

    assert.deepEqual(errors, []);
  });
});
