import assert from 'node:assert/strict';
import {
  auditApiDatabaseBoundaries,
  verifyApiDatabaseBoundaries,
} from '../src/api-database-boundaries.js';

describe('database boundary verifier', () => {
  test('reports zero findings without a temporary baseline', async () => {
    const result = await verifyApiDatabaseBoundaries();

    assert.deepEqual(result.findings, []);
    assert.deepEqual(result.registryErrors, []);
  });
  test('keeps the clean repository audit deterministic', async () => {
    assert.deepEqual(await auditApiDatabaseBoundaries(), []);
  });
});
