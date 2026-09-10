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

  test('rejects an empty or oversized UTF-8 display group', () => {
    expect(() => canonicalizeWorkflowConcurrencyGroup('   ')).toThrow(
      InvalidWorkflowConcurrencyGroupError,
    );
    expect(() => canonicalizeWorkflowConcurrencyGroup('🙂'.repeat(65))).toThrow(
      InvalidWorkflowConcurrencyGroupError,
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
      nextWorkflowConcurrencyAdmission({hasAcquiredClaim: true, hasWaitingClaim: false}),
    ).toEqual({state: 'waiting', supersedesWaiter: false});
    expect(
      nextWorkflowConcurrencyAdmission({hasAcquiredClaim: true, hasWaitingClaim: true}),
    ).toEqual({state: 'waiting', supersedesWaiter: true});
  });
});
