import {
  canonicalizeWorkflowConcurrencyGroup,
  InvalidWorkflowConcurrencyGroupError,
  nextWorkflowConcurrencyAdmission,
  workflowConcurrencyIdentity,
  workflowConcurrencyOriginScope,
} from './workflow-concurrency.js';

describe('workflow concurrency identity', () => {
  test('trims display text and applies Unicode case folding without normalization', () => {
    expect(canonicalizeWorkflowConcurrencyGroup('  Straße  ')).toEqual({
      displayGroup: 'Straße',
      canonicalGroupKey: 'strasse',
    });
    expect(canonicalizeWorkflowConcurrencyGroup('e\u0301')).toEqual({
      displayGroup: 'e\u0301',
      canonicalGroupKey: 'e\u0301',
    });
    expect(canonicalizeWorkflowConcurrencyGroup('é')).toEqual({
      displayGroup: 'é',
      canonicalGroupKey: 'é',
    });
  });

  test('covers omitted lowercase and uppercase full-fold mappings', () => {
    expect(canonicalizeWorkflowConcurrencyGroup('\u1e96').canonicalGroupKey).toBe(
      canonicalizeWorkflowConcurrencyGroup('h\u0331').canonicalGroupKey,
    );
    expect(canonicalizeWorkflowConcurrencyGroup('\u1e9e').canonicalGroupKey).toBe(
      canonicalizeWorkflowConcurrencyGroup('ss').canonicalGroupKey,
    );
    expect(canonicalizeWorkflowConcurrencyGroup('\u1f88').canonicalGroupKey).toBe(
      canonicalizeWorkflowConcurrencyGroup('\u1f00\u03b9').canonicalGroupKey,
    );
    expect(
      ['\u03f2', '\u03a3', '\u03c2'].map(
        (group) => canonicalizeWorkflowConcurrencyGroup(group).canonicalGroupKey,
      ),
    ).toEqual(['\u03c3', '\u03c3', '\u03c3']);
    expect(
      ['\u03f4', '\u03d1', '\u03b8'].map(
        (group) => canonicalizeWorkflowConcurrencyGroup(group).canonicalGroupKey,
      ),
    ).toEqual(['\u03b8', '\u03b8', '\u03b8']);
  });

  test('rejects an empty or oversized UTF-8 display group', () => {
    expect(() => canonicalizeWorkflowConcurrencyGroup('   ')).toThrow(
      InvalidWorkflowConcurrencyGroupError,
    );
    expect(() => canonicalizeWorkflowConcurrencyGroup('🙂'.repeat(65))).toThrow(
      InvalidWorkflowConcurrencyGroupError,
    );
  });

  test('rejects a NUL-containing display group', () => {
    expect(() => canonicalizeWorkflowConcurrencyGroup('deploy\u0000')).toThrow(
      InvalidWorkflowConcurrencyGroupError,
    );
    expect(() => canonicalizeWorkflowConcurrencyGroup('deploy\u0000')).toThrow(
      'Concurrency group cannot contain a NUL character.',
    );
  });

  test('isolates origin and scope in the effective identity', () => {
    const workflowIdentity = workflowConcurrencyIdentity({
      projectId: 'project',
      definitionId: 'definition-a',
      originScope: 'synced',
      concurrency: {displayGroup: 'deploy', canonicalGroupKey: 'deploy', scope: 'workflow'},
    });
    const projectIdentity = workflowConcurrencyIdentity({
      projectId: 'project',
      definitionId: 'definition-a',
      originScope: 'synced',
      concurrency: {displayGroup: 'deploy', canonicalGroupKey: 'deploy', scope: 'project'},
    });

    expect(workflowIdentity.definitionId).toBe('definition-a');
    expect(projectIdentity.definitionId).toBeNull();
    expect(workflowConcurrencyOriginScope({origin: 'dev', initiatedByUserId: 'user-a'})).toBe(
      'dev:user-a',
    );
    expect(workflowConcurrencyOriginScope({origin: 'synced'})).toBe('synced');
  });
});

describe('workflow concurrency admission state machine', () => {
  test('selects one holder and one latest waiter', () => {
    expect(
      nextWorkflowConcurrencyAdmission({hasAcquiredClaim: false, hasWaitingClaim: false}),
    ).toEqual({state: 'acquired', supersedesWaiter: false});
    expect(
      nextWorkflowConcurrencyAdmission({hasAcquiredClaim: false, hasWaitingClaim: true}),
    ).toEqual({state: 'acquired', supersedesWaiter: true});
    expect(
      nextWorkflowConcurrencyAdmission({hasAcquiredClaim: true, hasWaitingClaim: false}),
    ).toEqual({state: 'waiting', supersedesWaiter: false});
    expect(
      nextWorkflowConcurrencyAdmission({hasAcquiredClaim: true, hasWaitingClaim: true}),
    ).toEqual({state: 'waiting', supersedesWaiter: true});
  });
});
