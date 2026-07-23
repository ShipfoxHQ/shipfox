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

  test('rejects a new foreign manifest edge and missing DTO inter-module export', () => {
    const manifestErrors = auditPolicyFixture({
      dependencyGroup: 'devDependencies',
      importerPath: 'libs/api/runners',
      targetPath: 'libs/api/auth',
    });
    const dtoErrors = auditPolicyFixture({
      dtoHasInterModuleEntry: false,
      dtoHasInterModuleSource: true,
      importerPath: 'libs/api/projects-dto',
    });

    assert.deepEqual(manifestErrors, ['Foreign implementation manifest edge: devDependencies']);
    assert.deepEqual(dtoErrors, ['DTO inter-module source has no explicit package export']);

    const orphanExportErrors = auditPolicyFixture({
      dtoHasInterModuleEntry: true,
      importerPath: 'libs/api/projects-dto',
    });
    assert.deepEqual(orphanExportErrors, ['DTO inter-module export has no source file']);
  });

  test('validates every workspace dependency group through the shared edge policy', () => {
    const dependencyGroups = [
      'dependencies',
      'devDependencies',
      'optionalDependencies',
      'peerDependencies',
    ] as const;

    for (const dependencyGroup of dependencyGroups) {
      assert.deepEqual(
        auditPolicyFixture({
          dependencyGroup,
          importerPath: 'libs/api/workflows-dto',
          targetPath: 'libs/api/workflows',
        }),
        [`DTO implementation manifest edge: ${dependencyGroup}`],
      );
    }

    assert.deepEqual(
      auditPolicyFixture({
        dependencyGroup: 'dependencies',
        importerPath: 'libs/shared/common/runner-labels',
        targetPath: 'libs/api/runners',
      }),
      ['Shared semantic implementation manifest edge: dependencies'],
    );

    assert.deepEqual(
      auditPolicyFixture({
        dependencyGroup: 'dependencies',
        importerPath: 'libs/api/integration/spi',
        targetPath: 'libs/api/workflows',
      }),
      ['Foreign SPI implementation manifest edge: dependencies'],
    );

    assert.deepEqual(
      auditPolicyFixture({
        dependencyGroup: 'dependencies',
        importerPath: 'libs/api/projects-dto',
        targetPath: 'libs/api/integration/spi',
      }),
      ['DTO SPI manifest edge: dependencies'],
    );

    assert.deepEqual(
      auditPolicyFixture({
        dependencyGroup: 'dependencies',
        importerPath: 'libs/shared/common/runner-labels',
        targetPath: 'libs/api/integration/spi',
      }),
      ['Shared semantic SPI manifest edge: dependencies'],
    );
  });

  test('rejects foreign implementation dependencies on same-context SPIs', () => {
    const errors = auditPolicyFixture({
      dependencyGroup: 'dependencies',
      importerPath: 'libs/api/workflows',
      targetPath: 'libs/api/integration/spi',
    });

    assert.deepEqual(errors, ['Foreign same-context SPI manifest edge: dependencies']);
  });
});
