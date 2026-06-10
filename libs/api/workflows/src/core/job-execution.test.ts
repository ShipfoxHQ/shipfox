import {bulkUpdateStepStatuses, getStepsByJobId} from '#db/workflow-runs.js';
import {arrangeJobWithSteps} from '#test/fixtures/job-with-steps.js';
import {JobNotFoundError, StepNotFoundError, StepNotRunningError} from './errors.js';
import {nextStepForJob, recordStepResult} from './job-execution.js';

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
  });
});
