import type {AgentDefaultsResolver} from '@shipfox/api-agent/core/resolve-agent-config';
import {normalizeWorkflowDocument} from '@shipfox/api-definitions';
import {
  WORKFLOWS_JOB_TERMINATED,
  WORKFLOWS_JOB_TIMED_OUT,
  WORKFLOWS_STEP_ATTEMPT_TERMINATED,
  WORKFLOWS_WORKFLOW_RUN_CANCELLED,
  WORKFLOWS_WORKFLOW_RUN_CREATED,
  WORKFLOWS_WORKFLOW_RUN_TERMINATED,
} from '@shipfox/api-workflows-dto';
import * as opentelemetry from '@shipfox/node-opentelemetry';
import {and, eq, sql} from 'drizzle-orm';
import {
  JobNotFoundError,
  NoFailedJobsError,
  RunNotTerminalError,
  SourceRunNotFoundError,
  WorkflowRunNotCancellableError,
} from '#core/errors.js';
import {nextStepForJob, recordStepResult} from '#core/job-execution.js';
import {stripSetupStep} from '#test/fixtures/strip-setup-step.js';
import {workflowModel} from '#test/index.js';
import {db} from './db.js';
import {jobs} from './schema/jobs.js';
import {workflowsOutbox} from './schema/outbox.js';
import {steps as stepsTable} from './schema/steps.js';
import {workflowRuns} from './schema/workflow-runs.js';
import {
  bulkUpdateStepStatuses,
  cancelWorkflowRun,
  createRerunWorkflowRun,
  createWorkflowRun,
  failJobAsTimedOut,
  getFirstExecutionByJobId,
  getJobsByRunId,
  getLatestAttempt,
  getStepAttempts,
  getStepByIdForJob,
  getStepsByJobId,
  getWorkflowExecutionDepth,
  getWorkflowRunById,
  listRunAttempts,
  listWorkflowRunsByProject,
  resolveJobAfterLeaseExpiry,
  updateExecutionStatus,
  updateJobStatus,
  updateWorkflowRunStatus,
} from './workflow-runs.js';

type TestWorkflowModelInput = Parameters<typeof workflowModel>[0];

function buildModel(overrides?: TestWorkflowModelInput) {
  return workflowModel(overrides);
}

function template(source: string): string {
  return `\${{ ${source} }}`;
}

function shellRef(name: string): string {
  return `\${${name}}`;
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
  return rows.map(
    (row) =>
      row.payload as {
        jobId: string;
        runId: string;
        status: string;
        statusReason: string | null;
      },
  );
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

async function runCancelledEvents(runId: string) {
  const rows = await db()
    .select({payload: workflowsOutbox.payload})
    .from(workflowsOutbox)
    .where(
      and(
        eq(workflowsOutbox.eventType, WORKFLOWS_WORKFLOW_RUN_CANCELLED),
        sql`${workflowsOutbox.payload}->>'runId' = ${runId}`,
      ),
    );
  return rows.map((row) => row.payload as {runId: string; projectId: string});
}

async function workflowRunCreatedEvents(runId: string) {
  const rows = await db()
    .select({payload: workflowsOutbox.payload})
    .from(workflowsOutbox)
    .where(
      and(
        eq(workflowsOutbox.eventType, WORKFLOWS_WORKFLOW_RUN_CREATED),
        sql`${workflowsOutbox.payload}->>'runId' = ${runId}`,
      ),
    );
  return rows.map(
    (row) =>
      row.payload as {
        runId: string;
        workspaceId: string;
        projectId: string;
        definitionId: string;
      },
  );
}

async function stepAttemptTerminatedEvents(jobId: string) {
  const rows = await db()
    .select({payload: workflowsOutbox.payload})
    .from(workflowsOutbox)
    .where(
      and(
        eq(workflowsOutbox.eventType, WORKFLOWS_STEP_ATTEMPT_TERMINATED),
        sql`${workflowsOutbox.payload}->>'jobId' = ${jobId}`,
      ),
    );
  return rows.map((row) => row.payload);
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

    test('persists resolved step config and authored step config separately', async () => {
      const model = normalizeWorkflowDocument({
        name: 'Interpolated workflow',
        runner: 'ubuntu-latest',
        env: {RUN_ID: template('run.id'), REF: template('event.ref')},
        jobs: {
          build: {
            steps: [{run: `echo "${template('run.id')}"`}],
          },
        },
      });

      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model,
        triggerPayload: {
          source: 'github',
          event: 'push',
          deliveryId: 'delivery-1',
          data: {ref: 'refs/heads/main'},
        },
      });

      const [job] = await getJobsByRunId(run.id);
      const rows = await db()
        .select({
          type: stepsTable.type,
          config: stepsTable.config,
          authoredConfig: stepsTable.authoredConfig,
        })
        .from(stepsTable)
        .where(eq(stepsTable.jobId, job?.id as string))
        .orderBy(stepsTable.position);

      expect(rows[1]).toEqual({
        type: 'run',
        config: {
          run: `echo "${shellRef('__sf_0')}"`,
          env: {RUN_ID: run.id, REF: 'refs/heads/main', __sf_0: run.id},
        },
        authoredConfig: {
          run: `echo "${template('run.id')}"`,
          env: {RUN_ID: template('run.id'), REF: template('event.ref')},
        },
      });

      const steps = await getStepsByJobId(job?.id as string);
      expect(steps[1]?.authoredConfig).toEqual({
        run: `echo "${template('run.id')}"`,
        env: {RUN_ID: template('run.id'), REF: template('event.ref')},
      });
    });

    test('logs enriched diagnostics for missing untrusted interpolation paths', async () => {
      const warn = vi.fn();
      vi.spyOn(opentelemetry, 'logger').mockReturnValue({warn} as never);
      const model = normalizeWorkflowDocument({
        name: 'Diagnostic workflow',
        runner: 'ubuntu-latest',
        env: {REF: template('event.ref')},
        jobs: {
          build: {
            steps: [{run: 'echo ok'}],
          },
        },
      });

      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model,
        triggerPayload: {
          source: 'github',
          event: 'push',
          deliveryId: 'delivery-1',
          data: {},
        },
      });

      expect(warn).toHaveBeenCalledWith(
        {
          runId: run.id,
          diagnostics: [
            {
              jobName: 'build',
              stepDisplayName: 'echo ok',
              reason: 'missing-path',
              expression: 'event.ref',
              contextRoots: ['event'],
              field: 'env',
              envKey: 'REF',
            },
          ],
        },
        'Workflow interpolation resolved with diagnostics',
      );
    });

    test('gets a step only when it belongs to the requested job', async () => {
      const runA = await createTestRun({workspaceId, projectId, definitionId});
      const runB = await createTestRun({
        workspaceId,
        projectId,
        definitionId: crypto.randomUUID(),
      });
      const [jobA] = await getJobsByRunId(runA.id);
      const [jobB] = await getJobsByRunId(runB.id);
      const [stepA] = await getStepsByJobId(jobA?.id as string);

      const found = await getStepByIdForJob({
        stepId: stepA?.id as string,
        jobId: jobA?.id as string,
      });
      const wrongJob = await getStepByIdForJob({
        stepId: stepA?.id as string,
        jobId: jobB?.id as string,
      });

      expect(found?.id).toBe(stepA?.id);
      expect(wrongJob).toBeUndefined();
    });

    test('rolls back outbox event when transaction fails', async () => {
      const marker = crypto.randomUUID();

      const transaction = db().transaction(async (tx) => {
        await tx.insert(workflowsOutbox).values({
          eventType: WORKFLOWS_WORKFLOW_RUN_CREATED,
          payload: {runId: marker, projectId, definitionId},
        });
        throw new Error('Simulated failure');
      });

      await expect(transaction).rejects.toThrow('Simulated failure');

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

    test('stores prompt-only agent steps with runtime agent defaults resolved', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({
          jobs: {
            fix: {steps: [{prompt: 'Fix the failing tests.'}]},
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
      const agentStep = jobSteps.find((step) => step.type === 'agent');

      expect(agentStep).toMatchObject({
        type: 'agent',
        config: {
          model: 'claude-opus-4-8',
          provider: 'anthropic',
          thinking: 'high',
          prompt: 'Fix the failing tests.',
        },
      });
    });

    test('stores agent step config resolved by the injected resolver', async () => {
      const resolveAgentDefaults = vi.fn<AgentDefaultsResolver>().mockReturnValue({
        provider: 'openai',
        model: 'gpt-5.5-pro',
        thinking: 'medium',
      });

      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({
          jobs: {
            fix: {steps: [{prompt: 'Fix the failing tests.'}]},
          },
        }),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
        resolveAgentDefaults,
      });

      const runJobs = await getJobsByRunId(run.id);
      const jobSteps = await getStepsByJobId(runJobs[0]?.id as string);
      const agentStep = jobSteps.find((step) => step.type === 'agent');
      expect(resolveAgentDefaults).toHaveBeenCalledWith({
        provider: undefined,
        model: undefined,
        thinking: undefined,
      });
      expect(agentStep?.config).toEqual({
        model: 'gpt-5.5-pro',
        provider: 'openai',
        thinking: 'medium',
        prompt: 'Fix the failing tests.',
      });
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

    test('stores source locations for authored steps', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({
          jobs: {
            build: {
              steps: [
                {run: 'npm install', sourceLocation: {startLine: 5, endLine: 6}},
                {run: 'npm test', sourceLocation: {startLine: 7, endLine: 10}},
              ],
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

      expect(jobSteps.map((step) => step.sourceLocation)).toEqual([
        null,
        {startLine: 5, endLine: 6},
        {startLine: 7, endLine: 10},
      ]);
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

    test('stores the exact source snapshot when provided', async () => {
      const sourceContent = `name: Exact
# keep comment and spacing
jobs:
  build:
    steps:
      - run: echo "hello"
`;

      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({name: 'Exact'}),
        sourceSnapshot: {content: sourceContent, format: 'yaml'},
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });

      const found = await getWorkflowRunById(run.id);

      expect(run.sourceSnapshot).toEqual({content: sourceContent, format: 'yaml'});
      expect(found?.sourceSnapshot).toEqual({content: sourceContent, format: 'yaml'});
    });

    test('stores null source snapshot when omitted', async () => {
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

      const found = await getWorkflowRunById(run.id);

      expect(run.sourceSnapshot).toBeNull();
      expect(found?.sourceSnapshot).toBeNull();
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
        sourceSnapshot: {content: 'name: Original\njobs: {}\n', format: 'yaml'},
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
        sourceSnapshot: {content: 'name: Mutated\njobs: {}\n', format: 'yaml'},
        triggerIdempotencyKey: idempotencyKey,
      });

      expect(second.id).toBe(first.id);
      expect(second.triggerIdempotencyKey).toBe(idempotencyKey);
      expect(second.sourceSnapshot).toEqual({
        content: 'name: Original\njobs: {}\n',
        format: 'yaml',
      });

      const allJobs = await getJobsByRunId(first.id);
      expect(allJobs).toHaveLength(1);
      const outboxRows = await db()
        .select()
        .from(workflowsOutbox)
        .where(sql`${workflowsOutbox.payload}->>'runId' = ${first.id}`);
      expect(outboxRows).toHaveLength(1);
    });

    test('duplicate triggerIdempotencyKey returns the existing run without re-materializing', async () => {
      const subscriptionId = crypto.randomUUID();
      const eventId = crypto.randomUUID();
      const idempotencyKey = `${subscriptionId}:${eventId}`;
      const model = buildModel({
        jobs: {
          fix: {steps: [{prompt: 'Fix the failing tests.'}]},
        },
      });
      const firstResolver = vi.fn<AgentDefaultsResolver>().mockReturnValue({
        provider: 'openai',
        model: 'gpt-5.5-pro',
        thinking: 'medium',
      });
      const secondResolver = vi.fn<AgentDefaultsResolver>().mockImplementation(() => {
        throw new Error('agent defaults unavailable');
      });
      const first = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model,
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId,
          userId: crypto.randomUUID(),
        },
        triggerIdempotencyKey: idempotencyKey,
        resolveAgentDefaults: firstResolver,
      });

      const replay = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model,
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId,
          userId: crypto.randomUUID(),
        },
        triggerIdempotencyKey: idempotencyKey,
        resolveAgentDefaults: secondResolver,
      });

      expect(replay.id).toBe(first.id);
      expect(firstResolver).toHaveBeenCalledTimes(1);
      expect(secondResolver).not.toHaveBeenCalled();

      const allJobs = await getJobsByRunId(first.id);
      expect(allJobs).toHaveLength(1);
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

  describe('createRerunWorkflowRun', () => {
    function rerunModel() {
      return buildModel({
        jobs: {
          build: {steps: [{run: 'echo build'}]},
          test: {needs: 'build', steps: [{run: 'echo test'}]},
          deploy: {needs: 'test', steps: [{run: 'echo deploy'}]},
          notify: {steps: [{run: 'echo notify'}]},
        },
      });
    }

    async function createTerminalSourceRun() {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: rerunModel(),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
        inputs: {env: 'staging'},
        sourceSnapshot: {content: 'name: Original\njobs: {}\n', format: 'yaml'},
      });
      const runJobs = await getJobsByRunId(run.id);
      await Promise.all([
        markJob(runJobs, 'build', 'succeeded'),
        markJob(runJobs, 'test', 'failed'),
        markJob(runJobs, 'deploy', 'skipped'),
        markJob(runJobs, 'notify', 'cancelled'),
      ]);
      await updateWorkflowRunStatus({runId: run.id, status: 'failed', expectedVersion: 1});

      return run;
    }

    async function markJob(
      runJobs: Awaited<ReturnType<typeof getJobsByRunId>>,
      name: string,
      status: 'succeeded' | 'failed' | 'cancelled' | 'skipped',
    ) {
      const job = runJobs.find((candidate) => candidate.name === name);
      if (!job) throw new Error(`Missing job ${name}`);
      await db().update(jobs).set({status}).where(eq(jobs.id, job.id));
      await db()
        .update(stepsTable)
        .set({
          status: status === 'skipped' ? 'cancelled' : status,
          output: status === 'succeeded' ? {job: name} : null,
          error: status === 'failed' ? {message: 'failed'} : null,
        })
        .where(eq(stepsTable.jobId, job.id));
    }

    test('all mode resets every job and step to pending', async () => {
      const source = await createTerminalSourceRun();

      const rerun = await createRerunWorkflowRun({
        sourceRunId: source.id,
        mode: 'all',
        actorUserId: crypto.randomUUID(),
      });

      expect(rerun).toMatchObject({
        sourceRunId: source.id,
        rootRunId: source.id,
        attempt: 2,
        rerunMode: 'all',
        inputs: {env: 'staging'},
        sourceSnapshot: {content: 'name: Original\njobs: {}\n', format: 'yaml'},
      });
      const sourceAfter = await getWorkflowRunById(source.id);
      expect(sourceAfter?.rootRunId).toBe(source.id);

      const rerunJobs = await getJobsByRunId(rerun.id);
      expect(rerunJobs.every((job) => job.status === 'pending' && !job.carriedOver)).toBe(true);
      for (const job of rerunJobs) {
        const jobSteps = await getStepsByJobId(job.id);
        expect(jobSteps.every((step) => step.status === 'pending')).toBe(true);
        expect(jobSteps.every((step) => step.output === null && step.error === null)).toBe(true);
      }
    });

    test('reruns preserve the original resolved agent step config', async () => {
      const resolveAgentDefaults = vi.fn<AgentDefaultsResolver>().mockReturnValue({
        provider: 'openai',
        model: 'gpt-5.5-pro',
        thinking: 'medium',
      });
      const source = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({
          jobs: {
            fix: {steps: [{prompt: 'Fix the failing tests.'}]},
          },
        }),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
        resolveAgentDefaults,
      });
      const sourceJobs = await getJobsByRunId(source.id);
      await markJob(sourceJobs, 'fix', 'failed');
      await updateWorkflowRunStatus({runId: source.id, status: 'failed', expectedVersion: 1});

      const rerun = await createRerunWorkflowRun({
        sourceRunId: source.id,
        mode: 'all',
        actorUserId: crypto.randomUUID(),
      });

      const rerunJobs = await getJobsByRunId(rerun.id);
      const rerunSteps = await getStepsByJobId(rerunJobs[0]?.id as string);
      const agentStep = rerunSteps.find((step) => step.type === 'agent');
      expect(resolveAgentDefaults).toHaveBeenCalledTimes(1);
      expect(agentStep?.config).toEqual({
        model: 'gpt-5.5-pro',
        provider: 'openai',
        thinking: 'medium',
        prompt: 'Fix the failing tests.',
      });
    });

    test('reruns clone authored step config', async () => {
      const source = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({jobs: {build: {steps: [{run: `echo "${template('run.id')}"`}]}}}),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });
      await updateWorkflowRunStatus({runId: source.id, status: 'failed', expectedVersion: 1});

      const rerun = await createRerunWorkflowRun({
        sourceRunId: source.id,
        mode: 'all',
        actorUserId: crypto.randomUUID(),
      });
      const rerunJobs = await getJobsByRunId(rerun.id);
      const [userStep] = await db()
        .select({authoredConfig: stepsTable.authoredConfig})
        .from(stepsTable)
        .where(eq(stepsTable.jobId, rerunJobs[0]?.id as string))
        .orderBy(stepsTable.position)
        .offset(1)
        .limit(1);

      expect(userStep?.authoredConfig).toEqual({run: `echo "${template('run.id')}"`});
    });

    test('writes one workflow_run.created outbox event for the rerun', async () => {
      const source = await createTerminalSourceRun();

      const rerun = await createRerunWorkflowRun({
        sourceRunId: source.id,
        mode: 'all',
        actorUserId: crypto.randomUUID(),
      });

      const events = await workflowRunCreatedEvents(rerun.id);
      expect(events).toEqual([
        {
          runId: rerun.id,
          workspaceId: rerun.workspaceId,
          projectId: rerun.projectId,
          definitionId: rerun.definitionId,
        },
      ]);
    });

    test('failed mode carries succeeded jobs and resets every non-succeeded job', async () => {
      const source = await createTerminalSourceRun();

      const rerun = await createRerunWorkflowRun({
        sourceRunId: source.id,
        mode: 'failed',
        actorUserId: crypto.randomUUID(),
      });

      const rerunJobs = await getJobsByRunId(rerun.id);
      const build = rerunJobs.find((job) => job.name === 'build');
      const test = rerunJobs.find((job) => job.name === 'test');
      const deploy = rerunJobs.find((job) => job.name === 'deploy');
      const notify = rerunJobs.find((job) => job.name === 'notify');
      expect(build).toMatchObject({status: 'succeeded', carriedOver: true});
      expect(test).toMatchObject({status: 'pending', carriedOver: false});
      expect(deploy).toMatchObject({status: 'pending', carriedOver: false});
      expect(notify).toMatchObject({status: 'pending', carriedOver: false});

      const buildSteps = await getStepsByJobId(build?.id as string);
      expect(buildSteps.every((step) => step.status === 'succeeded')).toBe(true);
      expect(buildSteps.every((step) => step.output?.job === 'build')).toBe(true);
      expect(buildSteps.every((step) => step.currentAttempt === 1)).toBe(true);
      expect(await getStepAttempts(build?.id as string)).toEqual([]);

      for (const job of [test, deploy, notify]) {
        const jobSteps = await getStepsByJobId(job?.id as string);
        expect(jobSteps.every((step) => step.status === 'pending')).toBe(true);
        expect(jobSteps.every((step) => step.output === null && step.error === null)).toBe(true);
      }
    });

    test('increments attempts across a lineage', async () => {
      const source = await createTerminalSourceRun();

      const second = await createRerunWorkflowRun({
        sourceRunId: source.id,
        mode: 'all',
        actorUserId: crypto.randomUUID(),
      });
      await updateWorkflowRunStatus({runId: second.id, status: 'failed', expectedVersion: 1});
      const third = await createRerunWorkflowRun({
        sourceRunId: second.id,
        mode: 'all',
        actorUserId: crypto.randomUUID(),
      });

      expect(second.attempt).toBe(2);
      expect(third).toMatchObject({attempt: 3, rootRunId: source.id, sourceRunId: second.id});
    });

    test('allocates unique attempts for concurrent reruns on the same lineage', async () => {
      const source = await createTerminalSourceRun();

      const [left, right] = await Promise.all([
        createRerunWorkflowRun({
          sourceRunId: source.id,
          mode: 'all',
          actorUserId: crypto.randomUUID(),
        }),
        createRerunWorkflowRun({
          sourceRunId: source.id,
          mode: 'all',
          actorUserId: crypto.randomUUID(),
        }),
      ]);

      expect([left.attempt, right.attempt].sort()).toEqual([2, 3]);
      expect(left.rootRunId).toBe(source.id);
      expect(right.rootRunId).toBe(source.id);
    });

    test('rejects non-terminal sources and failed-mode runs with no failed jobs', async () => {
      const running = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: rerunModel(),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });
      const succeeded = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: rerunModel(),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });
      await updateWorkflowRunStatus({runId: succeeded.id, status: 'succeeded', expectedVersion: 1});

      await expect(
        createRerunWorkflowRun({
          sourceRunId: running.id,
          mode: 'all',
          actorUserId: crypto.randomUUID(),
        }),
      ).rejects.toBeInstanceOf(RunNotTerminalError);
      await expect(
        createRerunWorkflowRun({
          sourceRunId: succeeded.id,
          mode: 'failed',
          actorUserId: crypto.randomUUID(),
        }),
      ).rejects.toBeInstanceOf(NoFailedJobsError);
    });

    test('rejects a missing source run', async () => {
      await expect(
        createRerunWorkflowRun({
          sourceRunId: crypto.randomUUID(),
          mode: 'all',
          actorUserId: crypto.randomUUID(),
        }),
      ).rejects.toBeInstanceOf(SourceRunNotFoundError);
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
      await updateWorkflowRunStatus({runId: source.id, status: 'failed', expectedVersion: 1});
      const second = await createRerunWorkflowRun({
        sourceRunId: source.id,
        mode: 'all',
        actorUserId: crypto.randomUUID(),
      });
      await updateWorkflowRunStatus({runId: second.id, status: 'failed', expectedVersion: 1});
      const third = await createRerunWorkflowRun({
        sourceRunId: second.id,
        mode: 'all',
        actorUserId: crypto.randomUUID(),
      });

      const attempts = await listRunAttempts({rootRunId: source.id, projectId});
      const latestAttempt = await getLatestAttempt({rootRunId: source.id, projectId});

      expect(attempts.map((attempt) => attempt.id)).toEqual([source.id, second.id, third.id]);
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
      await db()
        .update(workflowRuns)
        .set({rootRunId: run.id, attempt: 99})
        .where(eq(workflowRuns.id, otherProjectRun.id));

      const attempts = await listRunAttempts({rootRunId: run.id, projectId});

      expect(attempts.map((attempt) => attempt.id)).toEqual([run.id]);
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

  describe('getWorkflowExecutionDepth', () => {
    test('counts running runs and jobs for a workspace', async () => {
      const runningRun = await createTestRun({workspaceId, projectId, definitionId});
      const pendingRun = await createTestRun({workspaceId, projectId, definitionId});
      const otherWorkspaceRun = await createTestRun({
        workspaceId: crypto.randomUUID(),
        projectId: crypto.randomUUID(),
        definitionId: crypto.randomUUID(),
      });
      const [runningJob] = await getJobsByRunId(runningRun.id);
      const [otherWorkspaceJob] = await getJobsByRunId(otherWorkspaceRun.id);
      if (!runningJob || !otherWorkspaceJob) throw new Error('Expected workflow jobs');
      const runningExecution = await getFirstExecutionByJobId(runningJob.id);
      const otherWorkspaceExecution = await getFirstExecutionByJobId(otherWorkspaceJob.id);
      if (!runningExecution || !otherWorkspaceExecution) {
        throw new Error('Expected workflow job executions');
      }
      await updateWorkflowRunStatus({
        runId: runningRun.id,
        status: 'running',
        expectedVersion: runningRun.version,
      });
      await updateWorkflowRunStatus({
        runId: otherWorkspaceRun.id,
        status: 'running',
        expectedVersion: otherWorkspaceRun.version,
      });
      await updateExecutionStatus({
        executionId: runningExecution.id,
        status: 'running',
        expectedVersion: runningExecution.version,
      });
      await updateExecutionStatus({
        executionId: otherWorkspaceExecution.id,
        status: 'running',
        expectedVersion: otherWorkspaceExecution.version,
      });

      const depth = await getWorkflowExecutionDepth({workspaceId});

      expect(pendingRun.status).toBe('pending');
      expect(depth).toEqual({runningRuns: 1, runningJobs: 1});
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

    test('preserves terminal status reason when a later transition is ignored', async () => {
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

      const skipped = await updateJobStatus({
        jobId: job?.id as string,
        status: 'skipped',
        expectedVersion: 1,
        statusReason: 'dependency_not_completed',
      });
      const retry = await updateJobStatus({
        jobId: job?.id as string,
        status: 'running',
        expectedVersion: 2,
      });

      expect(skipped.statusReason).toBe('dependency_not_completed');
      expect(retry.status).toBe('skipped');
      expect(retry.statusReason).toBe('dependency_not_completed');
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

    test.each([
      'succeeded',
      'failed',
      'cancelled',
    ] as const)('writes one run-terminated event when the status becomes %s', async (status) => {
      const run = await createTestRun({workspaceId, projectId, definitionId});

      await updateWorkflowRunStatus({runId: run.id, status, expectedVersion: 1});

      const events = await runTerminatedEvents(run.id);
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({runId: run.id, projectId: run.projectId, status});
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

    test('terminal-tolerant mismatch: existing terminal run returns without re-emitting', async () => {
      const run = await createTestRun({workspaceId, projectId, definitionId});
      const cancelled = await updateWorkflowRunStatus({
        runId: run.id,
        status: 'cancelled',
        expectedVersion: 1,
      });

      const retry = await updateWorkflowRunStatus({
        runId: run.id,
        status: 'running',
        expectedVersion: 1,
      });

      expect(retry.status).toBe('cancelled');
      expect(retry.version).toBe(cancelled.version);
      expect(await runTerminatedEvents(run.id)).toHaveLength(1);
    });

    test('terminal-tolerant match: existing terminal run cannot be revived at the current version', async () => {
      const run = await createTestRun({workspaceId, projectId, definitionId});
      const cancelled = await updateWorkflowRunStatus({
        runId: run.id,
        status: 'cancelled',
        expectedVersion: 1,
      });

      const retry = await updateWorkflowRunStatus({
        runId: run.id,
        status: 'running',
        expectedVersion: cancelled.version,
      });

      expect(retry.status).toBe('cancelled');
      expect(retry.version).toBe(cancelled.version);
      expect(await getWorkflowRunById(run.id)).toMatchObject({
        status: 'cancelled',
        version: cancelled.version,
      });
      expect(await runTerminatedEvents(run.id)).toHaveLength(1);
    });
  });

  describe('cancelWorkflowRun', () => {
    test('cancels the run, non-terminal jobs, and only their non-terminal steps', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({
          jobs: {
            running: {steps: [{run: 'a'}, {run: 'b'}]},
            succeeded: {steps: [{run: 'ok'}]},
            skipped: {steps: [{run: 'skip'}]},
          },
        }),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });
      await updateWorkflowRunStatus({runId: run.id, status: 'running', expectedVersion: 1});
      const [runningJob, succeededJob, skippedJob] = await getJobsByRunId(run.id);
      if (!runningJob || !succeededJob || !skippedJob) throw new Error('Expected jobs');
      await updateJobStatus({jobId: runningJob.id, status: 'running', expectedVersion: 1});
      await nextStepForJob(runningJob.id);
      await updateJobStatus({jobId: succeededJob.id, status: 'succeeded', expectedVersion: 1});
      await updateJobStatus({
        jobId: skippedJob.id,
        status: 'skipped',
        expectedVersion: 1,
        statusReason: 'dependency_not_completed',
      });

      const cancelled = await cancelWorkflowRun({runId: run.id});

      expect(cancelled.status).toBe('cancelled');
      expect(cancelled.finishedAt).not.toBeNull();
      const [finalRunning, finalSucceeded, finalSkipped] = await getJobsByRunId(run.id);
      expect(finalRunning).toMatchObject({status: 'cancelled', statusReason: 'run_cancelled'});
      expect(finalSucceeded).toMatchObject({status: 'succeeded', statusReason: null});
      expect(finalSkipped).toMatchObject({
        status: 'skipped',
        statusReason: 'dependency_not_completed',
      });
      expect((await getStepsByJobId(runningJob.id)).map((step) => step.status)).toEqual([
        'cancelled',
        'cancelled',
        'cancelled',
      ]);
      expect(
        (await getStepsByJobId(skippedJob.id)).every((step) => step.status === 'pending'),
      ).toBe(true);
      expect(await runTerminatedEvents(run.id)).toEqual([
        {runId: run.id, projectId, status: 'cancelled'},
      ]);
      expect(await runCancelledEvents(run.id)).toEqual([{runId: run.id, projectId}]);
      expect(await jobTerminatedEvents(runningJob.id)).toEqual([
        {
          jobId: runningJob.id,
          runId: run.id,
          status: 'cancelled',
          statusReason: 'run_cancelled',
        },
      ]);
      expect(await stepAttemptTerminatedEvents(runningJob.id)).toHaveLength(1);
      expect(await jobTerminatedEvents(succeededJob.id)).toHaveLength(1);
      expect(await jobTerminatedEvents(skippedJob.id)).toHaveLength(1);
    });

    test('throws without changing an already-terminal run', async () => {
      const run = await createTestRun({workspaceId, projectId, definitionId});
      const finished = await updateWorkflowRunStatus({
        runId: run.id,
        status: 'succeeded',
        expectedVersion: 1,
      });

      await expect(cancelWorkflowRun({runId: run.id})).rejects.toBeInstanceOf(
        WorkflowRunNotCancellableError,
      );

      expect(await getWorkflowRunById(run.id)).toMatchObject({
        status: 'succeeded',
        version: finished.version,
      });
      expect(await runCancelledEvents(run.id)).toHaveLength(0);
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

    test('rejects status reasons outside the database enum', async () => {
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

      const writeInvalidReason = db().execute(
        sql`UPDATE ${jobs} SET status_reason = 'not_a_reason' WHERE id = ${job?.id}`,
      );

      await expect(writeInvalidReason).rejects.toMatchObject({
        cause: expect.objectContaining({code: '22P02'}),
      });
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

    test('terminal-tolerant mismatch: existing terminal job returns without re-emitting', async () => {
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
      const cancelled = await updateJobStatus({
        jobId: job?.id as string,
        status: 'cancelled',
        expectedVersion: 1,
      });

      const retry = await updateJobStatus({
        jobId: job?.id as string,
        status: 'running',
        expectedVersion: 1,
      });

      expect(retry.status).toBe('cancelled');
      expect(retry.version).toBe(cancelled.version);
      expect(await jobTerminatedEvents(job?.id as string)).toHaveLength(1);
    });

    test('terminal-tolerant match: existing terminal job cannot be revived at the current version', async () => {
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
      const cancelled = await updateJobStatus({
        jobId: job?.id as string,
        status: 'cancelled',
        expectedVersion: 1,
      });

      const retry = await updateJobStatus({
        jobId: job?.id as string,
        status: 'running',
        expectedVersion: cancelled.version,
      });

      expect(retry.status).toBe('cancelled');
      expect(retry.version).toBe(cancelled.version);
      expect((await getJobsByRunId(run.id))[0]).toMatchObject({
        status: 'cancelled',
        version: cancelled.version,
      });
      expect(await jobTerminatedEvents(job?.id as string)).toHaveLength(1);
    });
  });

  describe('run and job lifecycle timing', () => {
    test('run: stamps started_at on running and preserves it through the terminal transition', async () => {
      const run = await createTestRun({workspaceId, projectId, definitionId});

      const running = await updateWorkflowRunStatus({
        runId: run.id,
        status: 'running',
        expectedVersion: 1,
      });

      expect(running.startedAt).not.toBeNull();
      expect(running.finishedAt).toBeNull();

      const finished = await updateWorkflowRunStatus({
        runId: run.id,
        status: 'succeeded',
        expectedVersion: 2,
      });

      expect(finished.finishedAt).not.toBeNull();
      expect(finished.startedAt?.getTime()).toBe(running.startedAt?.getTime());
    });

    test('run: cancelled straight from pending has no start but a finish', async () => {
      const run = await createTestRun({workspaceId, projectId, definitionId});

      const cancelled = await updateWorkflowRunStatus({
        runId: run.id,
        status: 'cancelled',
        expectedVersion: 1,
      });

      expect(cancelled.startedAt).toBeNull();
      expect(cancelled.finishedAt).not.toBeNull();
    });

    test.each([
      'succeeded',
      'failed',
      'cancelled',
      'skipped',
    ] as const)('job: stamps finished_at on a %s terminal transition', async (status) => {
      const run = await createTestRun({workspaceId, projectId, definitionId});
      const job = (await getJobsByRunId(run.id))[0];

      const finished = await updateJobStatus({
        jobId: job?.id as string,
        status,
        expectedVersion: 1,
      });

      expect(finished.finishedAt).not.toBeNull();
    });

    test('job: leaves finished_at null on a non-terminal transition', async () => {
      const run = await createTestRun({workspaceId, projectId, definitionId});
      const job = (await getJobsByRunId(run.id))[0];

      const running = await updateJobStatus({
        jobId: job?.id as string,
        status: 'running',
        expectedVersion: 1,
      });

      expect(running.finishedAt).toBeNull();
    });

    test('job: failJobAsTimedOut stamps finished_at alongside timed_out_at', async () => {
      const run = await createTestRun({workspaceId, projectId, definitionId});
      const job = (await getJobsByRunId(run.id))[0];

      const updated = await failJobAsTimedOut({
        jobId: job?.id as string,
        runId: run.id,
        expectedVersion: 1,
      });

      expect(updated.finishedAt).not.toBeNull();
      expect(updated.timedOutAt).not.toBeNull();
      expect(updated.statusReason).toBe('timed_out');
    });

    test('run: re-entering running keeps the first started_at (coalesce, not a fresh clock)', async () => {
      const run = await createTestRun({workspaceId, projectId, definitionId});
      const firstRunning = await updateWorkflowRunStatus({
        runId: run.id,
        status: 'running',
        expectedVersion: 1,
      });

      const secondRunning = await updateWorkflowRunStatus({
        runId: run.id,
        status: 'running',
        expectedVersion: 2,
      });

      expect(secondRunning.startedAt?.getTime()).toBe(firstRunning.startedAt?.getTime());
    });

    test('job: cancelled straight from pending has a finish but no start or queue time', async () => {
      const run = await createTestRun({workspaceId, projectId, definitionId});
      const job = (await getJobsByRunId(run.id))[0];

      const cancelled = await updateJobStatus({
        jobId: job?.id as string,
        status: 'cancelled',
        expectedVersion: 1,
      });

      expect(cancelled.finishedAt).not.toBeNull();
      expect(cancelled.startedAt).toBeNull();
      expect(cancelled.queuedAt).toBeNull();
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
      'skipped',
    ] as const)('writes one terminated event when a job becomes %s', async (status) => {
      const {run, jobId} = await seedPendingJob();

      await updateJobStatus({jobId, status, expectedVersion: 1});

      const events = await jobTerminatedEvents(jobId);
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({jobId, runId: run.id, status, statusReason: null});
    });

    test('writes status reason on the terminated event', async () => {
      const {run, jobId} = await seedPendingJob();

      await updateJobStatus({
        jobId,
        status: 'skipped',
        expectedVersion: 1,
        statusReason: 'dependency_not_completed',
      });

      const events = await jobTerminatedEvents(jobId);
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        jobId,
        runId: run.id,
        status: 'skipped',
        statusReason: 'dependency_not_completed',
      });
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
      expect(terminated[0]).toEqual({
        jobId,
        runId: run.id,
        status: 'failed',
        statusReason: 'timed_out',
      });

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
      const execution = await getFirstExecutionByJobId(job?.id as string);
      expect(execution).toBeDefined();

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
      expect(outboxRows[0]?.payload).toEqual({
        jobId: job?.id,
        executionId: execution?.id,
        runId: run.id,
      });
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

      // Simulate a separate writer that bumped version and status without
      // setting timed_out_at.
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
      const runJobs = await getJobsByRunId(run.id);
      const jobId = runJobs[0]?.id ?? '';
      await stripSetupStep(jobId);
      await nextStepForJob(jobId);

      await bulkUpdateStepStatuses({jobId, status: 'cancelled'});

      const [attempt] = await getStepAttempts(jobId);
      expect(attempt).toMatchObject({status: 'cancelled', logOutcome: 'abandoned'});
      expect(await stepAttemptTerminatedEvents(jobId)).toMatchObject([
        {
          jobId,
          runId: run.id,
          workspaceId,
          projectId,
          stepId: attempt?.stepId,
          attempt: 1,
          logOutcome: 'abandoned',
        },
      ]);
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

    test('does not flip a row a concurrent cancellation already terminalised; reports it truthfully', async () => {
      const {jobId, runningVersion} = await seedRunningJob(2);

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
