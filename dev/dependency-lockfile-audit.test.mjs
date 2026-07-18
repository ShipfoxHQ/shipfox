import assert from 'node:assert/strict';
import {describe, test} from 'node:test';
import {
  auditDependencyGraph,
  formatAuditResult,
  resolveLockfileVersions,
} from './dependency-lockfile-audit.mjs';

const workspaceWithoutOverrides = 'catalog: {}\noverrides: {}\n';
const singletonWorkspace = `
catalog:
  fixture-singleton: ^2.0.0
overrides:
  fixture-singleton: "catalog:"
`;

function lockfile(...snapshotKeys) {
  const snapshots = snapshotKeys.map((key) => `  ${JSON.stringify(key)}: {}`).join('\n');
  return `lockfileVersion: '9.0'\nsnapshots:\n${snapshots}\n`;
}

describe('resolveLockfileVersions', () => {
  test('normalizes peer contexts and sorts the report', () => {
    const lockfileText = lockfile(
      'peer-host@2.0.0',
      '@fixture/peer-aware@1.2.3(peer-host@2.0.0)',
      'peer-host@1.0.0',
      '@fixture/peer-aware@1.2.3(peer-host@1.0.0)',
    );

    const resolutions = resolveLockfileVersions(lockfileText);

    assert.deepEqual(resolutions, [
      {package: '@fixture/peer-aware', versions: ['1.2.3']},
      {package: 'peer-host', versions: ['1.0.0', '2.0.0']},
    ]);
  });
});

describe('auditDependencyGraph', () => {
  test('reports ordinary duplicates without failing the audit', () => {
    const result = auditDependencyGraph({
      lockfileText: lockfile('duplicate-package@1.0.0', 'duplicate-package@2.0.0'),
      workspaceText: workspaceWithoutOverrides,
    });

    const summary = formatAuditResult(result);
    const verboseReport = formatAuditResult(result, {verbose: true});

    assert.deepEqual(result.errors, []);
    assert.equal(summary.includes('duplicate-package: 1.0.0, 2.0.0'), false);
    assert.equal(verboseReport.includes('duplicate-package: 1.0.0, 2.0.0'), true);
  });

  test('accepts a catalog-backed curated singleton', () => {
    const result = auditDependencyGraph({
      lockfileText: lockfile('fixture-singleton@2.0.0'),
      workspaceText: singletonWorkspace,
    });

    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.curatedSingletons, [
      {package: 'fixture-singleton', versions: ['2.0.0']},
    ]);
  });

  test('rejects multiple versions of a curated singleton', () => {
    const result = auditDependencyGraph({
      lockfileText: lockfile('fixture-singleton@1.0.0', 'fixture-singleton@2.0.0'),
      workspaceText: singletonWorkspace,
    });

    assert.deepEqual(result.errors, [
      'Curated singleton fixture-singleton must resolve once; observed 1.0.0, 2.0.0',
    ]);
  });

  test('rejects a curated singleton override outside a catalog', () => {
    const workspaceText = `
catalog:
  fixture-singleton: ^2.0.0
overrides:
  fixture-singleton: ^2.0.0
`;

    const result = auditDependencyGraph({
      lockfileText: lockfile('fixture-singleton@2.0.0'),
      workspaceText,
    });

    assert.deepEqual(result.errors, [
      'Curated singleton fixture-singleton override must reference a catalog',
    ]);
  });
});
