import {and, eq} from 'drizzle-orm';
import {db} from '#db/index.js';
import {workflowRunAttempts} from '#db/schema/workflow-run-attempts.js';
import {workflowRunFactory} from '#test/factories/workflow-run.js';
import {workflowConcurrencyClaims} from './schema/workflow-concurrency-claims.js';
import {admitWorkflowConcurrencyClaim} from './workflow-concurrency.js';

describe('workflow concurrency claims', () => {
  test('serializes concurrent admissions to one holder and one waiter', async () => {
    const runs = await Promise.all([workflowRunFactory.create(), workflowRunFactory.create()]);
    const attemptRows = await db()
      .select({workflowRunId: workflowRunAttempts.workflowRunId, id: workflowRunAttempts.id})
      .from(workflowRunAttempts)
      .where(eq(workflowRunAttempts.workflowRunId, runs[0].id));
    const secondAttemptRows = await db()
      .select({id: workflowRunAttempts.id})
      .from(workflowRunAttempts)
      .where(eq(workflowRunAttempts.workflowRunId, runs[1].id));
    const projectId = '00000000-0000-4000-8000-000000000001';
    const definitionId = '00000000-0000-4000-8000-000000000002';

    const results = await Promise.all(
      [attemptRows[0]?.id, secondAttemptRows[0]?.id].map((workflowRunAttemptId, index) =>
        admitWorkflowConcurrencyClaim({
          projectId,
          definitionId,
          originScope: 'synced',
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
    const runs = await Promise.all([
      workflowRunFactory.create(),
      workflowRunFactory.create(),
      workflowRunFactory.create(),
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
      projectId: '00000000-0000-4000-8000-000000000003',
      definitionId: '00000000-0000-4000-8000-000000000004',
      originScope: 'synced',
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
          eq(workflowConcurrencyClaims.projectId, '00000000-0000-4000-8000-000000000003'),
          eq(workflowConcurrencyClaims.canonicalGroupKey, 'deploy'),
        ),
      );
    expect(storedWaiters.filter((claim) => claim.state === 'waiting')).toHaveLength(1);
    expect(storedWaiters.find((claim) => claim.id === waiter.claim.id)?.state).toBe('superseded');
  });
});
