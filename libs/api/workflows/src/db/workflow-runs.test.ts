import type {WorkflowSpec} from '@shipfox/api-definitions';
import {WORKFLOW_RUN_CREATED, WORKFLOWS_JOB_TIMED_OUT} from '@shipfox/api-workflows-dto';
import {eq, sql} from 'drizzle-orm';
import {db} from './db.js';
import {jobs} from './schema/jobs.js';
import {workflowsOutbox} from './schema/outbox.js';
import {steps as stepsTable} from './schema/steps.js';
import {
  applyStepResults,
  bulkUpdateStepStatuses,
  createWorkflowRun,
  failJobAsTimedOut,
  getJobsByRunId,
  getStepsByJobId,
  getWorkflowRunById,
  listWorkflowRunsByProject,
  StepResultsContractViolationError,
  updateJobStatus,
  updateWorkflowRunStatus,
} from './workflow-runs.js';

function spec(overrides?: Partial<WorkflowSpec>): WorkflowSpec {
  return {
    name: 'Test Workflow',
    jobs: {
      build: {
        steps: [{run: 'echo hello'}],
      },
    },
    ...overrides,
  };
}

describe('workflow run queries', () => {
  let workspaceId: string;
  let projectId: string;
  let definitionId: string;

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    projectId = crypto.randomUUID();
    definitionId = crypto.randomUUID();
  });

  describe('createWorkflowRun', () => {
    test('inserts run, jobs, and steps atomically', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        definition: spec(),
        triggerContext: {type: 'manual'},
      });

      expect(run.id).toBeDefined();
      expect(run.projectId).toBe(projectId);
      expect(run.definitionId).toBe(definitionId);
      expect(run.status).toBe('pending');
      expect(run.triggerContext).toEqual({type: 'manual'});
      expect(run.inputs).toBeNull();
      expect(run.version).toBe(1);
      expect(run.createdAt).toBeInstanceOf(Date);
      expect(run.updatedAt).toBeInstanceOf(Date);

      const runJobs = await getJobsByRunId(run.id);
      expect(runJobs).toHaveLength(1);
      expect(runJobs[0]?.name).toBe('build');

      const jobSteps = await getStepsByJobId(runJobs[0]?.id as string);
      expect(jobSteps).toHaveLength(1);
      expect(jobSteps[0]?.config).toEqual({run: 'echo hello'});
    });

    test('writes workflows.run.created outbox event in same transaction', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        definition: spec(),
        triggerContext: {type: 'manual'},
      });

      const outboxRows = await db()
        .select()
        .from(workflowsOutbox)
        .where(eq(workflowsOutbox.eventType, WORKFLOW_RUN_CREATED));

      const matchingRow = outboxRows.find(
        (row) => (row.payload as Record<string, unknown>).runId === run.id,
      );

      expect(matchingRow).toBeDefined();
      expect(matchingRow?.payload).toEqual({
        runId: run.id,
        workspaceId: run.workspaceId,
        projectId: run.projectId,
        definitionId: run.definitionId,
      });
      expect(matchingRow?.dispatchedAt).toBeNull();
    });

    test('rolls back outbox event when transaction fails', async () => {
      const marker = crypto.randomUUID();

      try {
        await db().transaction(async (tx) => {
          await tx.insert(workflowsOutbox).values({
            eventType: WORKFLOW_RUN_CREATED,
            payload: {runId: marker, projectId, definitionId},
          });
          throw new Error('Simulated failure');
        });
      } catch {
        // expected
      }

      const leaked = await db()
        .select()
        .from(workflowsOutbox)
        .where(sql`${workflowsOutbox.payload}->>'runId' = ${marker}`);

      expect(leaked).toHaveLength(0);
    });

    test('normalizes needs string to array', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        definition: spec({
          jobs: {
            build: {steps: [{run: 'echo build'}]},
            test: {needs: 'build', steps: [{run: 'echo test'}]},
          },
        }),
        triggerContext: {type: 'manual'},
      });

      const runJobs = await getJobsByRunId(run.id);
      const testJob = runJobs.find((j) => j.name === 'test');

      expect(testJob?.dependencies).toEqual(['build']);
    });

    test('normalizes needs undefined to empty array', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        definition: spec(),
        triggerContext: {type: 'manual'},
      });

      const runJobs = await getJobsByRunId(run.id);

      expect(runJobs[0]?.dependencies).toEqual([]);
    });

    test('handles multi-job definitions with correct positions', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        definition: spec({
          jobs: {
            lint: {steps: [{run: 'echo lint'}]},
            build: {steps: [{run: 'echo build'}]},
            test: {needs: ['lint', 'build'], steps: [{run: 'echo test'}]},
          },
        }),
        triggerContext: {type: 'manual'},
      });

      const runJobs = await getJobsByRunId(run.id);

      expect(runJobs).toHaveLength(3);
      expect(runJobs[0]?.position).toBe(0);
      expect(runJobs[1]?.position).toBe(1);
      expect(runJobs[2]?.position).toBe(2);
    });

    test('handles definition with empty jobs object', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        definition: spec({jobs: {}}),
        triggerContext: {type: 'manual'},
      });

      expect(run.id).toBeDefined();

      const runJobs = await getJobsByRunId(run.id);

      expect(runJobs).toHaveLength(0);
    });

    test('handles job with zero steps', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        definition: spec({
          jobs: {
            empty: {steps: []},
          },
        }),
        triggerContext: {type: 'manual'},
      });

      const runJobs = await getJobsByRunId(run.id);
      expect(runJobs).toHaveLength(1);

      const jobSteps = await getStepsByJobId(runJobs[0]?.id as string);

      expect(jobSteps).toHaveLength(0);
    });

    test('stores step with optional name', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        definition: spec({
          jobs: {
            build: {
              steps: [{name: 'Install deps', run: 'npm install'}, {run: 'npm build'}],
            },
          },
        }),
        triggerContext: {type: 'manual'},
      });

      const runJobs = await getJobsByRunId(run.id);
      const jobSteps = await getStepsByJobId(runJobs[0]?.id as string);

      expect(jobSteps[0]?.name).toBe('Install deps');
      expect(jobSteps[1]?.name).toBeNull();
    });

    test('stores frozen step config', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        definition: spec({
          jobs: {
            build: {steps: [{run: 'make build'}]},
          },
        }),
        triggerContext: {type: 'manual'},
      });

      const runJobs = await getJobsByRunId(run.id);
      const jobSteps = await getStepsByJobId(runJobs[0]?.id as string);

      expect(jobSteps[0]?.type).toBe('run');
      expect(jobSteps[0]?.config).toEqual({run: 'make build'});
    });

    test('stores inputs when provided', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        definition: spec(),
        triggerContext: {type: 'manual'},
        inputs: {env: 'staging', verbose: true},
      });

      expect(run.inputs).toEqual({env: 'staging', verbose: true});
    });
  });

  describe('getWorkflowRunById', () => {
    test('returns the run when found', async () => {
      const created = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        definition: spec(),
        triggerContext: {type: 'manual'},
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

  describe('listWorkflowRunsByProject', () => {
    test('returns runs ordered by creation descending', async () => {
      await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        definition: spec({name: 'First'}),
        triggerContext: {type: 'manual'},
      });
      await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        definition: spec({name: 'Second'}),
        triggerContext: {type: 'manual'},
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

  describe('getJobsByRunId', () => {
    test('returns jobs for a run ordered by position', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        definition: spec({
          jobs: {
            lint: {steps: [{run: 'lint'}]},
            build: {steps: [{run: 'build'}]},
          },
        }),
        triggerContext: {type: 'manual'},
      });

      const runJobs = await getJobsByRunId(run.id);

      expect(runJobs).toHaveLength(2);
      expect(runJobs[0]?.position).toBe(0);
      expect(runJobs[1]?.position).toBe(1);
    });
  });

  describe('getStepsByJobId', () => {
    test('returns steps for a job ordered by position', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        definition: spec({
          jobs: {
            build: {
              steps: [{run: 'step1'}, {run: 'step2'}, {run: 'step3'}],
            },
          },
        }),
        triggerContext: {type: 'manual'},
      });

      const runJobs = await getJobsByRunId(run.id);
      const jobSteps = await getStepsByJobId(runJobs[0]?.id as string);

      expect(jobSteps).toHaveLength(3);
      expect(jobSteps[0]?.position).toBe(0);
      expect(jobSteps[1]?.position).toBe(1);
      expect(jobSteps[2]?.position).toBe(2);
    });
  });

  describe('updateWorkflowRunStatus', () => {
    test('updates status and increments version', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        definition: spec(),
        triggerContext: {type: 'manual'},
      });

      const updated = await updateWorkflowRunStatus({
        runId: run.id,
        status: 'running',
        expectedVersion: 1,
      });

      expect(updated.status).toBe('running');
      expect(updated.version).toBe(2);
    });

    test('throws on version mismatch', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        definition: spec(),
        triggerContext: {type: 'manual'},
      });

      await expect(
        updateWorkflowRunStatus({runId: run.id, status: 'running', expectedVersion: 99}),
      ).rejects.toThrow('Optimistic lock failure');
    });

    test('throws when run not found', async () => {
      await expect(
        updateWorkflowRunStatus({
          runId: crypto.randomUUID(),
          status: 'running',
          expectedVersion: 1,
        }),
      ).rejects.toThrow('Optimistic lock failure');
    });
  });

  describe('updateJobStatus', () => {
    test('updates status and increments version', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        definition: spec(),
        triggerContext: {type: 'manual'},
      });
      const runJobs = await getJobsByRunId(run.id);
      const job = runJobs[0];
      expect(job).toBeDefined();

      const updated = await updateJobStatus({
        jobId: job?.id as string,
        status: 'running',
        expectedVersion: 1,
      });

      expect(updated.status).toBe('running');
      expect(updated.version).toBe(2);
    });

    test('throws on version mismatch', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        definition: spec(),
        triggerContext: {type: 'manual'},
      });
      const runJobs = await getJobsByRunId(run.id);

      await expect(
        updateJobStatus({jobId: runJobs[0]?.id ?? '', status: 'running', expectedVersion: 99}),
      ).rejects.toThrow('Optimistic lock failure');
    });
  });

  describe('failJobAsTimedOut', () => {
    async function findOutboxForJob(jobId: string) {
      const all = await db()
        .select()
        .from(workflowsOutbox)
        .where(eq(workflowsOutbox.eventType, WORKFLOWS_JOB_TIMED_OUT));
      return all.filter((row) => (row.payload as Record<string, unknown>).jobId === jobId);
    }

    test('atomic: marks job failed + timed_out_at, writes outbox event', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        definition: spec(),
        triggerContext: {type: 'manual'},
      });
      const runJobs = await getJobsByRunId(run.id);
      const job = runJobs[0];
      expect(job).toBeDefined();

      const updated = await failJobAsTimedOut({
        jobId: job?.id as string,
        runId: run.id,
        expectedVersion: 1,
      });

      expect(updated.status).toBe('failed');
      expect(updated.version).toBe(2);
      expect(updated.timedOutAt).not.toBeNull();

      const outboxRows = await findOutboxForJob(job?.id as string);
      expect(outboxRows).toHaveLength(1);
      expect(outboxRows[0]?.payload).toEqual({jobId: job?.id, runId: run.id});
    });

    test('idempotent retry: row already timed out → returns current version, no second outbox', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        definition: spec(),
        triggerContext: {type: 'manual'},
      });
      const runJobs = await getJobsByRunId(run.id);
      const job = runJobs[0];

      await failJobAsTimedOut({jobId: job?.id as string, runId: run.id, expectedVersion: 1});

      // Second attempt with the same expectedVersion simulates a Temporal
      // activity retry after the first attempt's commit succeeded.
      const second = await failJobAsTimedOut({
        jobId: job?.id as string,
        runId: run.id,
        expectedVersion: 1,
      });

      expect(second.version).toBe(2);
      expect(second.status).toBe('failed');
      expect(second.timedOutAt).not.toBeNull();

      const outboxRows = await findOutboxForJob(job?.id as string);
      expect(outboxRows).toHaveLength(1);
    });

    test('lock-mismatch with NULL timed_out_at → throws, no outbox', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        definition: spec(),
        triggerContext: {type: 'manual'},
      });
      const runJobs = await getJobsByRunId(run.id);
      const job = runJobs[0];

      // Defensive: simulate a hypothetical separate writer (no realistic path
      // today) that bumped version + status without setting timed_out_at.
      await db()
        .update(jobs)
        .set({status: 'failed', version: 5})
        .where(eq(jobs.id, job?.id as string));

      await expect(
        failJobAsTimedOut({jobId: job?.id as string, runId: run.id, expectedVersion: 1}),
      ).rejects.toThrow('Optimistic lock failure');

      const outboxRows = await findOutboxForJob(job?.id as string);
      expect(outboxRows).toHaveLength(0);
    });
  });

  describe('bulkUpdateStepStatuses', () => {
    test('updates all steps for a job to the given status', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        definition: spec({
          jobs: {
            build: {steps: [{run: 'step1'}, {run: 'step2'}, {run: 'step3'}]},
          },
        }),
        triggerContext: {type: 'manual'},
      });
      const runJobs = await getJobsByRunId(run.id);

      const jobId = runJobs[0]?.id ?? '';
      await bulkUpdateStepStatuses({jobId, status: 'succeeded'});

      const jobSteps = await getStepsByJobId(jobId);
      expect(jobSteps).toHaveLength(3);
      for (const step of jobSteps) {
        expect(step.status).toBe('succeeded');
      }
    });

    test('does not downgrade a terminal step (terminal-state guard)', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        definition: spec({jobs: {build: {steps: [{run: 'a'}, {run: 'b'}]}}}),
        triggerContext: {type: 'manual'},
      });
      const runJobs = await getJobsByRunId(run.id);
      const jobId = runJobs[0]?.id ?? '';
      const seeded = await getStepsByJobId(jobId);

      await db()
        .update(stepsTable)
        .set({status: 'succeeded'})
        .where(eq(stepsTable.id, seeded[0]?.id as string));

      await bulkUpdateStepStatuses({jobId, status: 'failed'});

      const final = await getStepsByJobId(jobId);
      expect(final[0]?.status).toBe('succeeded');
      expect(final[1]?.status).toBe('failed');
    });
  });

  describe('applyStepResults', () => {
    async function seedJob(stepCount: number) {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        definition: spec({
          jobs: {
            build: {
              steps: Array.from({length: stepCount}, (_, i) => ({run: `step${i + 1}`})),
            },
          },
        }),
        triggerContext: {type: 'manual'},
      });
      const runJobs = await getJobsByRunId(run.id);
      const jobId = runJobs[0]?.id ?? '';
      const jobSteps = await getStepsByJobId(jobId);
      return {jobId, jobSteps};
    }

    test('REGRESSION: mid-job failure marks unreached steps as cancelled, not failed', async () => {
      const {jobId, jobSteps} = await seedJob(4);

      await applyStepResults({
        jobId,
        completionStatus: 'failed',
        reportedSteps: [
          {stepId: jobSteps[0]?.id as string, status: 'succeeded', error: null},
          {
            stepId: jobSteps[1]?.id as string,
            status: 'failed',
            error: {message: 'Command exited with code 1', exitCode: 1},
          },
        ],
      });

      const final = await getStepsByJobId(jobId);
      expect(final[0]?.status).toBe('succeeded');
      expect(final[0]?.error).toBeNull();
      expect(final[1]?.status).toBe('failed');
      expect(final[1]?.error).toEqual({message: 'Command exited with code 1', exitCode: 1});
      expect(final[2]?.status).toBe('cancelled');
      expect(final[3]?.status).toBe('cancelled');
    });

    test('writes status=succeeded with null error when every step succeeds', async () => {
      const {jobId, jobSteps} = await seedJob(2);

      await applyStepResults({
        jobId,
        completionStatus: 'succeeded',
        reportedSteps: jobSteps.map((s) => ({
          stepId: s.id,
          status: 'succeeded' as const,
          error: null,
        })),
      });

      const final = await getStepsByJobId(jobId);
      for (const step of final) {
        expect(step.status).toBe('succeeded');
        expect(step.error).toBeNull();
      }
    });

    test('terminal-state guard blocks downgrade on reported updates', async () => {
      const {jobId, jobSteps} = await seedJob(2);
      await db()
        .update(stepsTable)
        .set({status: 'failed'})
        .where(eq(stepsTable.id, jobSteps[0]?.id as string));

      await applyStepResults({
        jobId,
        completionStatus: 'succeeded',
        reportedSteps: [
          {stepId: jobSteps[0]?.id as string, status: 'succeeded', error: null},
          {stepId: jobSteps[1]?.id as string, status: 'succeeded', error: null},
        ],
      });

      const final = await getStepsByJobId(jobId);
      expect(final[0]?.status).toBe('failed');
      expect(final[1]?.status).toBe('succeeded');
    });

    test('terminal-state guard blocks cancellation of an already-succeeded step', async () => {
      const {jobId, jobSteps} = await seedJob(3);
      await db()
        .update(stepsTable)
        .set({status: 'succeeded'})
        .where(eq(stepsTable.id, jobSteps[2]?.id as string));

      await applyStepResults({
        jobId,
        completionStatus: 'failed',
        reportedSteps: [{stepId: jobSteps[0]?.id as string, status: 'succeeded', error: null}],
      });

      const final = await getStepsByJobId(jobId);
      expect(final[2]?.status).toBe('succeeded');
    });

    test('empty reportedSteps[] with completionStatus=failed falls back to bulk-fail', async () => {
      const {jobId} = await seedJob(3);

      await applyStepResults({jobId, completionStatus: 'failed', reportedSteps: []});

      const final = await getStepsByJobId(jobId);
      for (const step of final) {
        expect(step.status).toBe('failed');
      }
    });

    test('Temporal-retry idempotency: re-running with the same payload is a no-op', async () => {
      const {jobId, jobSteps} = await seedJob(3);
      const payload = {
        jobId,
        completionStatus: 'failed' as const,
        reportedSteps: [
          {stepId: jobSteps[0]?.id as string, status: 'succeeded' as const, error: null},
          {
            stepId: jobSteps[1]?.id as string,
            status: 'failed' as const,
            error: {message: 'boom', exitCode: 1},
          },
        ],
      };

      await applyStepResults(payload);
      const afterFirst = await getStepsByJobId(jobId);
      const updatedAtAfterFirst = afterFirst.map((s) => s.updatedAt.toISOString());

      await applyStepResults(payload);
      const afterSecond = await getStepsByJobId(jobId);

      expect(afterSecond.map((s) => s.status)).toEqual(['succeeded', 'failed', 'cancelled']);
      // Already-terminal rows are guarded; updatedAt should not move.
      expect(afterSecond.map((s) => s.updatedAt.toISOString())).toEqual(updatedAtAfterFirst);
    });

    test('hostile (failed): bogus stepId does not corrupt real steps', async () => {
      const {jobId, jobSteps} = await seedJob(3);

      await applyStepResults({
        jobId,
        completionStatus: 'failed',
        reportedSteps: [
          {
            stepId: '00000000-0000-0000-0000-000000000999',
            status: 'failed',
            error: {message: 'bogus'},
          },
        ],
      });

      const final = await getStepsByJobId(jobId);
      // Every real step ends cancelled; no real step has 'failed' or the bogus error written.
      for (const step of final) {
        expect(step.status).toBe('cancelled');
        expect(step.error).toBeNull();
      }
      expect(final.map((s) => s.id)).toEqual(jobSteps.map((s) => s.id));
    });

    test('hostile (failed): duplicate stepId is idempotent (terminal guard absorbs the second write)', async () => {
      const {jobId, jobSteps} = await seedJob(2);
      const stepId = jobSteps[0]?.id as string;

      await applyStepResults({
        jobId,
        completionStatus: 'failed',
        reportedSteps: [
          {stepId, status: 'succeeded', error: null},
          {stepId, status: 'failed', error: {message: 'should not apply', exitCode: 1}},
        ],
      });

      const final = await getStepsByJobId(jobId);
      // The first write wins because the terminal guard then blocks the second.
      expect(final[0]?.status).toBe('succeeded');
      expect(final[0]?.error).toBeNull();
    });

    test('hostile (failed): cross-job stepId is filtered out by the canonical-set check', async () => {
      const seedA = await seedJob(2);
      const seedB = await seedJob(2);

      await applyStepResults({
        jobId: seedA.jobId,
        completionStatus: 'failed',
        reportedSteps: [
          {stepId: seedA.jobSteps[0]?.id as string, status: 'succeeded', error: null},
          {stepId: seedB.jobSteps[0]?.id as string, status: 'succeeded', error: null},
        ],
      });

      // The cross-job step should not have been touched.
      const finalB = await getStepsByJobId(seedB.jobId);
      for (const step of finalB) {
        expect(step.status).toBe('pending');
      }
    });

    describe('strict mode (completionStatus=succeeded)', () => {
      test('throws when reportedSteps is empty', async () => {
        const {jobId} = await seedJob(2);

        await expect(
          applyStepResults({jobId, completionStatus: 'succeeded', reportedSteps: []}),
        ).rejects.toThrow(StepResultsContractViolationError);
      });

      test('throws when a reported stepId is unknown to the job (bogus uuid)', async () => {
        const {jobId, jobSteps} = await seedJob(2);

        await expect(
          applyStepResults({
            jobId,
            completionStatus: 'succeeded',
            reportedSteps: [
              {stepId: jobSteps[0]?.id as string, status: 'succeeded', error: null},
              {
                stepId: '00000000-0000-0000-0000-000000000999',
                status: 'succeeded',
                error: null,
              },
            ],
          }),
        ).rejects.toThrow(StepResultsContractViolationError);

        // No DB writes leaked: every real step still pending.
        const final = await getStepsByJobId(jobId);
        for (const step of final) {
          expect(step.status).toBe('pending');
        }
      });

      test('throws when a canonical stepId is missing from the report', async () => {
        const {jobId, jobSteps} = await seedJob(3);

        await expect(
          applyStepResults({
            jobId,
            completionStatus: 'succeeded',
            reportedSteps: [
              {stepId: jobSteps[0]?.id as string, status: 'succeeded', error: null},
              {stepId: jobSteps[1]?.id as string, status: 'succeeded', error: null},
              // jobSteps[2] missing
            ],
          }),
        ).rejects.toThrow(StepResultsContractViolationError);
      });

      test('throws on duplicate stepIds in the report', async () => {
        const {jobId, jobSteps} = await seedJob(2);
        const stepId = jobSteps[0]?.id as string;

        await expect(
          applyStepResults({
            jobId,
            completionStatus: 'succeeded',
            reportedSteps: [
              {stepId, status: 'succeeded', error: null},
              {stepId, status: 'succeeded', error: null},
              {stepId: jobSteps[1]?.id as string, status: 'succeeded', error: null},
            ],
          }),
        ).rejects.toThrow(StepResultsContractViolationError);
      });
    });
  });
});
