import assert from 'node:assert/strict';
import {
  auditApiDatabaseBoundaries,
  type DatabaseBoundaryFinding,
  databaseBoundaryBaseline,
  reconcileDatabaseBoundaryBaseline,
} from '../src/api-database-boundaries.js';

describe('database boundary verifier', () => {
  test('keeps the current repository findings as exact, issue-owned baseline entries', async () => {
    const findings = await auditApiDatabaseBoundaries();
    const reconciliation = reconcileDatabaseBoundaryBaseline(findings);
    assert.deepEqual(reconciliation.newFindings, []);
    assert.deepEqual(reconciliation.disappearedBaselineEntries, []);
    assert.equal(reconciliation.knownBaselineFindings.length, databaseBoundaryBaseline.length);
    assert.ok(databaseBoundaryBaseline.every((entry) => !entry.file.includes('*')));
    assert.ok(databaseBoundaryBaseline.every((entry) => !entry.object.includes('*')));
    assert.deepEqual(new Set(findings.map((finding) => finding.rule)), new Set());
  });
  test('fails closed when a finding is new or a baseline entry disappears', () => {
    const firstBaseline = {
      owner: 'test',
      namespace: 'test',
      file: 'test.ts',
      line: 1,
      object: 'test',
      rule: 'unprefixed-table',
      suggestedBoundary: "Use the test owner's test schema factory and producer-owned boundary.",
      trackingIssue: 'TEST-1',
      removalCondition: 'Test baseline entry is removed.',
    } satisfies (typeof databaseBoundaryBaseline)[number];
    const secondBaseline = {...firstBaseline, line: 2, object: 'test_second'};
    const known: DatabaseBoundaryFinding = {
      owner: firstBaseline.owner,
      namespace: firstBaseline.namespace,
      file: firstBaseline.file,
      line: firstBaseline.line,
      object: firstBaseline.object,
      rule: firstBaseline.rule,
      suggestedBoundary: firstBaseline.suggestedBoundary,
    };
    const disappeared = {...secondBaseline};
    const reconciliation = reconcileDatabaseBoundaryBaseline([known], [firstBaseline, disappeared]);
    assert.deepEqual(reconciliation.knownBaselineFindings, [known]);
    assert.deepEqual(reconciliation.newFindings, []);
    assert.deepEqual(reconciliation.disappearedBaselineEntries, [disappeared]);
    const newFinding = {...known, object: `${known.object}_new`};
    const newResult = reconcileDatabaseBoundaryBaseline([newFinding], [firstBaseline]);
    assert.deepEqual(newResult.knownBaselineFindings, []);
    assert.deepEqual(newResult.newFindings, [newFinding]);
  });
});
