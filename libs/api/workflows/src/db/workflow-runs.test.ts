import {
  WORKFLOWS_JOB_TERMINATED,
  WORKFLOWS_JOB_TIMED_OUT,
  WORKFLOWS_WORKFLOW_RUN_CREATED,
  WORKFLOWS_WORKFLOW_RUN_TERMINATED,
} from '@shipfox/api-workflows-dto';
import {and, eq, sql} from 'drizzle-orm';
import {JobNotFoundError} from '#core/errors.js';
import {recordStepResult} from '#core/job-execution.js';
import {stripSetupStep} from '#test/fixtures/strip-setup-step.js';
import {workflowModel} from '#test/index.js';
import {db} from './db.js';
import {jobs} from './schema/jobs.js';
import {workflowsOutbox} from './schema/outbox.js';
import {steps as stepsTable} from './schema/steps.js';
import {
  bulkUpdateStepStatuses,
  createWorkflowRun,
  failJobAsTimedOut,
  getJobsByRunId,
  getStepsByJobId,
  getWorkflowRunById,
  listWorkflowRunsByProject,
  resolveJobAfterLeaseExpiry,
  updateJobStatus,
  updateWorkflowRunStatus,
} from './workflow-runs.js';

type TestWorkflowModelInput = Parameters<typeof workflowModel>[0];

function buildModel(overrides?: TestWorkflowModelInput) {
  return workflowModel(overrides);
}

function createTestRun(scope: {workspaceId: string; projectId: string; definitionId: string}) {
  return createWorkflowRun({
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    definitionId: scope.definitionId,
    model: buildModel(),
    triggerPayload: {
      source: 'manual',
      event: 'fire',
      subscriptionId: crypto.randomUUID(),
      userId: crypto.randomUUID(),
    },
  });
}

async function jobTerminatedEvents(jobId: string) {
  const rows = await db()
    .select({payload: workflowsOutbox.payload})
    .from(workflowsOutbox)
    .where(
      and(
        eq(workflowsOutbox.eventType, WORKFLOWS_JOB_TERMINATED),
        sql`${workflowsOutbox.payload}->>'jobId' = ${jobId}`,
      ),
    );
  return rows.map((row) => row.payload as {jobId: string; runId: string; status: string});
}

async function runTerminatedEvents(runId: string) {
  const rows = await db()
    .select({payload: workflowsOutbox.payload})
    .from(workflowsOutbox)
    .where(
      and(
        eq(workflowsOutbox.eventType, WORKFLOWS_WORKFLOW_RUN_TERMINATED),
        sql`${workflowsOutbox.payload}->>'runId' = ${runId}`,
      ),
    );
  return rows.map((row) => row.payload as {runId: string; projectId: string; status: string});
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
        model: buildModel(),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });

      expect(run.id).toBeDefined();
      expect(run.projectId).toBe(projectId);
      expect(run.definitionId).toBe(definitionId);
      expect(run.status).toBe('pending');
      expect(run.triggerPayload).toMatchObject({source: 'manual', event: 'fire'});
      expect(run.inputs).toBeNull();
      expect(run.version).toBe(1);
      expect(run.createdAt).toBeInstanceOf(Date);
      expect(run.updatedAt).toBeInstanceOf(Date);

      const runJobs = await getJobsByRunId(run.id);
      expect(runJobs).toHaveLength(1);
      expect(runJobs[0]?.name).toBe('build');

      // Every job gets a synthetic "Set up job" step at position 0; user steps follow.
      const jobSteps = await getStepsByJobId(runJobs[0]?.id as string);
      expect(jobSteps).toHaveLength(2);
      expect(jobSteps[0]).toMatchObject({
        type: 'setup',
        name: 'Set up job',
        position: 0,
        config: {},
      });
      expect(jobSteps[1]).toMatchObject({position: 1, config: {run: 'echo hello'}});
    });

    test('writes workflows.workflow_run.created outbox event in same transaction', async () => {
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

      const outboxRows = await db()
        .select()
        .from(workflowsOutbox)
        .where(eq(workflowsOutbox.eventType, WORKFLOWS_WORKFLOW_RUN_CREATED));

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
            eventType: WORKFLOWS_WORKFLOW_RUN_CREATED,
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
        model: buildModel({
          jobs: {
            build: {steps: [{run: 'echo build'}]},
            test: {needs: 'build', steps: [{run: 'echo test'}]},
          },
        }),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
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
        model: buildModel(),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });

      const runJobs = await getJobsByRunId(run.id);

      expect(runJobs[0]?.dependencies).toEqual([]);
    });

    test('handles multi-job definitions with correct positions', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({
          jobs: {
            lint: {steps: [{run: 'echo lint'}]},
            build: {steps: [{run: 'echo build'}]},
            test: {needs: ['lint', 'build'], steps: [{run: 'echo test'}]},
          },
        }),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
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
        model: buildModel({jobs: {}}),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
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
        model: buildModel({
          jobs: {
            empty: {steps: []},
          },
        }),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });

      const runJobs = await getJobsByRunId(run.id);
      expect(runJobs).toHaveLength(1);

      // A job with no user steps still gets the synthetic setup step.
      const jobSteps = await getStepsByJobId(runJobs[0]?.id as string);

      expect(jobSteps).toHaveLength(1);
      expect(jobSteps[0]).toMatchObject({type: 'setup', name: 'Set up job', position: 0});
    });

    test('stores step with optional name', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({
          jobs: {
            build: {
              steps: [{name: 'Install deps', run: 'npm install'}, {run: 'npm build'}],
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

      const runJobs = await getJobsByRunId(run.id);
      const jobSteps = await getStepsByJobId(runJobs[0]?.id as string);

      // Index 0 is the synthetic setup step; user steps start at index 1.
      expect(jobSteps[0]?.name).toBe('Set up job');
      expect(jobSteps[1]?.name).toBe('Install deps');
      expect(jobSteps[2]?.name).toBeNull();
    });

    test('stores frozen step config', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({
          jobs: {
            build: {steps: [{run: 'make build'}]},
          },
        }),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });

      const runJobs = await getJobsByRunId(run.id);
      const jobSteps = await getStepsByJobId(runJobs[0]?.id as string);

      // Index 0 is the synthetic setup step; the user run step is at index 1.
      expect(jobSteps[1]?.type).toBe('run');
      expect(jobSteps[1]?.config).toEqual({run: 'make build'});
    });

    test('stores inputs when provided', async () => {
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
        inputs: {env: 'staging', verbose: true},
      });

      expect(run.inputs).toEqual({env: 'staging', verbose: true});
    });

    test('duplicate triggerIdempotencyKey returns the existing run without writing jobs/steps/outbox a second time', async () => {
      const subscriptionId = crypto.randomUUID();
      const eventId = crypto.randomUUID();
      const idempotencyKey = `${subscriptionId}:${eventId}`;

      const first = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel(),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId,
          userId: crypto.randomUUID(),
        },
        triggerIdempotencyKey: idempotencyKey,
      });
      const second = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel(),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId,
          userId: crypto.randomUUID(),
        },
        triggerIdempotencyKey: idempotencyKey,
      });

      expect(second.id).toBe(first.id);
      expect(second.triggerIdempotencyKey).toBe(idempotencyKey);

      const allJobs = await getJobsByRunId(first.id);
      expect(allJobs).toHaveLength(1);
      const outboxRows = await db()
        .select()
        .from(workflowsOutbox)
        .where(sql`${workflowsOutbox.payload}->>'runId' = ${first.id}`);
      expect(outboxRows).toHaveLength(1);
    });

    test('null triggerIdempotencyKey allows independent inserts', async () => {
      const a = await createWorkflowRun({
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
      const b = await createWorkflowRun({
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

      expect(b.id).not.toBe(a.id);
      expect(a.triggerIdempotencyKey).toBeNull();
      expect(b.triggerIdempotencyKey).toBeNull();
    });
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

  describe('getJobsByRunId', () => {
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

      const runJobs = await getJobsByRunId(run.id);
      const jobSteps = await getStepsByJobId(runJobs[0]?.id as string);

      // The synthetic setup step occupies position 0; user steps follow at 1..3.
      expect(jobSteps).toHaveLength(4);
      expect(jobSteps[0]).toMatchObject({type: 'setup', position: 0});
      expect(jobSteps[1]?.position).toBe(1);
      expect(jobSteps[2]?.position).toBe(2);
      expect(jobSteps[3]?.position).toBe(3);
    });
  });

  describe('updateWorkflowRunStatus', () => {
    test('updates status and increments version', async () => {
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
        model: buildModel(),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
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

    test('writes one run-terminated event when the status becomes terminal', async () => {
      const run = await createTestRun({workspaceId, projectId, definitionId});

      await updateWorkflowRunStatus({runId: run.id, status: 'succeeded', expectedVersion: 1});

      const events = await runTerminatedEvents(run.id);
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({runId: run.id, projectId: run.projectId, status: 'succeeded'});
    });

    test('writes no run-terminated event for a non-terminal transition', async () => {
      const run = await createTestRun({workspaceId, projectId, definitionId});

      await updateWorkflowRunStatus({runId: run.id, status: 'running', expectedVersion: 1});

      expect(await runTerminatedEvents(run.id)).toHaveLength(0);
    });

    test('idempotent retry: a second terminal update at the stale version emits once', async () => {
      const run = await createTestRun({workspaceId, projectId, definitionId});

      const first = await updateWorkflowRunStatus({
        runId: run.id,
        status: 'failed',
        expectedVersion: 1,
      });
      const retry = await updateWorkflowRunStatus({
        runId: run.id,
        status: 'failed',
        expectedVersion: 1,
      });

      expect(retry.version).toBe(first.version);
      expect(await runTerminatedEvents(run.id)).toHaveLength(1);
    });
  });

  describe('updateJobStatus', () => {
    test('updates status and increments version', async () => {
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
        model: buildModel(),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });
      const runJobs = await getJobsByRunId(run.id);

      await expect(
        updateJobStatus({jobId: runJobs[0]?.id ?? '', status: 'running', expectedVersion: 99}),
      ).rejects.toThrow('Optimistic lock failure');
    });

    test('idempotent on retry: re-applying the same transition at the old version is a no-op', async () => {
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
      const job = (await getJobsByRunId(run.id))[0];
      const first = await updateJobStatus({
        jobId: job?.id as string,
        status: 'running',
        expectedVersion: 1,
      });

      // Simulates a lost Temporal activity result: the row already moved to the
      // requested status at version 2, so the retried expected-version-1 UPDATE
      // matches 0 rows but must return the existing row, not throw.
      const retry = await updateJobStatus({
        jobId: job?.id as string,
        status: 'running',
        expectedVersion: 1,
      });

      expect(retry.status).toBe('running');
      expect(retry.version).toBe(first.version);
    });
  });

  describe('job terminal event (WORKFLOWS_JOB_TERMINATED)', () => {
    async function seedPendingJob() {
      const run = await createTestRun({workspaceId, projectId, definitionId});
      const jobId = (await getJobsByRunId(run.id))[0]?.id as string;
      return {run, jobId};
    }

    test.each([
      'succeeded',
      'failed',
      'cancelled',
    ] as const)('writes one terminated event when a job becomes %s', async (status) => {
      const {run, jobId} = await seedPendingJob();

      await updateJobStatus({jobId, status, expectedVersion: 1});

      const events = await jobTerminatedEvents(jobId);
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({jobId, runId: run.id, status});
    });

    test('writes no terminated event for a non-terminal transition', async () => {
      const {jobId} = await seedPendingJob();

      await updateJobStatus({jobId, status: 'running', expectedVersion: 1});

      expect(await jobTerminatedEvents(jobId)).toHaveLength(0);
    });

    test('idempotent retry: a second terminal update at the stale version emits once', async () => {
      const {jobId} = await seedPendingJob();

      const first = await updateJobStatus({jobId, status: 'succeeded', expectedVersion: 1});
      const retry = await updateJobStatus({jobId, status: 'succeeded', expectedVersion: 1});

      expect(retry.version).toBe(first.version);
      expect(await jobTerminatedEvents(jobId)).toHaveLength(1);
    });

    test('failJobAsTimedOut writes both the timed-out and terminated events', async () => {
      const {run, jobId} = await seedPendingJob();

      await failJobAsTimedOut({jobId, runId: run.id, expectedVersion: 1});

      const terminated = await jobTerminatedEvents(jobId);
      expect(terminated).toHaveLength(1);
      expect(terminated[0]).toEqual({jobId, runId: run.id, status: 'failed'});

      const timedOut = await db()
        .select()
        .from(workflowsOutbox)
        .where(
          and(
            eq(workflowsOutbox.eventType, WORKFLOWS_JOB_TIMED_OUT),
            sql`${workflowsOutbox.payload}->>'jobId' = ${jobId}`,
          ),
        );
      expect(timedOut).toHaveLength(1);
    });

    test('lease-expiry resolution of a running job writes one terminated event', async () => {
      const {jobId} = await seedPendingJob();
      const running = await updateJobStatus({jobId, status: 'running', expectedVersion: 1});

      await resolveJobAfterLeaseExpiry({jobId, expectedVersion: running.version});

      const events = await jobTerminatedEvents(jobId);
      expect(events).toHaveLength(1);
      expect(events[0]?.status).toBe('failed');
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
        model: buildModel(),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
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
        model: buildModel(),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
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
        model: buildModel(),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
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
      const runJobs = await getJobsByRunId(run.id);

      const jobId = runJobs[0]?.id ?? '';
      await bulkUpdateStepStatuses({jobId, status: 'succeeded'});

      // 3 user steps + the synthetic setup step.
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

  describe('resolveJobAfterLeaseExpiry', () => {
    async function seedRunningJob(stepCount: number) {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({
          jobs: {
            build: {steps: Array.from({length: stepCount}, (_, i) => ({run: `step${i + 1}`}))},
          },
        }),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });
      const jobId = (await getJobsByRunId(run.id))[0]?.id as string;
      // These tests exercise step-execution mechanics in isolation, so strip the
      // synthetic setup step and renumber the user steps back to 0-based.
      await stripSetupStep(jobId);
      const running = await updateJobStatus({jobId, status: 'running', expectedVersion: 1});
      const jobSteps = await getStepsByJobId(jobId);
      return {jobId, runningVersion: running.version, jobSteps};
    }

    async function setStepStatus(stepId: string, status: 'succeeded' | 'failed' | 'running') {
      await db().update(stepsTable).set({status}).where(eq(stepsTable.id, stepId));
    }

    async function jobRow(jobId: string) {
      return (await db().select().from(jobs).where(eq(jobs.id, jobId)))[0];
    }

    test('all steps terminal: adopts the derived status without failing', async () => {
      const {jobId, runningVersion, jobSteps} = await seedRunningJob(2);
      for (const step of jobSteps) await setStepStatus(step.id, 'succeeded');

      const result = await resolveJobAfterLeaseExpiry({jobId, expectedVersion: runningVersion});

      expect(result.status).toBe('succeeded');
      expect((await jobRow(jobId))?.status).toBe('succeeded');
      const final = await getStepsByJobId(jobId);
      expect(final.every((step) => step.status === 'succeeded')).toBe(true);
    });

    test('all steps terminal but mixed: adopts failed without cancelling the terminal steps', async () => {
      const {jobId, runningVersion, jobSteps} = await seedRunningJob(2);
      await setStepStatus(jobSteps[0]?.id as string, 'succeeded');
      await setStepStatus(jobSteps[1]?.id as string, 'failed');

      const result = await resolveJobAfterLeaseExpiry({jobId, expectedVersion: runningVersion});

      // deriveCompletion over an all-terminal-but-mixed projection is 'failed', and the
      // adopt branch must NOT run the bulk-cancel sweep, so the already-terminal steps
      // keep their reported statuses.
      expect(result.status).toBe('failed');
      expect((await jobRow(jobId))?.status).toBe('failed');
      const final = await getStepsByJobId(jobId);
      expect(final[0]?.status).toBe('succeeded');
      expect(final[1]?.status).toBe('failed');
    });

    test('runner died mid-job: fails the job and cancels the remaining steps', async () => {
      const {jobId, runningVersion, jobSteps} = await seedRunningJob(3);
      await setStepStatus(jobSteps[0]?.id as string, 'succeeded');

      const result = await resolveJobAfterLeaseExpiry({jobId, expectedVersion: runningVersion});

      expect(result.status).toBe('failed');
      expect((await jobRow(jobId))?.status).toBe('failed');
      const final = await getStepsByJobId(jobId);
      expect(final[0]?.status).toBe('succeeded');
      expect(final[1]?.status).toBe('cancelled');
      expect(final[2]?.status).toBe('cancelled');
    });

    test('job with no steps: throws JobNotFoundError instead of silently failing the malformed job', async () => {
      const {jobId, runningVersion} = await seedRunningJob(0);

      await expect(
        resolveJobAfterLeaseExpiry({jobId, expectedVersion: runningVersion}),
      ).rejects.toBeInstanceOf(JobNotFoundError);

      expect((await jobRow(jobId))?.status).toBe('running');
    });

    test('does not flip a row a concurrent DAG-cancel already terminalised; reports it truthfully', async () => {
      const {jobId, runningVersion} = await seedRunningJob(2);
      // run-orchestration cancelled the job (steps left non-terminal), bumping the version.
      await updateJobStatus({jobId, status: 'cancelled', expectedVersion: runningVersion});

      // The lease-expiry resolver runs with the now-stale running version.
      const result = await resolveJobAfterLeaseExpiry({jobId, expectedVersion: runningVersion});

      expect(result.status).toBe('failed'); // cancelled maps to failed for the DAG
      expect((await jobRow(jobId))?.status).toBe('cancelled'); // not flipped to failed
    });

    test('idempotent on retry: a second resolve at the stale version is a no-op', async () => {
      const {jobId, runningVersion} = await seedRunningJob(2);

      const first = await resolveJobAfterLeaseExpiry({jobId, expectedVersion: runningVersion});
      const second = await resolveJobAfterLeaseExpiry({jobId, expectedVersion: runningVersion});

      expect(first.status).toBe('failed');
      expect(second.status).toBe('failed');
      expect(second.jobVersion).toBe(first.jobVersion);
    });

    test('concurrent with recordStepResult: serializes on FOR UPDATE, no deadlock, terminal end state', async () => {
      const {jobId, runningVersion, jobSteps} = await seedRunningJob(2);
      await setStepStatus(jobSteps[0]?.id as string, 'running');

      const [resolved, recorded] = await Promise.allSettled([
        resolveJobAfterLeaseExpiry({jobId, expectedVersion: runningVersion}),
        recordStepResult({
          jobId,
          stepId: jobSteps[0]?.id as string,
          status: 'succeeded',
          exitCode: 0,
        }),
      ]);

      expect(resolved.status).toBe('fulfilled');
      expect(recorded.status).toBe('fulfilled');
      expect(['succeeded', 'failed', 'cancelled']).toContain((await jobRow(jobId))?.status);
    });
  });
});
