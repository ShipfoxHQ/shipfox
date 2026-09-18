const mocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  list: vi.fn(),
  metrics: vi.fn(),
  promote: vi.fn(),
  release: vi.fn(),
}));

vi.mock('#db/workflow-concurrency.js', () => ({
  listWorkflowConcurrencyRepairCandidates: mocks.list,
  promoteWorkflowConcurrencyWaiter: mocks.promote,
  releaseWorkflowConcurrencyClaimForAttempt: mocks.release,
}));
vi.mock('#db/workflow-runs/run-status.js', () => ({
  cancelWorkflowRunAttemptForConcurrencyWithOutcome: mocks.cancel,
}));
vi.mock('#metrics/instance.js', () => ({
  recordWorkflowConcurrencyRepair: mocks.metrics,
}));

import {runWorkflowConcurrencyReconcilerCycle} from './workflow-concurrency-reconciler.js';

describe('workflow concurrency reconciler', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.release.mockResolvedValue({changed: true, promotedClaim: null});
    mocks.promote.mockResolvedValue({changed: true, promotedClaim: null});
    mocks.cancel.mockResolvedValue({changed: true, run: {}});
    mocks.list.mockResolvedValue({candidates: []});
  });

  test('repairs each bounded drift category and starts acquired pending attempts', async () => {
    const candidates = [
      candidate({claimState: 'acquired', attemptStatus: 'failed', runStatus: 'failed'}),
      candidate({claimState: 'waiting', attemptStatus: 'waiting', runStatus: 'waiting'}),
      candidate({claimState: 'superseded', attemptStatus: 'running', runStatus: 'running'}),
      candidate({claimState: 'acquired', attemptStatus: 'pending', runStatus: 'pending'}),
    ];
    mocks.list.mockResolvedValue({candidates});
    const starts: unknown[] = [];

    const repaired = await runWorkflowConcurrencyReconcilerCycle({
      batchSize: 4,
      signal: new AbortController().signal,
      startOrchestration: (input) => Promise.resolve(starts.push(input)).then(() => undefined),
    });

    expect(repaired).toBe(true);
    expect(mocks.release).toHaveBeenCalledWith(candidates[0]?.workflowRunAttemptId);
    expect(mocks.promote).toHaveBeenCalledWith(candidates[1]?.claimId);
    expect(mocks.cancel).toHaveBeenCalledWith({
      workflowRunAttemptId: candidates[2]?.workflowRunAttemptId,
    });
    expect(starts).toEqual([
      expect.objectContaining({workflowRunAttemptId: candidates[3]?.workflowRunAttemptId}),
    ]);
    expect(mocks.metrics).toHaveBeenCalledWith('terminal_holder', 'repaired');
    expect(mocks.metrics).toHaveBeenCalledWith('orphaned_group', 'repaired');
    expect(mocks.metrics).toHaveBeenCalledWith('superseded_attempt', 'repaired');
    expect(mocks.metrics).toHaveBeenCalledWith('acquired_without_orchestration', 'repaired');
  });
});

function candidate(input: {
  claimState: 'acquired' | 'waiting' | 'superseded';
  attemptStatus: string;
  runStatus: string;
}) {
  return {
    claimId: crypto.randomUUID(),
    workflowRunId: crypto.randomUUID(),
    workflowRunAttemptId: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    definitionId: crypto.randomUUID(),
    attempt: 1,
    ...input,
  };
}
