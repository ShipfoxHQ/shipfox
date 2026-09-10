import {and, eq} from 'drizzle-orm';
import {db} from '#db/db.js';
import {workflowRunAttempts} from '#db/schema/workflow-run-attempts.js';
import * as workflowMetrics from '#metrics/instance.js';
import {workflowRunFactory} from '#test/factories/workflow-run.js';
import {workflowConcurrencyClaims} from './schema/workflow-concurrency-claims.js';
import {admitWorkflowConcurrencyClaim} from './workflow-concurrency.js';

describe('workflow concurrency claims', () => {
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
    const runs = await Promise.all([
      workflowRunFactory.create({projectId, definitionId}),
      workflowRunFactory.create({projectId, definitionId}),
      workflowRunFactory.create({projectId, definitionId}),
    ]);
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

    expect(holder.claim.state).toBe('acquired');
    expect(waiter.claim.state).toBe('waiting');
    expect(replacement.claim.state).toBe('waiting');
    expect(replacement.supersededClaim?.id).toBe(waiter.claim.id);
    expect(replacement.holderCancellationRequested).toBe(true);

    const [storedHolder] = await db()
      .select()
      .from(workflowConcurrencyClaims)
      .where(eq(workflowConcurrencyClaims.id, holder.claim.id));
    expect(storedHolder?.cancellationRequestedAt).not.toBeNull();
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
