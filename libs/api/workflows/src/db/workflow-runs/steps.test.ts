import {eq} from 'drizzle-orm';
import {nextStepForJob} from '#core/job-execution.js';
import {stripSetupStep} from '#test/fixtures/strip-setup-step.js';
import {db} from '../db.js';
import {stepAttempts as stepAttemptsTable} from '../schema/step-attempts.js';
import {steps as stepsTable} from '../schema/steps.js';
import {
  createWorkflowRun,
  getJobsByWorkflowRunId,
  getStepAttempts,
  getStepsByJobId,
} from '../workflow-runs.js';
import {
  buildModel,
  bulkUpdateJobStepStatuses,
  stepAttemptTerminatedEvents,
} from './workflow-runs.test-helpers.js';

describe('workflow run queries', () => {
  let workspaceId: string;
  let projectId: string;
  let definitionId: string;

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    projectId = crypto.randomUUID();
    definitionId = crypto.randomUUID();
  });

  describe('getStepsByJobId', () => {
    test('returns steps for a job ordered by position', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({
          jobs: {
            build: {
              steps: [{run: 'step1'}, {run: 'step2'}, {run: 'step3'}],
            },
          },
        }),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });

      const runJobs = await getJobsByWorkflowRunId(run.id);
      const jobSteps = await getStepsByJobId(runJobs[0]?.id as string);

      // The synthetic setup step occupies position 0; user steps follow at 1..3.
      expect(jobSteps).toHaveLength(4);
      expect(jobSteps[0]).toMatchObject({type: 'setup', position: 0});
      expect(jobSteps[1]?.position).toBe(1);
      expect(jobSteps[2]?.position).toBe(2);
      expect(jobSteps[3]?.position).toBe(3);
    });
  });

  describe('bulkUpdateStepStatuses', () => {
    test('updates all steps for a job to the given status', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({
          jobs: {
            build: {steps: [{run: 'step1'}, {run: 'step2'}, {run: 'step3'}]},
          },
        }),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });
      const runJobs = await getJobsByWorkflowRunId(run.id);

      const jobId = runJobs[0]?.id ?? '';
      await bulkUpdateJobStepStatuses({jobId, status: 'succeeded'});

      const jobSteps = await getStepsByJobId(jobId);
      expect(jobSteps).toHaveLength(4);
      for (const step of jobSteps) {
        expect(step.status).toBe('succeeded');
      }
    });

    test('does not downgrade a terminal step (terminal-state guard)', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({jobs: {build: {steps: [{run: 'a'}, {run: 'b'}]}}}),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });
      const runJobs = await getJobsByWorkflowRunId(run.id);
      const jobId = runJobs[0]?.id ?? '';
      const seeded = await getStepsByJobId(jobId);

      await db()
        .update(stepsTable)
        .set({status: 'succeeded'})
        .where(eq(stepsTable.id, seeded[0]?.id as string));
      await db()
        .update(stepsTable)
        .set({status: 'skipped', statusReason: 'condition_rejected'})
        .where(eq(stepsTable.id, seeded[1]?.id as string));

      await bulkUpdateJobStepStatuses({jobId, status: 'failed'});

      const final = await getStepsByJobId(jobId);
      expect(final[0]?.status).toBe('succeeded');
      expect(final[1]?.status).toBe('skipped');
      expect(final[1]?.statusReason).toBe('condition_rejected');
    });

    test('step attempts cannot be skipped', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({jobs: {build: {steps: [{run: 'a'}]}}}),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });
      const runJobs = await getJobsByWorkflowRunId(run.id);
      const jobId = runJobs[0]?.id ?? '';
      const [step] = await getStepsByJobId(jobId);
      if (!step) throw new Error('Expected arranged step');

      await expect(
        db().insert(stepAttemptsTable).values({
          stepId: step.id,
          jobExecutionId: step.jobExecutionId,
          attempt: 1,
          executionOrder: 1,
          status: 'skipped',
        }),
      ).rejects.toThrow();
    });

    test('terminal sweeps finalize running attempts as abandoned and emit attempt events', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({jobs: {build: {steps: [{run: 'a'}]}}}),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });
      const runJobs = await getJobsByWorkflowRunId(run.id);
      const jobId = runJobs[0]?.id ?? '';
      await stripSetupStep(jobId);
      await nextStepForJob(jobId);

      await bulkUpdateJobStepStatuses({jobId, status: 'cancelled'});

      const [attempt] = await getStepAttempts(jobId);
      expect(attempt).toMatchObject({status: 'cancelled', logOutcome: 'abandoned'});
      expect(await stepAttemptTerminatedEvents(jobId)).toMatchObject([
        {
          jobId,
          workflowRunId: run.id,
          workspaceId,
          projectId,
          stepId: attempt?.stepId,
          attempt: 1,
          logOutcome: 'abandoned',
        },
      ]);
    });
  });
});
