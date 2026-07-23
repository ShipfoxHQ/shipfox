import assert from 'node:assert/strict';
import {
  auditApiDatabaseBoundaries,
  type DatabaseBoundaryFinding,
  databaseBoundaryBaseline,
  reconcileDatabaseBoundaryBaseline,
} from '../src/api-database-boundaries.js';

function findingFromBaseline(index: number): DatabaseBoundaryFinding {
  const entry = databaseBoundaryBaseline[index];
  assert.ok(entry);
  return {
    owner: entry.owner,
    namespace: entry.namespace,
    file: entry.file,
    line: entry.line,
    object: entry.object,
    rule: entry.rule,
    suggestedBoundary: entry.suggestedBoundary,
  };
}
describe('database boundary verifier', () => {
  test('keeps the current repository findings as exact, issue-owned baseline entries', async () => {
    const findings = await auditApiDatabaseBoundaries();
    const reconciliation = reconcileDatabaseBoundaryBaseline(findings);
    assert.deepEqual(reconciliation.newFindings, []);
    assert.deepEqual(reconciliation.disappearedBaselineEntries, []);
    assert.equal(reconciliation.knownBaselineFindings.length, databaseBoundaryBaseline.length);
    assert.ok(databaseBoundaryBaseline.every((entry) => !entry.file.includes('*')));
    assert.ok(databaseBoundaryBaseline.every((entry) => !entry.object.includes('*')));
    assert.deepEqual(
      new Set(findings.map((finding) => finding.rule)),
      new Set(['unprefixed-table']),
    );
  });
  test('fails closed when a finding is new or a baseline entry disappears', () => {
    const known = findingFromBaseline(0);
    const firstBaseline = databaseBoundaryBaseline[0];
    const secondBaseline = databaseBoundaryBaseline[1];
    assert.ok(firstBaseline);
    assert.ok(secondBaseline);
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
