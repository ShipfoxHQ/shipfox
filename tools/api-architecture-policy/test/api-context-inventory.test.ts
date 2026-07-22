import assert from 'node:assert/strict';
import {
  apiContextPackagePaths,
  auditApiContextInventory,
  auditPolicyFixture,
  auditRepository,
} from '../src/api-context-inventory.js';

describe('auditApiContextInventory', () => {
  test('requires every relevant server package to have one classification', () => {
    const errors = auditApiContextInventory([...apiContextPackagePaths(), 'libs/api/new-context']);

    assert.deepEqual(errors, ['Unclassified server package: libs/api/new-context']);
  });

  test('accepts the repository inventory', async () => {
    const errors = await auditRepository();

    assert.deepEqual(errors, []);
  });

  test('rejects Auth root and deep implementation imports from consumer tests', () => {
    const productionErrors = auditPolicyFixture({
      importerPath: 'libs/api/runners',
      sourceFile: 'src/consumer.test.ts:@shipfox/api-auth',
      targetPath: 'libs/api/auth',
    });
    const testErrors = auditPolicyFixture({
      importerPath: 'libs/api/runners',
      sourceFile: 'test/consumer.test.ts:@shipfox/api-auth/core/job-lease-token',
      targetPath: 'libs/api/auth',
    });

    assert.deepEqual(productionErrors, [
      'Foreign implementation import: src/consumer.test.ts:@shipfox/api-auth',
    ]);
    assert.deepEqual(testErrors, [
      'Foreign implementation import: test/consumer.test.ts:@shipfox/api-auth/core/job-lease-token',
    ]);
  });

  test('rejects a new foreign manifest edge and DTO root contract export', () => {
    const manifestErrors = auditPolicyFixture({
      dependencyGroup: 'devDependencies',
      importerPath: 'libs/api/runners',
      targetPath: 'libs/api/auth',
    });
    const dtoErrors = auditPolicyFixture({
      dtoHasInterModuleEntry: false,
      dtoRootExportsInterModule: true,
      importerPath: 'libs/api/projects-dto',
    });

    assert.deepEqual(manifestErrors, ['Foreign implementation manifest edge: devDependencies']);
    assert.deepEqual(dtoErrors, ['DTO root exports inter-module contract']);
  });
});
