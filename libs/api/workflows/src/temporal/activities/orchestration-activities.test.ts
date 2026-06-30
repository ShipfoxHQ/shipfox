import {ApplicationFailure} from '@temporalio/common';
import {
  createWorkflowRun,
  getJobExecutionsByJobId,
  getJobsByRunId,
  updateJobExecutionStatus,
} from '#db/index.js';
import {stripSetupStep} from '#test/fixtures/strip-setup-step.js';
import {workflowModel} from '#test/index.js';
import {loadRunDag, resolveLeaseExpiredJobExecutionActivity} from './orchestration-activities.js';

describe('resolveLeaseExpiredJobExecutionActivity', () => {
  let workspaceId: string;
  let projectId: string;
  let definitionId: string;

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    projectId = crypto.randomUUID();
    definitionId = crypto.randomUUID();
  });

  async function seedRunningJob(stepCount: number) {
    const run = await createWorkflowRun({
      workspaceId,
      projectId,
      definitionId,
      model: workflowModel({
        jobs: {build: {steps: Array.from({length: stepCount}, (_, i) => ({run: `step${i + 1}`}))}},
      }),
      triggerPayload: {
        source: 'manual',
        event: 'fire',
        subscriptionId: crypto.randomUUID(),
        userId: crypto.randomUUID(),
      },
    });
    const jobId = (await getJobsByRunId(run.id))[0]?.id as string;
    const executionId = (await getJobExecutionsByJobId(jobId))[0]?.id as string;
    const running = await updateJobExecutionStatus({
      executionId,
      status: 'running',
      expectedVersion: 1,
    });
    return {jobId, executionId, runningVersion: running.version};
  }

  test('a malformed job (no steps) fails non-retryably so it never loops to the backstop', async () => {
    const {jobId, executionId, runningVersion} = await seedRunningJob(0);
    // createWorkflowRun always prepends the synthetic setup step, so strip it to
    // reproduce a genuinely stepless (malformed) job.
    await stripSetupStep(jobId);

    const error = await resolveLeaseExpiredJobExecutionActivity({
      executionId,
      expectedVersion: runningVersion,
    }).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ApplicationFailure);
    expect((error as ApplicationFailure).nonRetryable).toBe(true);
  });

  test('a well-formed job resolves without raising', async () => {
    const {executionId, runningVersion} = await seedRunningJob(2);

    const result = await resolveLeaseExpiredJobExecutionActivity({
      executionId,
      expectedVersion: runningVersion,
    });

    expect(result.status).toBe('failed');
  });
});

describe('loadRunDag', () => {
  test('surfaces the run workspace, project, and run ids on the dag', async () => {
    const workspaceId = crypto.randomUUID();
    const projectId = crypto.randomUUID();
    const run = await createWorkflowRun({
      workspaceId,
      projectId,
      definitionId: crypto.randomUUID(),
      model: workflowModel({jobs: {build: {runner: ['ubuntu22'], steps: [{run: 'step1'}]}}}),
      triggerPayload: {
        source: 'manual',
        event: 'fire',
        subscriptionId: crypto.randomUUID(),
        userId: crypto.randomUUID(),
      },
    });

    const dag = await loadRunDag(run.id);

    expect(dag.runId).toBe(run.id);
    expect(dag.workspaceId).toBe(workspaceId);
    expect(dag.projectId).toBe(projectId);
    expect(dag.jobs[0]?.runner).toEqual(['ubuntu22']);
  });
});
