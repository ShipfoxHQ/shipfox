import {
  WORKFLOWS_WORKFLOW_CONCURRENCY_ACQUIRED,
  WORKFLOWS_WORKFLOW_RUN_ATTEMPT_CREATED,
} from '@shipfox/api-workflows-dto';
import {and, eq, sql} from 'drizzle-orm';
import {db} from '#db/db.js';
import {workflowsOutbox} from '#db/schema/outbox.js';
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
    const waiter = await admitWorkflowConcurrencyClaim({
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
    const acquiredEvents = await db()
      .select()
      .from(workflowsOutbox)
      .where(eq(workflowsOutbox.eventType, WORKFLOWS_WORKFLOW_CONCURRENCY_ACQUIRED));
    const acquiredEvent = acquiredEvents.find(
      (row) => (row.payload as Record<string, unknown>).claimId === waiter.claim.id,
    );
    const claims = await db()
      .select({id: workflowConcurrencyClaims.id, state: workflowConcurrencyClaims.state})
      .from(workflowConcurrencyClaims)
      .where(eq(workflowConcurrencyClaims.projectId, projectId));

    expect(repaired).toMatchObject({changed: true, promotedClaim: {state: 'acquired'}});
    expect(retry).toEqual({changed: false, promotedClaim: null});
    expect(acquiredEvent?.payload).toEqual({
      projectId,
      claimId: waiter.claim.id,
      workflowRunId: waiterRun.id,
      workflowRunAttemptId: waiter.claim.workflowRunAttemptId,
    });
    expect(claims).toEqual(
      expect.arrayContaining([
        {id: holder.claim.id, state: 'released'},
        {id: repaired.promotedClaim?.id, state: 'acquired'},
      ]),
    );
  });

  test('releases a terminal waiter without disturbing the holder', async () => {
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
      concurrency: {group: 'terminal-waiter', scope: 'workflow', cancelInProgress: false},
    });
    const waiter = await admitWorkflowConcurrencyClaim({
      workflowRunId: waiterRun.id,
      workflowRunAttemptId: waiterAttempt,
      concurrency: {group: 'terminal-waiter', scope: 'workflow', cancelInProgress: false},
    });

    const finishedAt = new Date();
    await db()
      .update(workflowRunAttempts)
      .set({status: 'cancelled', finishedAt})
      .where(eq(workflowRunAttempts.id, waiterAttempt));
    await db()
      .update(workflowRuns)
      .set({status: 'cancelled', finishedAt})
      .where(eq(workflowRuns.id, waiterRun.id));

    const repaired = await releaseWorkflowConcurrencyClaimForAttempt(waiterAttempt);
    const claims = await db()
      .select({id: workflowConcurrencyClaims.id, state: workflowConcurrencyClaims.state})
      .from(workflowConcurrencyClaims)
      .where(eq(workflowConcurrencyClaims.projectId, projectId));

    expect(repaired).toEqual({changed: true, promotedClaim: null});
    expect(claims).toEqual(
      expect.arrayContaining([
        {id: holder.claim.id, state: 'acquired'},
        {id: waiter.claim.id, state: 'released'},
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
    const acquiredEvents = await db()
      .select()
      .from(workflowsOutbox)
      .where(eq(workflowsOutbox.eventType, WORKFLOWS_WORKFLOW_CONCURRENCY_ACQUIRED));
    const acquiredEvent = acquiredEvents.find(
      (row) => (row.payload as Record<string, unknown>).claimId === waiter.claim.id,
    );

    expect(repaired).toMatchObject({
      changed: true,
      promotedClaim: {id: waiter.claim.id, state: 'acquired'},
    });
    expect(retry).toEqual({changed: false, promotedClaim: null});
    expect(acquiredEvent?.payload).toEqual({
      projectId,
      claimId: waiter.claim.id,
      workflowRunId: waiterRun.id,
      workflowRunAttemptId: waiter.claim.workflowRunAttemptId,
    });
  });

  test('lists superseded non-terminal and acquired-pending repair candidates', async () => {
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
    const params = (index: number, group: string) => ({
      workflowRunId: runs[index]?.id ?? '',
      workflowRunAttemptId: attemptIds[index] ?? '',
      concurrency: {group, scope: 'workflow' as const, cancelInProgress: false},
    });

    await admitWorkflowConcurrencyClaim(params(0, 'superseded'));
    const superseded = await admitWorkflowConcurrencyClaim(params(1, 'superseded'));
    await admitWorkflowConcurrencyClaim(params(2, 'superseded'));
    const acquiredPending = await admitWorkflowConcurrencyClaim(params(3, 'acquired-pending'));
    await markAttemptCreatedEventDispatched(acquiredPending.claim.workflowRunAttemptId);

    const page = await listWorkflowConcurrencyRepairCandidates(100);

    expect(page.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          claimId: superseded.claim.id,
          claimState: 'superseded',
          attemptStatus: 'pending',
          runStatus: 'pending',
        }),
        expect.objectContaining({
          claimId: acquiredPending.claim.id,
          claimState: 'acquired',
          attemptStatus: 'pending',
          runStatus: 'pending',
        }),
      ]),
    );
  });

  test('waits for the normal attempt-created delivery before repairing orchestration', async () => {
    const run = await workflowRunFactory.create();
    const [attempt] = await db()
      .select({id: workflowRunAttempts.id})
      .from(workflowRunAttempts)
      .where(eq(workflowRunAttempts.workflowRunId, run.id));
    const admitted = await admitWorkflowConcurrencyClaim({
      workflowRunId: run.id,
      workflowRunAttemptId: attempt?.id ?? '',
      concurrency: {group: 'pending-start', scope: 'workflow', cancelInProgress: false},
    });

    const beforeDispatch = await listWorkflowConcurrencyRepairCandidates(100);
    expect(beforeDispatch.candidates).not.toEqual(
      expect.arrayContaining([expect.objectContaining({claimId: admitted.claim.id})]),
    );

    await markAttemptCreatedEventDispatched(admitted.claim.workflowRunAttemptId);
    const afterDispatch = await listWorkflowConcurrencyRepairCandidates(100);
    expect(afterDispatch.candidates).toEqual(
      expect.arrayContaining([expect.objectContaining({claimId: admitted.claim.id})]),
    );
  });

  test('reconstructs failed-rerun session carry-over for orchestration repair', async () => {
    const run = await workflowRunFactory.create();
    const [sourceAttempt] = await db()
      .select()
      .from(workflowRunAttempts)
      .where(eq(workflowRunAttempts.workflowRunId, run.id));
    if (!sourceAttempt) throw new Error('Expected source attempt');
    const finishedAt = new Date();
    await db()
      .update(workflowRunAttempts)
      .set({status: 'failed', finishedAt})
      .where(eq(workflowRunAttempts.id, sourceAttempt.id));
    await db()
      .update(workflowRuns)
      .set({status: 'pending', currentAttempt: 2, finishedAt: null})
      .where(eq(workflowRuns.id, run.id));
    const [rerunAttempt] = await db()
      .insert(workflowRunAttempts)
      .values({workflowRunId: run.id, attempt: 2, rerunMode: 'failed'})
      .returning({id: workflowRunAttempts.id});
    if (!rerunAttempt) throw new Error('Expected rerun attempt');
    const admitted = await admitWorkflowConcurrencyClaim({
      workflowRunId: run.id,
      workflowRunAttemptId: rerunAttempt.id,
      concurrency: {group: 'failed-rerun-start', scope: 'workflow', cancelInProgress: false},
    });

    const page = await listWorkflowConcurrencyRepairCandidates(100);
    expect(page.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          claimId: admitted.claim.id,
          carryOverFromWorkflowRunAttemptId: sourceAttempt.id,
        }),
      ]),
    );
  });

  test('restarts a promoted attempt that remains waiting', async () => {
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
    await admitWorkflowConcurrencyClaim({
      workflowRunId: holderRun.id,
      workflowRunAttemptId: holderAttempt,
      concurrency: {group: 'promoted-start', scope: 'workflow', cancelInProgress: false},
    });
    const waiter = await admitWorkflowConcurrencyClaim({
      workflowRunId: waiterRun.id,
      workflowRunAttemptId: waiterAttempt,
      concurrency: {group: 'promoted-start', scope: 'workflow', cancelInProgress: false},
    });
    await db()
      .update(workflowRunAttempts)
      .set({status: 'waiting'})
      .where(eq(workflowRunAttempts.id, waiterAttempt));
    await db()
      .update(workflowRuns)
      .set({status: 'waiting'})
      .where(eq(workflowRuns.id, waiterRun.id));
    await markAttemptCreatedEventDispatched(waiterAttempt);
    const finishedAt = new Date();
    await db()
      .update(workflowRunAttempts)
      .set({status: 'succeeded', finishedAt})
      .where(eq(workflowRunAttempts.id, holderAttempt));
    await db()
      .update(workflowRuns)
      .set({status: 'succeeded', finishedAt})
      .where(eq(workflowRuns.id, holderRun.id));
    await releaseWorkflowConcurrencyClaimForAttempt(holderAttempt);

    const page = await listWorkflowConcurrencyRepairCandidates(100);
    expect(page.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          claimId: waiter.claim.id,
          claimState: 'acquired',
          attemptStatus: 'waiting',
        }),
      ]),
    );
  });

  test('keeps a repair page bounded and deterministic', async () => {
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
    const params = (index: number, group: string) => ({
      workflowRunId: runs[index]?.id ?? '',
      workflowRunAttemptId: attemptIds[index] ?? '',
      concurrency: {group, scope: 'workflow' as const, cancelInProgress: false},
    });
    const first = await admitWorkflowConcurrencyClaim(params(0, 'page-first'));
    const second = await admitWorkflowConcurrencyClaim(params(1, 'page-second'));
    const third = await admitWorkflowConcurrencyClaim(params(2, 'page-third'));
    await Promise.all(
      [first, second, third].map((result) =>
        markAttemptCreatedEventDispatched(result.claim.workflowRunAttemptId),
      ),
    );

    await db()
      .update(workflowConcurrencyClaims)
      .set({updatedAt: new Date('2000-01-01T00:00:00.000Z')})
      .where(eq(workflowConcurrencyClaims.id, first.claim.id));
    await db()
      .update(workflowConcurrencyClaims)
      .set({updatedAt: new Date('2000-01-02T00:00:00.000Z')})
      .where(eq(workflowConcurrencyClaims.id, second.claim.id));
    await db()
      .update(workflowConcurrencyClaims)
      .set({updatedAt: new Date('2000-01-03T00:00:00.000Z')})
      .where(eq(workflowConcurrencyClaims.id, third.claim.id));

    const page = await listWorkflowConcurrencyRepairCandidates(2);

    expect(page.candidates).toHaveLength(2);
    expect(page.candidates.map((candidate) => candidate.claimId)).toEqual([
      first.claim.id,
      second.claim.id,
    ]);
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

async function markAttemptCreatedEventDispatched(workflowRunAttemptId: string): Promise<void> {
  await db()
    .update(workflowsOutbox)
    .set({dispatchedAt: new Date()})
    .where(
      and(
        eq(workflowsOutbox.eventType, WORKFLOWS_WORKFLOW_RUN_ATTEMPT_CREATED),
        sql`${workflowsOutbox.payload} ->> 'workflowRunAttemptId' = ${workflowRunAttemptId}`,
      ),
    );
}
