import {
  createRerunWorkflowRun,
  createWorkflowRun,
  getFirstJobExecutionByJobId,
  getJobsByWorkflowRunId,
  getLatestAttempt,
  getWorkflowJobExecutionDepth,
  getWorkflowRunById,
  listRunAttempts,
  listWorkflowRunsByProject,
  updateJobExecutionStatus,
  updateWorkflowRunStatus,
} from '../workflow-runs.js';
import {buildModel, createTestRun} from './workflow-runs.test-helpers.js';

describe('workflow run queries', () => {
  let workspaceId: string;
  let projectId: string;
  let definitionId: string;

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    projectId = crypto.randomUUID();
    definitionId = crypto.randomUUID();
  });

  describe('getWorkflowRunById', () => {
    test('returns the run when found', async () => {
      const created = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel(),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });

      const found = await getWorkflowRunById(created.id);

      expect(found).toBeDefined();
      expect(found?.id).toBe(created.id);
      expect(found?.status).toBe('pending');
    });

    test('returns undefined when not found', async () => {
      const found = await getWorkflowRunById(crypto.randomUUID());

      expect(found).toBeUndefined();
    });
  });

  describe('run attempt lineage queries', () => {
    test('lists run attempts ordered by attempt and returns the latest attempt', async () => {
      const source = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel(),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });
      await updateWorkflowRunStatus({
        workflowRunId: source.id,
        status: 'failed',
        expectedVersion: 1,
      });
      const second = await createRerunWorkflowRun({
        workflowRunId: source.id,
        mode: 'all',
        actorUserId: crypto.randomUUID(),
      });
      await updateWorkflowRunStatus({
        workflowRunId: second.id,
        status: 'failed',
        expectedVersion: 1,
      });
      const third = await createRerunWorkflowRun({
        workflowRunId: second.id,
        mode: 'all',
        actorUserId: crypto.randomUUID(),
      });

      const attempts = await listRunAttempts({workflowRunId: source.id, projectId});
      const latestAttempt = await getLatestAttempt({workflowRunId: source.id, projectId});

      expect(third.currentAttempt).toBe(3);
      expect(attempts.map((attempt) => attempt.workflowRunId)).toEqual([
        source.id,
        source.id,
        source.id,
      ]);
      expect(attempts.map((attempt) => attempt.attempt)).toEqual([1, 2, 3]);
      expect(attempts.map((attempt) => attempt.status)).toEqual(['failed', 'failed', 'pending']);
      expect(attempts.map((attempt) => attempt.rerunMode)).toEqual([null, 'all', 'all']);
      expect(latestAttempt).toBe(3);
    });

    test('returns a single no-lineage run and filters out another project', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel(),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });
      const otherProjectRun = await createWorkflowRun({
        workspaceId,
        projectId: crypto.randomUUID(),
        definitionId,
        model: buildModel(),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });
      expect(otherProjectRun.projectId).not.toBe(projectId);

      const attempts = await listRunAttempts({workflowRunId: run.id, projectId});

      expect(attempts.map((attempt) => attempt.workflowRunId)).toEqual([run.id]);
    });
  });

  describe('listWorkflowRunsByProject', () => {
    test('returns runs ordered by creation descending', async () => {
      await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({name: 'First'}),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });
      await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({name: 'Second'}),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });

      const runs = await listWorkflowRunsByProject(projectId);

      expect(runs).toHaveLength(2);
      expect(runs[0]?.createdAt.getTime()).toBeGreaterThanOrEqual(
        runs[1]?.createdAt.getTime() as number,
      );
    });

    test('returns empty array for unknown project', async () => {
      const runs = await listWorkflowRunsByProject(crypto.randomUUID());

      expect(runs).toEqual([]);
    });
  });

  describe('getJobsByWorkflowRunId', () => {
    test('returns jobs for a run ordered by position', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({
          jobs: {
            lint: {steps: [{run: 'lint'}]},
            build: {steps: [{run: 'build'}]},
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

      expect(runJobs).toHaveLength(2);
      expect(runJobs[0]?.position).toBe(0);
      expect(runJobs[1]?.position).toBe(1);
    });
  });

  describe('getWorkflowJobExecutionDepth', () => {
    test('counts running runs and job executions within a workspace', async () => {
      const runningRun = await createTestRun({workspaceId, projectId, definitionId});
      const pendingRun = await createTestRun({workspaceId, projectId, definitionId});
      const otherWorkspaceRun = await createTestRun({
        workspaceId: crypto.randomUUID(),
        projectId: crypto.randomUUID(),
        definitionId: crypto.randomUUID(),
      });
      const [runningJobExecution] = await getJobsByWorkflowRunId(runningRun.id);
      const [otherWorkspaceJob] = await getJobsByWorkflowRunId(otherWorkspaceRun.id);
      if (!runningJobExecution || !otherWorkspaceJob) throw new Error('Expected workflow jobs');
      const runningExecution = await getFirstJobExecutionByJobId(runningJobExecution.id);
      const otherWorkspaceExecution = await getFirstJobExecutionByJobId(otherWorkspaceJob.id);
      if (!runningExecution || !otherWorkspaceExecution) {
        throw new Error('Expected workflow job executions');
      }
      await updateWorkflowRunStatus({
        workflowRunId: runningRun.id,
        status: 'running',
        expectedVersion: runningRun.version,
      });
      await updateWorkflowRunStatus({
        workflowRunId: otherWorkspaceRun.id,
        status: 'running',
        expectedVersion: otherWorkspaceRun.version,
      });
      await updateJobExecutionStatus({
        jobExecutionId: runningExecution.id,
        status: 'running',
        expectedVersion: runningExecution.version,
      });
      await updateJobExecutionStatus({
        jobExecutionId: otherWorkspaceExecution.id,
        status: 'running',
        expectedVersion: otherWorkspaceExecution.version,
      });

      const depth = await getWorkflowJobExecutionDepth({workspaceId});

      expect(pendingRun.status).toBe('pending');
      expect(depth).toEqual({
        runningRuns: 1,
        runningJobExecutions: 1,
      });
    });
  });
});
