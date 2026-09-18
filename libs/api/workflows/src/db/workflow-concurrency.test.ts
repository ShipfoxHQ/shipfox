import {and, eq} from 'drizzle-orm';
import {db} from '#db/db.js';
import {workflowRunAttempts} from '#db/schema/workflow-run-attempts.js';
import * as workflowMetrics from '#metrics/instance.js';
import {workflowRunFactory} from '#test/factories/workflow-run.js';
import {workflowConcurrencyClaims} from './schema/workflow-concurrency-claims.js';
import {workflowRuns} from './schema/workflow-runs.js';
import {
  admitWorkflowConcurrencyClaim,
  listWorkflowConcurrencyRepairCandidates,
  promoteWorkflowConcurrencyWaiter,
  releaseWorkflowConcurrencyClaimForAttempt,
} from './workflow-concurrency.js';
import {listWorkflowRunConcurrencyByAttemptIds} from './workflow-runs/concurrency.js';

describe('workflow concurrency claims', () => {
  test('releases a terminal holder, promotes its waiter, and is idempotent', async () => {
    const projectId = crypto.randomUUID();
    const definitionId = crypto.randomUUID();
    const [holderRun, waiterRun] = await Promise.all([
      workflowRunFactory.create({projectId, definitionId}),
      workflowRunFactory.create({projectId, definitionId}),
    ]);
    const [holderAttempt = '', waiterAttempt = ''] = await Promise.all(
      [holderRun.id, waiterRun.id].map(async (workflowRunId) => {
        const [attempt] = await db()
          .select({id: workflowRunAttempts.id})
          .from(workflowRunAttempts)
          .where(eq(workflowRunAttempts.workflowRunId, workflowRunId));
        return attempt?.id ?? '';
      }),
    );
    const holder = await admitWorkflowConcurrencyClaim({
      workflowRunId: holderRun.id,
      workflowRunAttemptId: holderAttempt,
      concurrency: {group: 'repair', scope: 'workflow', cancelInProgress: false},
    });
    await admitWorkflowConcurrencyClaim({
      workflowRunId: waiterRun.id,
      workflowRunAttemptId: waiterAttempt,
      concurrency: {group: 'repair', scope: 'workflow', cancelInProgress: false},
    });

    const finishedAt = new Date();
    await db()
      .update(workflowRunAttempts)
      .set({status: 'succeeded', finishedAt})
      .where(eq(workflowRunAttempts.id, holderAttempt));
    await db()
      .update(workflowRuns)
      .set({status: 'succeeded', finishedAt})
      .where(eq(workflowRuns.id, holderRun.id));

    const repaired = await releaseWorkflowConcurrencyClaimForAttempt(holderAttempt);
    const retry = await releaseWorkflowConcurrencyClaimForAttempt(holderAttempt);
    const claims = await db()
      .select({id: workflowConcurrencyClaims.id, state: workflowConcurrencyClaims.state})
      .from(workflowConcurrencyClaims)
      .where(eq(workflowConcurrencyClaims.projectId, projectId));

    expect(repaired).toMatchObject({changed: true, promotedClaim: {state: 'acquired'}});
    expect(retry).toEqual({changed: false, promotedClaim: null});
    expect(claims).toEqual(
      expect.arrayContaining([
        {id: holder.claim.id, state: 'released'},
        {id: repaired.promotedClaim?.id, state: 'acquired'},
      ]),
    );
  });

  test('promotes an orphaned waiter and is idempotent', async () => {
    const projectId = crypto.randomUUID();
    const definitionId = crypto.randomUUID();
    const [holderRun, waiterRun] = await Promise.all([
      workflowRunFactory.create({projectId, definitionId}),
      workflowRunFactory.create({projectId, definitionId}),
    ]);
    const attemptId = async (workflowRunId: string) => {
      const [attempt] = await db()
        .select({id: workflowRunAttempts.id})
        .from(workflowRunAttempts)
        .where(eq(workflowRunAttempts.workflowRunId, workflowRunId));
      return attempt?.id ?? '';
    };
    const holder = await admitWorkflowConcurrencyClaim({
      workflowRunId: holderRun.id,
      workflowRunAttemptId: await attemptId(holderRun.id),
      concurrency: {group: 'orphan', scope: 'workflow', cancelInProgress: false},
    });
    const waiter = await admitWorkflowConcurrencyClaim({
      workflowRunId: waiterRun.id,
      workflowRunAttemptId: await attemptId(waiterRun.id),
      concurrency: {group: 'orphan', scope: 'workflow', cancelInProgress: false},
    });
    const now = new Date();
    await db()
      .update(workflowConcurrencyClaims)
      .set({state: 'released', releasedAt: now, stateChangedAt: now, updatedAt: now})
      .where(eq(workflowConcurrencyClaims.id, holder.claim.id));

    const repaired = await promoteWorkflowConcurrencyWaiter(waiter.claim.id);
    const retry = await promoteWorkflowConcurrencyWaiter(waiter.claim.id);

    expect(repaired).toMatchObject({
      changed: true,
      promotedClaim: {id: waiter.claim.id, state: 'acquired'},
    });
    expect(retry).toEqual({changed: false, promotedClaim: null});
  });

  test('keeps a repair page bounded', async () => {
    const page = await listWorkflowConcurrencyRepairCandidates(1);

    expect(page.candidates.length).toBeLessThanOrEqual(1);
  });

  test('records committed admission metrics and ignores a caller-owned rollback', async () => {
    const outcomeMetric = vi.spyOn(workflowMetrics, 'recordWorkflowConcurrencyClaimOutcome');
    const supersededMetric = vi.spyOn(workflowMetrics, 'recordWorkflowConcurrencyWaiterSuperseded');
    const projectId = crypto.randomUUID();
    const definitionId = crypto.randomUUID();
    const runs = await Promise.all(
      Array.from({length: 4}, () => workflowRunFactory.create({projectId, definitionId})),
    );
    const attemptIds = await Promise.all(
      runs.map(async (run) => {
        const [attempt] = await db()
          .select({id: workflowRunAttempts.id})
          .from(workflowRunAttempts)
          .where(eq(workflowRunAttempts.workflowRunId, run.id));
        return attempt?.id ?? '';
      }),
    );
    const params = (index: number) => ({
      workflowRunId: runs[index]?.id ?? '',
      workflowRunAttemptId: attemptIds[index] ?? '',
      concurrency: {group: 'deploy', scope: 'workflow' as const, cancelInProgress: false},
    });

    await admitWorkflowConcurrencyClaim(params(0));
    await admitWorkflowConcurrencyClaim(params(1));
    await admitWorkflowConcurrencyClaim(params(2));
    const transaction = db().transaction(async (tx) => {
      await admitWorkflowConcurrencyClaim({...params(3), tx});
      throw new Error('roll back admission');
    });
    await expect(transaction).rejects.toThrow('roll back admission');

    expect(outcomeMetric.mock.calls).toEqual([['acquired'], ['waiting'], ['waiting']]);
    expect(supersededMetric).toHaveBeenCalledTimes(1);

    const claims = await db()
      .select()
      .from(workflowConcurrencyClaims)
      .where(eq(workflowConcurrencyClaims.projectId, projectId));
    expect(claims).toHaveLength(3);
    expect(claims.some((claim) => claim.workflowRunId === runs[3]?.id)).toBe(false);
    expect(claims.find((claim) => claim.workflowRunId === runs[2]?.id)).toMatchObject({
      state: 'waiting',
      supersededByClaimId: null,
    });
  });

  test('serializes concurrent admissions to one holder and one waiter', async () => {
    const projectId = crypto.randomUUID();
    const definitionId = crypto.randomUUID();
    const runs = await Promise.all([
      workflowRunFactory.create({projectId, definitionId}),
      workflowRunFactory.create({projectId, definitionId}),
    ]);
    const attemptRows = await db()
      .select({workflowRunId: workflowRunAttempts.workflowRunId, id: workflowRunAttempts.id})
      .from(workflowRunAttempts)
      .where(eq(workflowRunAttempts.workflowRunId, runs[0].id));
    const secondAttemptRows = await db()
      .select({id: workflowRunAttempts.id})
      .from(workflowRunAttempts)
      .where(eq(workflowRunAttempts.workflowRunId, runs[1].id));
    const results = await Promise.all(
      [attemptRows[0]?.id, secondAttemptRows[0]?.id].map((workflowRunAttemptId, index) =>
        admitWorkflowConcurrencyClaim({
          workflowRunId: runs[index]?.id ?? '',
          workflowRunAttemptId: workflowRunAttemptId ?? '',
          concurrency: {group: ' Deploy ', scope: 'workflow', cancelInProgress: false},
        }),
      ),
    );

    expect(results.map((result) => result.claim.state).sort()).toEqual(['acquired', 'waiting']);
    expect(new Set(results.map((result) => result.claim.generation))).toEqual(new Set([1, 2]));

    const claims = await db()
      .select()
      .from(workflowConcurrencyClaims)
      .where(
        and(
          eq(workflowConcurrencyClaims.projectId, projectId),
          eq(workflowConcurrencyClaims.canonicalGroupKey, 'deploy'),
        ),
      );
    expect(claims.filter((claim) => claim.state === 'acquired')).toHaveLength(1);
    expect(claims.filter((claim) => claim.state === 'waiting')).toHaveLength(1);
  });

  test('supersedes the current waiter and preserves the holder policy', async () => {
    const projectId = crypto.randomUUID();
    const definitionId = crypto.randomUUID();
    const runs = await Promise.all(
      Array.from({length: 4}, () => workflowRunFactory.create({projectId, definitionId})),
    );
    const attempts = await db()
      .select({workflowRunId: workflowRunAttempts.workflowRunId, id: workflowRunAttempts.id})
      .from(workflowRunAttempts)
      .where(eq(workflowRunAttempts.workflowRunId, runs[0]?.id ?? ''));
    const attemptIds = await Promise.all(
      runs.map(async (run) => {
        const [attempt] = await db()
          .select({id: workflowRunAttempts.id})
          .from(workflowRunAttempts)
          .where(eq(workflowRunAttempts.workflowRunId, run.id));
        return attempt?.id ?? '';
      }),
    );
    expect(attempts).toHaveLength(1);

    const params = (index: number, cancelInProgress: boolean) => ({
      workflowRunId: runs[index]?.id ?? '',
      workflowRunAttemptId: attemptIds[index] ?? '',
      concurrency: {group: 'deploy', scope: 'workflow' as const, cancelInProgress},
    });

    const holder = await admitWorkflowConcurrencyClaim(params(0, false));
    const waiter = await admitWorkflowConcurrencyClaim(params(1, false));
    const replacement = await admitWorkflowConcurrencyClaim(params(2, true));
    const laterFalseReplacement = await admitWorkflowConcurrencyClaim(params(3, false));

    expect(holder.claim.state).toBe('acquired');
    expect(waiter.claim.state).toBe('waiting');
    expect(replacement.claim.state).toBe('waiting');
    expect(replacement.supersededClaim?.id).toBe(waiter.claim.id);
    expect(replacement.holderCancellationRequested).toBe(true);
    expect(laterFalseReplacement.holderCancellationRequested).toBe(true);
    expect(laterFalseReplacement.holderCancellationJustRequested).toBe(false);

    const [storedHolder] = await db()
      .select()
      .from(workflowConcurrencyClaims)
      .where(eq(workflowConcurrencyClaims.id, holder.claim.id));
    expect(replacement.holderClaim).toMatchObject({
      cancellationRequestedAt: storedHolder?.cancellationRequestedAt,
      updatedAt: storedHolder?.updatedAt,
    });
    expect(storedHolder?.cancellationRequestedAt).not.toBeNull();
    expect(storedHolder?.cancellationRequestedAt).toEqual(storedHolder?.updatedAt);
    expect(storedHolder?.cancelInProgress).toBe(false);

    const storedWaiters = await db()
      .select()
      .from(workflowConcurrencyClaims)
      .where(
        and(
          eq(workflowConcurrencyClaims.projectId, projectId),
          eq(workflowConcurrencyClaims.canonicalGroupKey, 'deploy'),
        ),
      );
    expect(storedWaiters.filter((claim) => claim.state === 'waiting')).toHaveLength(1);
    expect(storedWaiters.find((claim) => claim.id === waiter.claim.id)?.state).toBe('superseded');
  });

  test('reads current, waiting, and retained superseded claim relationships', async () => {
    const projectId = crypto.randomUUID();
    const definitionId = crypto.randomUUID();
    const runs = await Promise.all(
      Array.from({length: 3}, () => workflowRunFactory.create({projectId, definitionId})),
    );
    const attemptIds = await Promise.all(
      runs.map(async (run) => {
        const [attempt] = await db()
          .select({id: workflowRunAttempts.id})
          .from(workflowRunAttempts)
          .where(eq(workflowRunAttempts.workflowRunId, run.id));
        return attempt?.id ?? '';
      }),
    );

    const params = (index: number, cancelInProgress: boolean) => ({
      workflowRunId: runs[index]?.id ?? '',
      workflowRunAttemptId: attemptIds[index] ?? '',
      concurrency: {group: 'deploy', scope: 'workflow' as const, cancelInProgress},
    });
    await admitWorkflowConcurrencyClaim(params(0, false));
    await admitWorkflowConcurrencyClaim(params(1, false));
    await admitWorkflowConcurrencyClaim(params(2, true));

    const reads = await listWorkflowRunConcurrencyByAttemptIds(attemptIds);
    expect(reads.get(attemptIds[0] ?? '')).toMatchObject({
      displayGroup: 'deploy',
      scope: 'workflow',
      state: 'acquired',
      generation: 1,
      cancelInProgress: false,
      affectedAttempts: [{workflowRunId: runs[2]?.id, workflowRunAttemptId: attemptIds[2]}],
    });
    expect(reads.get(attemptIds[1] ?? '')).toMatchObject({
      state: 'superseded',
      generation: 2,
      affectedAttempts: [{workflowRunId: runs[2]?.id, workflowRunAttemptId: attemptIds[2]}],
    });
    expect(reads.get(attemptIds[2] ?? '')).toMatchObject({
      state: 'waiting',
      generation: 3,
      cancelInProgress: true,
      affectedAttempts: [{workflowRunId: runs[0]?.id, workflowRunAttemptId: attemptIds[0]}],
    });
  });

  test('rejects an attempt from another run', async () => {
    const [firstRun, secondRun] = await Promise.all([
      workflowRunFactory.create(),
      workflowRunFactory.create(),
    ]);
    const [secondAttempt] = await db()
      .select({id: workflowRunAttempts.id})
      .from(workflowRunAttempts)
      .where(eq(workflowRunAttempts.workflowRunId, secondRun.id));

    const admission = admitWorkflowConcurrencyClaim({
      workflowRunId: firstRun.id,
      workflowRunAttemptId: secondAttempt?.id ?? '',
      concurrency: {group: 'deploy', scope: 'workflow', cancelInProgress: false},
    });

    await expect(admission).rejects.toThrow('does not belong to run');
  });
});
