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

  test('rejects implementation dependencies from DTOs, shared semantics, and foreign SPIs', () => {
    const dtoErrors = auditPolicyFixture({
      dependencyGroup: 'dependencies',
      importerPath: 'libs/api/workflows-dto',
      sourceFile: 'src/index.ts:@shipfox/api-workflows',
      targetPath: 'libs/api/workflows',
    });
    const sharedSemanticErrors = auditPolicyFixture({
      dependencyGroup: 'dependencies',
      importerPath: 'libs/shared/common/runner-labels',
      sourceFile: 'src/index.ts:@shipfox/api-runners',
      targetPath: 'libs/api/runners',
    });
    const spiErrors = auditPolicyFixture({
      dependencyGroup: 'dependencies',
      importerPath: 'libs/api/integration/spi',
      sourceFile: 'src/index.ts:@shipfox/api-workflows',
      targetPath: 'libs/api/workflows',
    });
    assert.deepEqual(dtoErrors, [
      'DTO implementation import: src/index.ts:@shipfox/api-workflows',
      'DTO implementation manifest edge: dependencies',
    ]);
    assert.deepEqual(sharedSemanticErrors, [
      'Shared semantic implementation import: src/index.ts:@shipfox/api-runners',
      'Shared semantic implementation dependency: dependencies',
    ]);
    assert.deepEqual(spiErrors, [
      'Foreign SPI implementation import: src/index.ts:@shipfox/api-workflows',
      'Foreign SPI implementation manifest edge: dependencies',
    ]);
  });

  test('rejects foreign implementation dependencies on same-context SPIs', () => {
    const errors = auditPolicyFixture({
      dependencyGroup: 'dependencies',
      importerPath: 'libs/api/workflows',
      sourceFile: 'src/core/agent-tools.ts:@shipfox/api-integration-spi',
      targetPath: 'libs/api/integration/spi',
    });

    assert.deepEqual(errors, [
      'Foreign same-context SPI import: src/core/agent-tools.ts:@shipfox/api-integration-spi',
      'Foreign same-context SPI manifest edge: dependencies',
    ]);
  });

  test('rejects implementation details from DTO roots', () => {
    const errors = auditPolicyFixture({
      dtoRootExportSpecifier: './presentation/client.js',
      importerPath: 'libs/api/workflows-dto',
    });
    assert.deepEqual(errors, ['DTO root exports implementation detail']);
  });
});
