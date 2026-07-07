import {WORKFLOWS_JOB_EXECUTION_TIMED_OUT} from '@shipfox/api-workflows-dto';
import {and, eq, sql} from 'drizzle-orm';
import {buildModel, workflowRunAttemptId} from '#test/helpers/workflow-runs.js';
import {db} from '../db.js';
import {workflowsOutbox} from '../schema/outbox.js';
import {
  createWorkflowRun,
  failJobExecutionAsTimedOut,
  getFirstJobExecutionByJobId,
  getJobsByWorkflowRunId,
  getStepsByJobId,
  resolveJobExecutionAfterLeaseExpiry,
  updateJobExecutionStatus,
} from '../workflow-runs.js';

describe('workflow run job executions', () => {
  let workspaceId: string;
  let projectId: string;
  let definitionId: string;

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    projectId = crypto.randomUUID();
    definitionId = crypto.randomUUID();
  });

  test('derives timeout outbox attempt identity from the job execution', async () => {
    const run = await createWorkflowRun({
      workspaceId,
      projectId,
      definitionId,
      model: buildModel({jobs: {build: {steps: [{run: 'echo build'}]}}}),
      triggerPayload: {
        source: 'manual',
        event: 'fire',
        subscriptionId: crypto.randomUUID(),
        userId: crypto.randomUUID(),
      },
    });
    const [job] = await getJobsByWorkflowRunId(run.id);
    if (!job) throw new Error('Expected workflow job');
    const execution = await getFirstJobExecutionByJobId(job.id);
    if (!execution) throw new Error('Expected job execution');
    const actualAttemptId = await workflowRunAttemptId(run.id);

    await failJobExecutionAsTimedOut({
      jobExecutionId: execution.id,
      workflowRunAttemptId: crypto.randomUUID(),
      expectedVersion: execution.version,
    });

    const [event] = await db()
      .select({payload: workflowsOutbox.payload})
      .from(workflowsOutbox)
      .where(
        and(
          eq(workflowsOutbox.eventType, WORKFLOWS_JOB_EXECUTION_TIMED_OUT),
          sql`${workflowsOutbox.payload}->>'jobExecutionId' = ${execution.id}`,
        ),
      );
    expect(event?.payload).toMatchObject({
      jobId: job.id,
      jobExecutionId: execution.id,
      workflowRunAttemptId: actualAttemptId,
    });
  });

  test('does not cancel steps when lease expiry loses the execution version race', async () => {
    const run = await createWorkflowRun({
      workspaceId,
      projectId,
      definitionId,
      model: buildModel({jobs: {build: {steps: [{run: 'echo build'}]}}}),
      triggerPayload: {
        source: 'manual',
        event: 'fire',
        subscriptionId: crypto.randomUUID(),
        userId: crypto.randomUUID(),
      },
    });
    const [job] = await getJobsByWorkflowRunId(run.id);
    if (!job) throw new Error('Expected workflow job');
    const execution = await getFirstJobExecutionByJobId(job.id);
    if (!execution) throw new Error('Expected job execution');
    await updateJobExecutionStatus({
      jobExecutionId: execution.id,
      status: 'running',
      expectedVersion: execution.version,
    });

    await resolveJobExecutionAfterLeaseExpiry({
      jobExecutionId: execution.id,
      expectedVersion: execution.version,
    });

    const jobSteps = await getStepsByJobId(job.id);
    expect(jobSteps.every((step) => step.status === 'pending')).toBe(true);
  });
});
