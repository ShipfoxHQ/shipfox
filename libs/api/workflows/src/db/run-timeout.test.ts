import {WORKFLOWS_WORKFLOW_RUN_TERMINATED} from '@shipfox/api-workflows-dto';
import {eq} from 'drizzle-orm';
import type {JobExecutionStatus} from '#core/entities/job-execution.js';
import {db} from '#db/db.js';
import {jobExecutions} from '#db/schema/job-executions.js';
import {jobs} from '#db/schema/jobs.js';
import {workflowsOutbox} from '#db/schema/outbox.js';
import {failWorkflowRunAsTimedOut} from '#db/workflow-runs.js';
import {jobFactory} from '#test/index.js';

async function insertExecution(jobId: string, sequence: number, status: JobExecutionStatus) {
  const [row] = await db()
    .insert(jobExecutions)
    .values({jobId, sequence, name: `firing #${sequence}`, status, triggerEvents: []})
    .returning();
  if (!row) throw new Error('insertExecution: no row returned');
  return row;
}

function readJob(jobId: string) {
  return db()
    .select()
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1)
    .then((rows) => rows[0]);
}

describe('failWorkflowRunAsTimedOut', () => {
  it('drives a running listener job, its execution, and the run to timed out', async () => {
    const job = await jobFactory.create({}, {transient: {status: 'running'}});
    await db()
      .update(jobs)
      .set({mode: 'listening', listenerStatus: 'listening'})
      .where(eq(jobs.id, job.id));
    await db().delete(jobExecutions).where(eq(jobExecutions.jobId, job.id));
    const execution = await insertExecution(job.id, 1, 'running');

    const run = await failWorkflowRunAsTimedOut({runAttemptId: job.workflowRunAttemptId});

    const storedJob = await readJob(job.id);
    const [storedExecution] = await db()
      .select()
      .from(jobExecutions)
      .where(eq(jobExecutions.id, execution.id));
    expect(run.status).toBe('failed');
    expect(storedJob?.status).toBe('failed');
    expect(storedJob?.statusReason).toBe('timed_out');
    expect(storedJob?.listenerStatus).toBe('resolved');
    expect(storedJob?.resolutionReason).toBe('cancelled');
    expect(storedExecution?.status).toBe('failed');
    expect(storedExecution?.statusReason).toBe('timed_out');
    expect(storedExecution?.timedOutAt).not.toBeNull();
  });

  it('emits a run-terminated outbox event with the failed status', async () => {
    const job = await jobFactory.create({}, {transient: {status: 'running'}});

    const run = await failWorkflowRunAsTimedOut({runAttemptId: job.workflowRunAttemptId});

    const terminated = await db()
      .select()
      .from(workflowsOutbox)
      .where(eq(workflowsOutbox.eventType, WORKFLOWS_WORKFLOW_RUN_TERMINATED));
    const forRun = terminated.filter(
      (row) => (row.payload as Record<string, unknown>).workflowRunId === run.id,
    );
    expect(forRun).toHaveLength(1);
    expect(forRun[0]?.payload).toMatchObject({workflowRunId: run.id, status: 'failed'});
  });

  it('leaves an already-resolved listener job untouched', async () => {
    const job = await jobFactory.create({}, {transient: {status: 'succeeded'}});
    await db()
      .update(jobs)
      .set({mode: 'listening', listenerStatus: 'resolved', resolutionReason: 'until'})
      .where(eq(jobs.id, job.id));

    await failWorkflowRunAsTimedOut({runAttemptId: job.workflowRunAttemptId});

    const storedJob = await readJob(job.id);
    expect(storedJob?.status).toBe('succeeded');
    expect(storedJob?.resolutionReason).toBe('until');
  });

  it('is idempotent once the run is terminal', async () => {
    const job = await jobFactory.create({}, {transient: {status: 'running'}});

    await failWorkflowRunAsTimedOut({runAttemptId: job.workflowRunAttemptId});
    const second = await failWorkflowRunAsTimedOut({runAttemptId: job.workflowRunAttemptId});

    const terminated = await db()
      .select()
      .from(workflowsOutbox)
      .where(eq(workflowsOutbox.eventType, WORKFLOWS_WORKFLOW_RUN_TERMINATED));
    const forRun = terminated.filter(
      (row) => (row.payload as Record<string, unknown>).workflowRunId === second.id,
    );
    expect(second.status).toBe('failed');
    expect(forRun).toHaveLength(1);
  });
});
