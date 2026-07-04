import {and, desc, eq} from 'drizzle-orm';
import {db} from '#db/db.js';
import {jobExecutions} from '#db/schema/job-executions.js';
import {jobs} from '#db/schema/jobs.js';
import {workflowRunAttempts} from '#db/schema/workflow-run-attempts.js';
import {createRerunWorkflowRun, getWorkflowRunByAttemptId} from '#db/workflow-runs.js';
import {jobFactory} from '#test/index.js';

describe('createRerunWorkflowRun with a failed listener', () => {
  it('re-creates the listener fresh without carrying it over', async () => {
    const job = await jobFactory.create({}, {transient: {status: 'failed'}});
    await db()
      .update(jobs)
      .set({
        mode: 'listening',
        status: 'failed',
        statusReason: 'timed_out',
        listenerStatus: 'resolved',
        resolutionReason: 'timeout',
        maxExecutions: 5,
        onResolve: 'cancel',
      })
      .where(eq(jobs.id, job.id));
    await db()
      .update(workflowRunAttempts)
      .set({status: 'failed'})
      .where(eq(workflowRunAttempts.id, job.workflowRunAttemptId));
    const sourceRun = await getWorkflowRunByAttemptId(job.workflowRunAttemptId);
    if (!sourceRun) throw new Error('source run not found');

    const rerun = await createRerunWorkflowRun({
      workflowRunId: sourceRun.id,
      mode: 'failed',
      actorUserId: crypto.randomUUID(),
    });

    const [newAttempt] = await db()
      .select()
      .from(workflowRunAttempts)
      .where(eq(workflowRunAttempts.workflowRunId, rerun.id))
      .orderBy(desc(workflowRunAttempts.attempt))
      .limit(1);
    if (!newAttempt) throw new Error('new attempt not found');
    const [clonedJob] = await db()
      .select()
      .from(jobs)
      .where(and(eq(jobs.workflowRunAttemptId, newAttempt.id), eq(jobs.mode, 'listening')));
    if (!clonedJob) throw new Error('cloned listener job not found');
    const clonedExecutions = await db()
      .select()
      .from(jobExecutions)
      .where(eq(jobExecutions.jobId, clonedJob.id));

    expect(clonedJob.status).toBe('pending');
    expect(clonedJob.carriedOver).toBe(false);
    expect(clonedJob.listenerStatus).toBe('inactive');
    expect(clonedJob.resolutionReason).toBeNull();
    // Listener config carries over so the retried run behaves identically.
    expect(clonedJob.maxExecutions).toBe(5);
    expect(clonedJob.onResolve).toBe('cancel');
    // A fresh listener starts with no firings to re-run.
    expect(clonedExecutions).toHaveLength(0);
  });
});
