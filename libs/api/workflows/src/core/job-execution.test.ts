import {WORKFLOWS_JOB_COMPLETED} from '@shipfox/api-workflows-dto';
import {and, eq, sql} from 'drizzle-orm';
import {db} from '#db/db.js';
import {workflowsOutbox} from '#db/schema/outbox.js';
import {stepAttempts as stepAttemptsTable} from '#db/schema/step-attempts.js';
import {steps as stepsTable} from '#db/schema/steps.js';
import {bulkUpdateStepStatuses, getStepAttempts, getStepsByJobId} from '#db/workflow-runs.js';
import {arrangeJobWithSteps} from '#test/fixtures/job-with-steps.js';
import {
  JobNotFoundError,
  StepAttemptAheadError,
  StepNotFoundError,
  StepNotRunningError,
} from './errors.js';
import {nextStepForJob, recordStepResult} from './job-execution.js';

async function jobCompletedEvents(jobId: string): Promise<Array<{status: string}>> {
  const rows = await db()
    .select({payload: workflowsOutbox.payload})
    .from(workflowsOutbox)
    .where(
      and(
        eq(workflowsOutbox.eventType, WORKFLOWS_JOB_COMPLETED),
        sql`${workflowsOutbox.payload}->>'jobId' = ${jobId}`,
      ),
    );
  return rows.map((row) => row.payload as {status: string});
}

describe('nextStepForJob', () => {
  test('returns the lowest-position pending step and marks it running', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(3);

    const result = await nextStepForJob(jobId);

    expect(result).toEqual({kind: 'step', step: expect.objectContaining({id: steps[0]?.id})});
    const after = await getStepsByJobId(jobId);
    expect(after[0]?.status).toBe('running');
    expect(after[1]?.status).toBe('pending');
    expect(after[2]?.status).toBe('pending');
  });

  test('idempotent re-delivery: a second pull returns the same running step', async () => {
    const {jobId} = await arrangeJobWithSteps(3);
    const first = await nextStepForJob(jobId);

    const second = await nextStepForJob(jobId);

    expect(first.kind).toBe('step');
    expect(second.kind).toBe('step');
    const firstId = first.kind === 'step' ? first.step.id : null;
    const secondId = second.kind === 'step' ? second.step.id : null;
    expect(secondId).toBe(firstId);
    const running = (await getStepsByJobId(jobId)).filter((s) => s.status === 'running');
    expect(running).toHaveLength(1);
  });

  test('after a step succeeds, the next pull returns the next pending step', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(3);
    await nextStepForJob(jobId);
    await recordStepResult({jobId, stepId: steps[0]?.id as string, status: 'succeeded'});

    const next = await nextStepForJob(jobId);

    expect(next).toEqual({kind: 'step', step: expect.objectContaining({id: steps[1]?.id})});
  });

  test('all steps succeeded → {done, succeeded}', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(2);
    for (const step of steps) {
      await nextStepForJob(jobId);
      await recordStepResult({jobId, stepId: step.id, status: 'succeeded'});
    }

    const result = await nextStepForJob(jobId);

    expect(result).toEqual({kind: 'done', status: 'succeeded'});
  });

  test('unknown jobId → JobNotFoundError (not a vacuous done)', async () => {
    await expect(nextStepForJob(crypto.randomUUID())).rejects.toBeInstanceOf(JobNotFoundError);
  });

  test('all terminal with a failure → {done, failed}', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(2);
    await nextStepForJob(jobId);
    await recordStepResult({jobId, stepId: steps[0]?.id as string, status: 'failed'});

    const result = await nextStepForJob(jobId);

    expect(result).toEqual({kind: 'done', status: 'failed'});
  });

  test('all cancelled, none failed → {done, failed}', async () => {
    const {jobId} = await arrangeJobWithSteps(2);
    // A cancelled job with no failure must still report 'failed', not a vacuous
    // success.
    await bulkUpdateStepStatuses({jobId, status: 'cancelled'});

    const result = await nextStepForJob(jobId);

    expect(result).toEqual({kind: 'done', status: 'failed'});
  });
});

describe('recordStepResult', () => {
  test('succeeded on a non-final step → {jobFinished:false}', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(2);
    await nextStepForJob(jobId);

    const outcome = await recordStepResult({
      jobId,
      stepId: steps[0]?.id as string,
      status: 'succeeded',
    });

    expect(outcome).toEqual({jobFinished: false});
    expect((await getStepsByJobId(jobId))[0]?.status).toBe('succeeded');
  });

  test('succeeded on the final step → {jobFinished:true, succeeded}', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(1);
    await nextStepForJob(jobId);

    const outcome = await recordStepResult({
      jobId,
      stepId: steps[0]?.id as string,
      status: 'succeeded',
    });

    expect(outcome).toEqual({jobFinished: true, status: 'succeeded'});
  });

  test('failed step → step failed, remaining cancelled, {jobFinished:true, failed}', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(3);
    await nextStepForJob(jobId);

    const outcome = await recordStepResult({
      jobId,
      stepId: steps[0]?.id as string,
      status: 'failed',
      error: {message: 'boom'},
    });

    expect(outcome).toEqual({jobFinished: true, status: 'failed'});
    const after = await getStepsByJobId(jobId);
    expect(after[0]?.status).toBe('failed');
    expect(after[0]?.error).toEqual({message: 'boom'});
    expect(after[1]?.status).toBe('cancelled');
    expect(after[2]?.status).toBe('cancelled');
  });

  test('never downgrades an already-terminal row', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(2);
    await nextStepForJob(jobId);
    await recordStepResult({jobId, stepId: steps[0]?.id as string, status: 'succeeded'});

    // A late 'failed' report for the already-succeeded step must not downgrade it.
    await recordStepResult({jobId, stepId: steps[0]?.id as string, status: 'failed'});

    const after = await getStepsByJobId(jobId);
    expect(after[0]?.status).toBe('succeeded');
    expect(after[1]?.status).toBe('pending');
  });

  test('unknown stepId → StepNotFoundError', async () => {
    const {jobId} = await arrangeJobWithSteps(1);

    await expect(
      recordStepResult({jobId, stepId: crypto.randomUUID(), status: 'succeeded'}),
    ).rejects.toBeInstanceOf(StepNotFoundError);
  });

  test('cross-job stepId → StepNotFoundError', async () => {
    const a = await arrangeJobWithSteps(1);
    const b = await arrangeJobWithSteps(1);

    await expect(
      recordStepResult({jobId: a.jobId, stepId: b.steps[0]?.id as string, status: 'succeeded'}),
    ).rejects.toBeInstanceOf(StepNotFoundError);
  });

  test('result for a pending (never-dispatched) step → StepNotRunningError', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(2);
    // Skip nextStepForJob so the step stays pending (never handed out).

    await expect(
      recordStepResult({jobId, stepId: steps[0]?.id as string, status: 'succeeded'}),
    ).rejects.toBeInstanceOf(StepNotRunningError);
  });

  test('duplicate succeeded report is a no-op', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(2);
    await nextStepForJob(jobId);
    await recordStepResult({jobId, stepId: steps[0]?.id as string, status: 'succeeded'});

    const outcome = await recordStepResult({
      jobId,
      stepId: steps[0]?.id as string,
      status: 'succeeded',
    });

    expect(outcome).toEqual({jobFinished: false});
    const after = await getStepsByJobId(jobId);
    expect(after[0]?.status).toBe('succeeded');
    expect(after[1]?.status).toBe('pending');
  });

  test('duplicate failed report is a no-op and job stays fully terminal', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(3);
    await nextStepForJob(jobId);
    await recordStepResult({jobId, stepId: steps[0]?.id as string, status: 'failed'});

    const outcome = await recordStepResult({
      jobId,
      stepId: steps[0]?.id as string,
      status: 'failed',
    });

    expect(outcome).toEqual({jobFinished: true, status: 'failed'});
    const after = await getStepsByJobId(jobId);
    expect(after[0]?.status).toBe('failed');
    expect(after[1]?.status).toBe('cancelled');
    expect(after[2]?.status).toBe('cancelled');
    expect(await jobCompletedEvents(jobId)).toHaveLength(1);
  });
});

describe('nextStepForJob concurrency', () => {
  test('concurrent pulls return the same step', async () => {
    const {jobId} = await arrangeJobWithSteps(3);

    const [a, b] = await Promise.all([nextStepForJob(jobId), nextStepForJob(jobId)]);

    expect(a.kind).toBe('step');
    expect(b.kind).toBe('step');
    const idA = a.kind === 'step' ? a.step.id : null;
    const idB = b.kind === 'step' ? b.step.id : null;
    expect(idA).toBe(idB);
    const running = (await getStepsByJobId(jobId)).filter((s) => s.status === 'running');
    expect(running).toHaveLength(1);
    // The onConflictDoNothing backstop keeps a single attempt row under contention.
    expect(await getStepAttempts(jobId)).toHaveLength(1);
  });
});

describe('recordStepResult job-completion event', () => {
  test('enqueues exactly one job-completed event when the final step finishes the job', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(1);
    await nextStepForJob(jobId);

    const outcome = await recordStepResult({
      jobId,
      stepId: steps[0]?.id as string,
      status: 'succeeded',
    });

    expect(outcome).toEqual({jobFinished: true, status: 'succeeded'});
    const events = await jobCompletedEvents(jobId);
    expect(events).toHaveLength(1);
    expect(events[0]?.status).toBe('succeeded');
  });

  test('does not enqueue a completion event while steps remain', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(2);
    await nextStepForJob(jobId);

    const outcome = await recordStepResult({
      jobId,
      stepId: steps[0]?.id as string,
      status: 'succeeded',
    });

    expect(outcome).toEqual({jobFinished: false});
    expect(await jobCompletedEvents(jobId)).toHaveLength(0);
  });

  test('a failed final step enqueues one completion event with status failed', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(2);
    await nextStepForJob(jobId);

    await recordStepResult({
      jobId,
      stepId: steps[0]?.id as string,
      status: 'failed',
      error: {message: 'boom'},
    });

    const events = await jobCompletedEvents(jobId);
    expect(events).toHaveLength(1);
    expect(events[0]?.status).toBe('failed');
  });

  test('a duplicate final report does not enqueue a second completion event', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(1);
    await nextStepForJob(jobId);
    await recordStepResult({jobId, stepId: steps[0]?.id as string, status: 'succeeded'});

    const duplicate = await recordStepResult({
      jobId,
      stepId: steps[0]?.id as string,
      status: 'succeeded',
    });

    expect(duplicate).toEqual({jobFinished: true, status: 'succeeded'});
    expect(await jobCompletedEvents(jobId)).toHaveLength(1);
  });

  test('concurrent final reports enqueue exactly one completion event', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(1);
    const stepId = steps[0]?.id as string;
    await nextStepForJob(jobId);

    const outcomes = await Promise.all([
      recordStepResult({jobId, stepId, status: 'succeeded', attempt: 1, exitCode: 0}),
      recordStepResult({jobId, stepId, status: 'succeeded', attempt: 1, exitCode: 0}),
    ]);

    expect(outcomes).toEqual([
      {jobFinished: true, status: 'succeeded'},
      {jobFinished: true, status: 'succeeded'},
    ]);
    expect(await jobCompletedEvents(jobId)).toHaveLength(1);
  });
});

describe('step attempts', () => {
  test('dispatch opens a running attempt row at attempt 1', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(2);

    await nextStepForJob(jobId);

    const attempts = await getStepAttempts(jobId);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({stepId: steps[0]?.id, attempt: 1, status: 'running'});
  });

  test('re-delivery does not open a second attempt row', async () => {
    const {jobId} = await arrangeJobWithSteps(2);

    await nextStepForJob(jobId);
    await nextStepForJob(jobId);

    expect(await getStepAttempts(jobId)).toHaveLength(1);
  });

  test('reporting finalizes the attempt with status and exit code', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(2);
    await nextStepForJob(jobId);

    await recordStepResult({
      jobId,
      stepId: steps[0]?.id as string,
      status: 'succeeded',
      exitCode: 0,
    });

    const attempts = await getStepAttempts(jobId);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({attempt: 1, status: 'succeeded', exitCode: 0, error: null});
    expect(attempts[0]?.finishedAt).not.toBeNull();
    const [step] = await getStepsByJobId(jobId);
    expect(step?.currentAttempt).toBe(attempts[0]?.attempt);
    expect(step?.status).toBe(attempts[0]?.status);
  });

  test('a failed report finalizes the attempt with its error and exit code', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(2);
    await nextStepForJob(jobId);

    await recordStepResult({
      jobId,
      stepId: steps[0]?.id as string,
      status: 'failed',
      error: {message: 'boom'},
      exitCode: 1,
    });

    const [attempt] = await getStepAttempts(jobId);
    expect(attempt).toMatchObject({status: 'failed', exitCode: 1, error: {message: 'boom'}});
  });

  test('reporting creates a missing running attempt before finalization', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(1);
    const stepId = steps[0]?.id as string;
    // Migration boundary: a step may already be running before PR B's attempt
    // rows exist. Reporting should backfill the attempt row and finalize it.
    await db().update(stepsTable).set({status: 'running'}).where(eq(stepsTable.id, stepId));

    const outcome = await recordStepResult({
      jobId,
      stepId,
      status: 'succeeded',
      output: {summary: 'ok'},
      exitCode: 0,
    });

    expect(outcome).toEqual({jobFinished: true, status: 'succeeded'});
    const [attempt] = await getStepAttempts(jobId);
    expect(attempt).toMatchObject({
      stepId,
      attempt: 1,
      status: 'succeeded',
      output: {summary: 'ok'},
      exitCode: 0,
    });
    const [step] = await getStepsByJobId(jobId);
    expect(step?.currentAttempt).toBe(attempt?.attempt);
    expect(step?.status).toBe(attempt?.status);
    expect(step?.output).toBeNull();
  });

  test('persists structured output on the attempt row', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(1);
    const stepId = steps[0]?.id as string;
    await nextStepForJob(jobId);

    await recordStepResult({
      jobId,
      stepId,
      status: 'succeeded',
      output: {artifact: 'dist/app.tgz'},
      exitCode: 0,
    });

    const [attempt] = await getStepAttempts(jobId);
    expect(attempt?.output).toEqual({artifact: 'dist/app.tgz'});
  });

  test('a duplicate report leaves the finalized attempt unchanged (never-downgrade)', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(1);
    const stepId = steps[0]?.id as string;
    await nextStepForJob(jobId);
    await recordStepResult({jobId, stepId, status: 'succeeded', exitCode: 0});

    await recordStepResult({jobId, stepId, status: 'failed', exitCode: 9});

    const [attempt] = await getStepAttempts(jobId);
    expect(attempt).toMatchObject({status: 'succeeded', exitCode: 0});
  });

  test('rejects non-positive attempt rows at the database boundary', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(1);

    await expect(
      db()
        .insert(stepAttemptsTable)
        .values({
          jobId,
          stepId: steps[0]?.id as string,
          attempt: 0,
          status: 'running',
        }),
    ).rejects.toThrow();
  });

  test('rejects pending attempt rows at the database boundary', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(1);

    await expect(
      db()
        .insert(stepAttemptsTable)
        .values({
          jobId,
          stepId: steps[0]?.id as string,
          attempt: 1,
          status: 'pending',
        }),
    ).rejects.toThrow();
  });

  test('rejects a report whose attempt is ahead of the current attempt', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(1);
    await nextStepForJob(jobId);

    await expect(
      recordStepResult({jobId, stepId: steps[0]?.id as string, status: 'succeeded', attempt: 2}),
    ).rejects.toBeInstanceOf(StepAttemptAheadError);
  });

  test('a stale older-attempt report is an idempotent no-op', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(1);
    const stepId = steps[0]?.id as string;
    await nextStepForJob(jobId);
    // Simulate a rewind having bumped the current attempt to 2.
    await db()
      .update(stepsTable)
      .set({currentAttempt: 2, status: 'running'})
      .where(eq(stepsTable.id, stepId));

    const outcome = await recordStepResult({
      jobId,
      stepId,
      status: 'failed',
      error: {message: 'late'},
      attempt: 1,
    });

    expect(outcome).toEqual({jobFinished: false});
    const after = await getStepsByJobId(jobId);
    expect(after[0]?.status).toBe('running'); // projection untouched by the stale report
  });

  test('a stale report on an already-finished job reports finished without a second completion event', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(1);
    const stepId = steps[0]?.id as string;
    await nextStepForJob(jobId);
    await recordStepResult({jobId, stepId, status: 'succeeded', exitCode: 0});
    // Simulate a later rewind bump on the now-terminal step.
    await db().update(stepsTable).set({currentAttempt: 2}).where(eq(stepsTable.id, stepId));

    const outcome = await recordStepResult({
      jobId,
      stepId,
      status: 'failed',
      error: {message: 'late'},
      attempt: 1,
    });

    expect(outcome).toEqual({jobFinished: true, status: 'succeeded'});
    // The applied-gated outbox write must not fire on the stale path.
    expect(await jobCompletedEvents(jobId)).toHaveLength(1);
  });
});
