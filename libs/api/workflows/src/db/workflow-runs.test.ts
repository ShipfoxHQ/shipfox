import type {AgentDefaultsResolver} from '@shipfox/api-agent/core/resolve-agent-config';
import {normalizeWorkflowDocument} from '@shipfox/api-definitions';
import {
  WORKFLOWS_JOB_TERMINATED,
  WORKFLOWS_STEP_ATTEMPT_TERMINATED,
  WORKFLOWS_WORKFLOW_RUN_ATTEMPT_CREATED,
  WORKFLOWS_WORKFLOW_RUN_CANCELLED,
  WORKFLOWS_WORKFLOW_RUN_TERMINATED,
} from '@shipfox/api-workflows-dto';
import {createWorkflowExpression} from '@shipfox/expression';
import {and, eq, inArray, sql} from 'drizzle-orm';
import type {JobExecution} from '#core/entities/job-execution.js';
import {
  InterpolationUnresolvableError,
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
import {jobExecutions} from './schema/job-executions.js';
import {jobs} from './schema/jobs.js';
import {workflowsOutbox} from './schema/outbox.js';
import {steps as stepsTable} from './schema/steps.js';
import {workflowRunAttempts} from './schema/workflow-run-attempts.js';
import {workflowRuns} from './schema/workflow-runs.js';
import {
  bulkUpdateStepStatuses,
  cancelWorkflowRun,
  createRerunWorkflowRun,
  createWorkflowRun,
  evaluateJobSuccess,
  getFirstJobExecutionByJobId,
  getJobExecutionsByJobId,
  getJobsByWorkflowRunId,
  getLatestAttempt,
  getStepAttempts,
  getStepsByJobId,
  getWorkflowJobExecutionDepth,
  getWorkflowRunAttemptById,
  getWorkflowRunById,
  getWorkflowRunDetail,
  listRunAttempts,
  listWorkflowRunsByProject,
  resolveJobStatusFromJobExecutions,
  updateJobExecutionStatus,
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

function expression(source: string) {
  return createWorkflowExpression({source, check: {mode: 'syntax'}});
}

function stepOutputField(stepKey: string, outputKey: string) {
  return {
    segments: [
      {
        kind: 'deferred' as const,
        expression: createWorkflowExpression({
          source: `steps.${stepKey}.outputs.${outputKey}`,
          check: {mode: 'syntax'},
        }),
        roots: ['steps'],
        fillTarget: 'step-dispatch' as const,
      },
    ],
  };
}

function shellRef(name: string): string {
  return `\${${name}}`;
}

async function bulkUpdateJobStepStatuses(
  params: Omit<Parameters<typeof bulkUpdateStepStatuses>[0], 'jobExecutionId'> & {jobId: string},
) {
  const jobExecution = await getFirstJobExecutionByJobId(params.jobId);
  if (!jobExecution) throw new JobNotFoundError(params.jobId);
  await bulkUpdateStepStatuses({jobExecutionId: jobExecution.id, status: params.status});
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
        workflowRunId: string;
        status: string;
        statusReason: string | null;
      },
  );
}

async function runTerminatedEvents(workflowRunId: string) {
  const rows = await db()
    .select({payload: workflowsOutbox.payload})
    .from(workflowsOutbox)
    .where(
      and(
        eq(workflowsOutbox.eventType, WORKFLOWS_WORKFLOW_RUN_TERMINATED),
        sql`${workflowsOutbox.payload}->>'workflowRunId' = ${workflowRunId}`,
      ),
    );
  return rows.map(
    (row) =>
      row.payload as {
        workflowRunId: string;
        workflowRunAttemptId: string;
        projectId: string;
        status: string;
      },
  );
}

async function runCancelledEvents(workflowRunId: string) {
  const rows = await db()
    .select({payload: workflowsOutbox.payload})
    .from(workflowsOutbox)
    .where(
      and(
        eq(workflowsOutbox.eventType, WORKFLOWS_WORKFLOW_RUN_CANCELLED),
        sql`${workflowsOutbox.payload}->>'workflowRunId' = ${workflowRunId}`,
      ),
    );
  return rows.map(
    (row) =>
      row.payload as {workflowRunId: string; workflowRunAttemptId: string; projectId: string},
  );
}

async function runAttemptCreatedEvents(workflowRunId: string) {
  const rows = await db()
    .select({payload: workflowsOutbox.payload})
    .from(workflowsOutbox)
    .where(
      and(
        eq(workflowsOutbox.eventType, WORKFLOWS_WORKFLOW_RUN_ATTEMPT_CREATED),
        sql`${workflowsOutbox.payload}->>'workflowRunId' = ${workflowRunId}`,
      ),
    );
  return rows.map(
    (row) =>
      row.payload as {
        workflowRunId: string;
        workflowRunAttemptId: string;
        attempt: number;
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
      expect(run.triggerProvider).toBeNull();
      expect(run.triggerPayload).toMatchObject({source: 'manual', event: 'fire'});
      expect(run.inputs).toBeNull();
      expect(run.version).toBe(1);
      expect(run.createdAt).toBeInstanceOf(Date);
      expect(run.updatedAt).toBeInstanceOf(Date);

      const runJobs = await getJobsByWorkflowRunId(run.id);
      expect(runJobs).toHaveLength(1);
      expect(runJobs[0]?.key).toBe('build');
      expect(runJobs[0]?.name).toBeNull();
      expect(runJobs[0]?.checkout).toEqual({
        permissions: {contents: 'read'},
        persistCredentials: true,
      });

      const jobExecutions = await getJobExecutionsByJobId(runJobs[0]?.id as string);
      expect(jobExecutions).toHaveLength(1);
      expect(jobExecutions[0]).toMatchObject({
        jobId: runJobs[0]?.id,
        sequence: 1,
        name: 'build #1',
      });

      // Every job gets a synthetic "Set up job" step at position 0; user steps follow.
      const jobSteps = await getStepsByJobId(runJobs[0]?.id as string);
      expect(jobSteps).toHaveLength(2);
      expect(jobSteps.every((step) => step.jobExecutionId === jobExecutions[0]?.id)).toBe(true);
      expect(jobSteps[0]).toMatchObject({
        type: 'setup',
        name: 'Set up job',
        position: 0,
        config: {},
      });
      expect(jobSteps[1]).toMatchObject({position: 1, config: {run: 'echo hello'}});
    });

    test('persists the resolved one-shot job execution name', async () => {
      const model = buildModel({
        jobs: {
          deploy: {
            name: `Deploy ${template('inputs.environment')}`,
            steps: [{run: 'echo deploy'}],
          },
        },
      });

      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model,
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
        inputs: {environment: 'prod'},
      });

      const [job] = await getJobsByWorkflowRunId(run.id);
      if (!job) throw new Error('Missing deploy job');
      const executions = await getJobExecutionsByJobId(job.id);
      expect(executions[0]?.name).toBe('Deploy prod');
    });

    test('falls back to the job key and sequence for unnamed one-shot executions', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({
          jobs: {
            deploy: {
              steps: [{run: 'echo deploy'}],
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

      const [job] = await getJobsByWorkflowRunId(run.id);
      if (!job) throw new Error('Missing deploy job');
      const executions = await getJobExecutionsByJobId(job.id);
      expect(executions[0]?.name).toBe('deploy #1');
    });

    test('uses the fallback name for execution-name self references', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({
          jobs: {
            deploy: {
              name: `Current ${template('execution.name')}`,
              steps: [{run: 'echo deploy'}],
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

      const [job] = await getJobsByWorkflowRunId(run.id);
      if (!job) throw new Error('Missing deploy job');
      const executions = await getJobExecutionsByJobId(job.id);
      expect(executions[0]?.name).toBe('Current deploy #1');
    });

    test('persists the parsed model on the run attempt', async () => {
      const model = buildModel({
        env: {RUN_ID: template('run.id')},
        jobs: {
          build: {
            name: `Build ${template('event.ref')}`,
            steps: [
              {
                run: 'npm test',
                env: {REF: template('event.ref')},
                gate: {successIf: expression('step.exit_code == 0')},
              },
            ],
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

      const [attemptSummary] = await listRunAttempts({workflowRunId: run.id, projectId});
      const attempt = await getWorkflowRunAttemptById(attemptSummary?.id as string);
      expect(attempt?.model).toEqual(model);
    });

    test('returns the persisted model in run detail', async () => {
      const model = buildModel({
        env: {RUN_ID: template('run.id')},
        jobs: {
          build: {
            steps: [{run: 'echo first'}, {run: 'echo second'}],
          },
        },
      });
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model,
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });

      const detail = await getWorkflowRunDetail(run.id);

      expect(detail?.runAttempt.model).toEqual(model);
      expect(detail?.jobs).toHaveLength(1);
      expect(detail?.jobs[0]?.jobExecutions[0]?.steps).toHaveLength(3);
    });

    test('persists explicit checkout policy on jobs', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({
          jobs: {
            build: {
              checkout: {
                permissions: {contents: 'write'},
                persistCredentials: false,
              },
              steps: [{run: 'echo hello'}],
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
      expect(runJobs[0]?.checkout).toEqual({
        permissions: {contents: 'write'},
        persistCredentials: false,
      });
    });

    test('persists listening job config without initial execution or steps', async () => {
      const displayNameSource = ['Review batch $', '{{ execution.index }}'].join('');
      const stepNameSource = ['Review $', '{{ execution.index }}'].join('');
      const promptSource = ['Review $', '{{ execution.events[0].data.body }}'].join('');
      const model = normalizeWorkflowDocument({
        name: 'Listening workflow',
        runner: 'ubuntu-latest',
        jobs: {
          listen: {
            name: displayNameSource,
            listening: {
              on: [{source: 'github', event: 'pull_request_review'}],
              until: [{source: 'github', event: 'pull_request'}],
              timeout: '30d',
              max_executions: 3,
              batch: {debounce: '5s', max_size: 10, max_wait: '1h'},
              on_resolve: 'cancel',
            },
            steps: [{name: stepNameSource, prompt: promptSource}],
          },
          build: {
            steps: [{run: 'echo build'}],
          },
        },
      });

      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model,
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });

      const runJobs = await getJobsByWorkflowRunId(run.id);
      const listen = runJobs.find((job) => job.key === 'listen');
      const build = runJobs.find((job) => job.key === 'build');
      expect(listen).toMatchObject({
        mode: 'listening',
        name: displayNameSource,
        listeningTimeoutMs: 30 * 24 * 60 * 60 * 1000,
        maxExecutions: 3,
        onResolve: 'cancel',
        batchDebounceMs: 5000,
        batchMaxSize: 10,
        batchMaxWaitMs: 60 * 60 * 1000,
        listenerStatus: 'inactive',
        resolutionReason: null,
        listeningOn: [{source: 'github', event: 'pull_request_review'}],
        listeningUntil: [{source: 'github', event: 'pull_request'}],
      });
      expect(build).toMatchObject({mode: 'one_shot', listenerStatus: 'inactive'});

      const listenExecutions = await getJobExecutionsByJobId(listen?.id as string);
      const listenSteps = await getStepsByJobId(listen?.id as string);
      expect(listenExecutions).toEqual([]);
      expect(listenSteps).toEqual([]);

      const buildExecutions = await getJobExecutionsByJobId(build?.id as string);
      const buildSteps = await getStepsByJobId(build?.id as string);
      expect(buildExecutions).toHaveLength(1);
      expect(buildSteps).toHaveLength(2);
      expect(buildSteps[0]).toMatchObject({type: 'setup', name: 'Set up job', position: 0});
      expect(buildSteps[1]).toMatchObject({type: 'run', config: {run: 'echo build'}, position: 1});
    });

    test('persists the listening workflow model on the run attempt', async () => {
      const displayNameSource = ['Review batch $', '{{ execution.index }}'].join('');
      const promptSource = ['Review $', '{{ execution.events[0].data.body }}'].join('');
      const model = normalizeWorkflowDocument({
        name: 'Listening workflow',
        runner: 'ubuntu-latest',
        jobs: {
          listen: {
            name: displayNameSource,
            listening: {
              on: [{source: 'github', event: 'pull_request_review'}],
              until: [{source: 'github', event: 'pull_request'}],
              timeout: '30d',
              max_executions: 3,
              batch: {debounce: '5s', max_size: 10, max_wait: '1h'},
              on_resolve: 'cancel',
            },
            steps: [{prompt: promptSource}],
          },
          build: {
            steps: [{run: 'echo build'}],
          },
        },
      });

      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model,
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });

      const [attemptSummary] = await listRunAttempts({workflowRunId: run.id, projectId});
      const attempt = await getWorkflowRunAttemptById(attemptSummary?.id as string);
      expect(attempt?.model).toEqual(model);
    });

    test('does not load variables referenced only by listening job executions at run creation', async () => {
      const model = normalizeWorkflowDocument({
        name: 'Listening vars workflow',
        runner: 'ubuntu-latest',
        jobs: {
          listen: {
            listening: {
              on: [{source: 'github', event: 'pull_request_review'}],
              until: [{source: 'github', event: 'pull_request'}],
            },
            steps: [
              {
                run: 'echo region',
                env: {REGION: template('vars.REGION')},
              },
            ],
          },
        },
      });

      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model,
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });

      const runJobs = await getJobsByWorkflowRunId(run.id);
      const listen = runJobs[0];
      expect(listen).toMatchObject({mode: 'listening'});
      await expect(getJobExecutionsByJobId(listen?.id as string)).resolves.toEqual([]);
    });

    test.each([
      {
        field: 'run',
        model: () =>
          normalizeWorkflowDocument({
            name: 'Missing run var',
            runner: 'ubuntu-latest',
            jobs: {build: {steps: [{run: `echo ${template('vars.REQUIRED')}`}]}},
          }),
        expected: {field: 'run', source: 'vars.REQUIRED'},
      },
      {
        field: 'env',
        model: () =>
          normalizeWorkflowDocument({
            name: 'Missing env var',
            runner: 'ubuntu-latest',
            jobs: {
              build: {
                steps: [{run: 'echo ok', env: {REGION: template('vars.REQUIRED')}}],
              },
            },
          }),
        expected: {field: 'env', envKey: 'REGION', source: 'vars.REQUIRED'},
      },
      {
        field: 'agent.prompt',
        model: () =>
          normalizeWorkflowDocument({
            name: 'Missing prompt var',
            runner: 'ubuntu-latest',
            jobs: {fix: {steps: [{prompt: template('vars.REQUIRED')}]}},
          }),
        expected: {field: 'agent.prompt', source: 'vars.REQUIRED'},
      },
      {
        field: 'agent.model',
        model: () =>
          normalizeWorkflowDocument({
            name: 'Missing model var',
            runner: 'ubuntu-latest',
            jobs: {fix: {steps: [{prompt: 'Fix it', model: template('vars.REQUIRED')}]}},
          }),
        expected: {field: 'agent.model', source: 'vars.REQUIRED'},
      },
      {
        field: 'agent.provider',
        model: () =>
          normalizeWorkflowDocument({
            name: 'Missing provider var',
            runner: 'ubuntu-latest',
            jobs: {fix: {steps: [{prompt: 'Fix it', provider: template('vars.REQUIRED')}]}},
          }),
        expected: {field: 'agent.provider', source: 'vars.REQUIRED'},
      },
      {
        field: 'step.name',
        model: () =>
          normalizeWorkflowDocument({
            name: 'Missing step name var',
            runner: 'ubuntu-latest',
            jobs: {build: {steps: [{name: template('vars.REQUIRED'), run: 'echo ok'}]}},
          }),
        expected: {field: 'step.name', source: 'vars.REQUIRED'},
      },
    ] as const)('reports missing variables against $field', async ({model, expected}) => {
      let error: unknown;
      try {
        await createWorkflowRun({
          workspaceId,
          projectId,
          definitionId,
          model: model(),
          triggerPayload: {
            source: 'manual',
            event: 'fire',
            subscriptionId: crypto.randomUUID(),
            userId: crypto.randomUUID(),
          },
        });
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(InterpolationUnresolvableError);
      expect(error).toMatchObject(expected);
    });

    test('writes workflows.workflow_run_attempt.created outbox event in same transaction', async () => {
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
        .where(eq(workflowsOutbox.eventType, WORKFLOWS_WORKFLOW_RUN_ATTEMPT_CREATED));

      const matchingRow = outboxRows.find(
        (row) => (row.payload as Record<string, unknown>).workflowRunId === run.id,
      );

      expect(matchingRow).toBeDefined();
      expect(matchingRow?.payload).toMatchObject({
        workflowRunId: run.id,
        attempt: 1,
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

      const [job] = await getJobsByWorkflowRunId(run.id);
      const rows = (await getStepsByJobId(job?.id as string)).map((step) => ({
        type: step.type,
        config: step.config,
        authoredConfig: step.authoredConfig,
      }));

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

    test('resolves webhook trigger payload body and headers into step config', async () => {
      const model = normalizeWorkflowDocument({
        name: 'Webhook workflow',
        runner: 'ubuntu-latest',
        env: {
          PAYMENT_ID: template('event.body.payment_id'),
          SIGNATURE: template('event.headers["x-stripe-signature"]'),
        },
        jobs: {
          build: {
            steps: [{run: 'echo webhook'}],
          },
        },
      });

      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model,
        triggerPayload: {
          provider: 'webhook',
          source: 'stripe_prod',
          event: 'received',
          deliveryId: 'delivery-1',
          data: {
            method: 'POST',
            headers: {'x-stripe-signature': 'sig_123'},
            query: {mode: 'live'},
            body: {payment_id: 'pay_123'},
          },
        },
      });

      const [job] = await getJobsByWorkflowRunId(run.id);
      const steps = await getStepsByJobId(job?.id as string);

      expect(steps[1]?.config).toEqual({
        run: 'echo webhook',
        env: {
          PAYMENT_ID: 'pay_123',
          SIGNATURE: 'sig_123',
        },
      });
    });

    test('fails for missing available untrusted interpolation paths', async () => {
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

      let error: unknown;
      try {
        await createWorkflowRun({
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
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(InterpolationUnresolvableError);
      expect(error).toMatchObject({
        field: 'env',
        source: 'event.ref',
        envKey: 'REF',
      });
      const runs = await db()
        .select()
        .from(workflowRuns)
        .where(
          and(
            eq(workflowRuns.workspaceId, workspaceId),
            eq(workflowRuns.definitionId, definitionId),
          ),
        );
      expect(runs).toEqual([]);
    });

    test('rolls back outbox event when transaction fails', async () => {
      const marker = crypto.randomUUID();

      const transaction = db().transaction(async (tx) => {
        await tx.insert(workflowsOutbox).values({
          eventType: WORKFLOWS_WORKFLOW_RUN_ATTEMPT_CREATED,
          payload: {workflowRunId: marker, projectId, definitionId},
        });
        throw new Error('Simulated failure');
      });

      await expect(transaction).rejects.toThrow('Simulated failure');

      const leaked = await db()
        .select()
        .from(workflowsOutbox)
        .where(sql`${workflowsOutbox.payload}->>'workflowRunId' = ${marker}`);

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

      const runJobs = await getJobsByWorkflowRunId(run.id);
      const testJob = runJobs.find((j) => j.key === 'test');

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

      const runJobs = await getJobsByWorkflowRunId(run.id);

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

      const runJobs = await getJobsByWorkflowRunId(run.id);
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

      const runJobs = await getJobsByWorkflowRunId(run.id);
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

      const runJobs = await getJobsByWorkflowRunId(run.id);

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

      const runJobs = await getJobsByWorkflowRunId(run.id);

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

      const runJobs = await getJobsByWorkflowRunId(run.id);
      expect(runJobs).toHaveLength(1);

      // A job with no user steps still gets the synthetic setup step.
      const jobSteps = await getStepsByJobId(runJobs[0]?.id as string);

      expect(jobSteps).toHaveLength(1);
      expect(jobSteps[0]).toMatchObject({type: 'setup', name: 'Set up job', position: 0});
    });

    test('stores step display names', async () => {
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

      const runJobs = await getJobsByWorkflowRunId(run.id);
      const jobSteps = await getStepsByJobId(runJobs[0]?.id as string);

      // Index 0 is the synthetic setup step; user steps start at index 1.
      expect(jobSteps[0]?.name).toBe('Set up job');
      expect(jobSteps[1]?.name).toBe('Install deps');
      expect(jobSteps[2]?.name).toBe('npm build');
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

      const runJobs = await getJobsByWorkflowRunId(run.id);
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

      const runJobs = await getJobsByWorkflowRunId(run.id);
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
      const model = buildModel({name: 'Original idempotent model'});

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
        sourceSnapshot: {content: 'name: Original\njobs: {}\n', format: 'yaml'},
        triggerIdempotencyKey: idempotencyKey,
      });
      const second = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({name: 'Mutated idempotent model'}),
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

      const allJobs = await getJobsByWorkflowRunId(first.id);
      expect(allJobs).toHaveLength(1);
      const attempts = await listRunAttempts({workflowRunId: first.id, projectId});
      expect(attempts).toHaveLength(1);
      expect(attempts[0]?.model).toEqual(model);
      const outboxRows = await db()
        .select()
        .from(workflowsOutbox)
        .where(sql`${workflowsOutbox.payload}->>'workflowRunId' = ${first.id}`);
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

      const allJobs = await getJobsByWorkflowRunId(first.id);
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
      const runJobs = await getJobsByWorkflowRunId(run.id);
      await Promise.all([
        markJob(runJobs, 'build', 'succeeded'),
        markJob(runJobs, 'test', 'failed'),
        markJob(runJobs, 'deploy', 'skipped'),
        markJob(runJobs, 'notify', 'cancelled'),
      ]);
      await updateWorkflowRunStatus({workflowRunId: run.id, status: 'failed', expectedVersion: 1});

      return run;
    }

    async function markJob(
      runJobs: Awaited<ReturnType<typeof getJobsByWorkflowRunId>>,
      key: string,
      status: 'succeeded' | 'failed' | 'cancelled' | 'skipped',
    ) {
      const job = runJobs.find((candidate) => candidate.key === key);
      if (!job) throw new Error(`Missing job ${key}`);
      await db().update(jobs).set({status}).where(eq(jobs.id, job.id));
      const jobSteps = await getStepsByJobId(job.id);
      await db()
        .update(stepsTable)
        .set({
          status: status === 'skipped' ? 'cancelled' : status,
          error: status === 'failed' ? {message: 'failed'} : null,
        })
        .where(
          inArray(
            stepsTable.id,
            jobSteps.map((step) => step.id),
          ),
        );
    }

    test('all mode resets every job and step to pending', async () => {
      const source = await createTerminalSourceRun();

      const rerun = await createRerunWorkflowRun({
        workflowRunId: source.id,
        mode: 'all',
        actorUserId: crypto.randomUUID(),
      });

      expect(rerun).toMatchObject({
        id: source.id,
        inputs: {env: 'staging'},
        sourceSnapshot: {content: 'name: Original\njobs: {}\n', format: 'yaml'},
      });
      const sourceAfter = await getWorkflowRunById(source.id);
      expect(sourceAfter?.currentAttempt).toBe(2);
      const attempts = await listRunAttempts({workflowRunId: source.id, projectId});
      expect(attempts.map((attempt) => attempt.attempt).sort()).toEqual([1, 2]);

      const rerunJobs = await getJobsByWorkflowRunId(rerun.id);
      expect(rerunJobs.every((job) => job.status === 'pending' && !job.carriedOver)).toBe(true);
      for (const job of rerunJobs) {
        const jobSteps = await getStepsByJobId(job.id);
        expect(jobSteps.every((step) => step.status === 'pending')).toBe(true);
        expect(jobSteps.every((step) => step.error === null)).toBe(true);
      }
    });

    test('reruns clone the parsed model onto the new attempt', async () => {
      const source = await createTerminalSourceRun();

      await createRerunWorkflowRun({
        workflowRunId: source.id,
        mode: 'all',
        actorUserId: crypto.randomUUID(),
      });

      const attempts = await listRunAttempts({workflowRunId: source.id, projectId});
      const sourceAttempt = attempts.find((attempt) => attempt.attempt === 1);
      const rerunAttempt = attempts.find((attempt) => attempt.attempt === 2);
      const reloadedRerunAttempt = await getWorkflowRunAttemptById(rerunAttempt?.id as string);
      expect(reloadedRerunAttempt?.model).toEqual(sourceAttempt?.model);
    });

    test('reruns preserve each source job checkout policy', async () => {
      const source = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({
          jobs: {
            build: {
              checkout: {
                permissions: {contents: 'write'},
                persistCredentials: false,
              },
              steps: [{run: 'echo build'}],
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
      const sourceJobs = await getJobsByWorkflowRunId(source.id);
      await markJob(sourceJobs, 'build', 'failed');
      await updateWorkflowRunStatus({
        workflowRunId: source.id,
        status: 'failed',
        expectedVersion: 1,
      });

      const rerun = await createRerunWorkflowRun({
        workflowRunId: source.id,
        mode: 'all',
        actorUserId: crypto.randomUUID(),
      });

      const rerunJobs = await getJobsByWorkflowRunId(rerun.id);
      expect(rerunJobs[0]?.checkout).toEqual({
        permissions: {contents: 'write'},
        persistCredentials: false,
      });
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
      const sourceJobs = await getJobsByWorkflowRunId(source.id);
      await markJob(sourceJobs, 'fix', 'failed');
      await updateWorkflowRunStatus({
        workflowRunId: source.id,
        status: 'failed',
        expectedVersion: 1,
      });

      const rerun = await createRerunWorkflowRun({
        workflowRunId: source.id,
        mode: 'all',
        actorUserId: crypto.randomUUID(),
      });

      const rerunJobs = await getJobsByWorkflowRunId(rerun.id);
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
      await updateWorkflowRunStatus({
        workflowRunId: source.id,
        status: 'failed',
        expectedVersion: 1,
      });

      const rerun = await createRerunWorkflowRun({
        workflowRunId: source.id,
        mode: 'all',
        actorUserId: crypto.randomUUID(),
      });
      const rerunJobs = await getJobsByWorkflowRunId(rerun.id);
      const userStep = (await getStepsByJobId(rerunJobs[0]?.id as string))[1];

      expect(userStep?.authoredConfig).toEqual({run: `echo "${template('run.id')}"`});
    });

    test('reruns dispatch from the preserved step config plan', async () => {
      const source = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({jobs: {build: {steps: [{run: 'build'}, {run: 'deploy'}]}}}),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });
      const sourceJobs = await getJobsByWorkflowRunId(source.id);
      const sourceJob = sourceJobs[0];
      if (!sourceJob) throw new Error('Expected source job');
      await stripSetupStep(sourceJob.id);
      const sourceSteps = await getStepsByJobId(sourceJob.id);
      const sourceProducer = sourceSteps[0];
      const sourceConsumer = sourceSteps[1];
      if (!sourceProducer || !sourceConsumer) throw new Error('Expected source steps');
      const shaPlan = stepOutputField('build', 'sha');
      await db().update(stepsTable).set({key: 'build'}).where(eq(stepsTable.id, sourceProducer.id));
      await db()
        .update(stepsTable)
        .set({
          key: 'deploy',
          config: {run: 'deploy', env: {SHA: 'old-snapshot'}},
          configPlan: {env: {SHA: shaPlan}},
        })
        .where(eq(stepsTable.id, sourceConsumer.id));
      await updateWorkflowRunStatus({
        workflowRunId: source.id,
        status: 'failed',
        expectedVersion: 1,
      });
      const rerun = await createRerunWorkflowRun({
        workflowRunId: source.id,
        mode: 'all',
        actorUserId: crypto.randomUUID(),
      });
      const rerunJobs = await getJobsByWorkflowRunId(rerun.id);
      const rerunJob = rerunJobs[0];
      if (!rerunJob) throw new Error('Expected rerun job');
      const producer = await nextStepForJob(rerunJob.id);
      if (producer.kind !== 'step') throw new Error('Expected producer step');
      await recordStepResult({
        jobExecutionId: producer.step.jobExecutionId,
        stepId: producer.step.id,
        status: 'succeeded',
        output: {sha: 'new-snapshot'},
      });

      const consumer = await nextStepForJob(rerunJob.id);

      expect(consumer).toEqual({
        kind: 'step',
        step: expect.objectContaining({
          key: 'deploy',
          config: {run: 'deploy', env: {SHA: 'new-snapshot'}},
          configPlan: {env: {SHA: shaPlan}},
        }),
      });
      const attempts = await getStepAttempts(rerunJob.id);
      expect(attempts.find((attempt) => attempt.stepId === sourceConsumer.id)).toBeUndefined();
      expect(attempts.find((attempt) => attempt.stepId !== producer.step.id)).toMatchObject({
        config: {run: 'deploy', env: {SHA: 'new-snapshot'}},
      });
    });

    test('reruns copy the source job execution name', async () => {
      const source = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({
          jobs: {
            deploy: {
              name: `Deploy ${template('inputs.environment')}`,
              steps: [{run: 'echo deploy'}],
            },
          },
        }),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
        inputs: {environment: 'prod'},
      });
      const [sourceJob] = await getJobsByWorkflowRunId(source.id);
      if (!sourceJob) throw new Error('Missing deploy job');
      await markJob([sourceJob], 'deploy', 'failed');
      const [sourceExecution] = await getJobExecutionsByJobId(sourceJob.id);
      if (!sourceExecution) throw new Error('Missing deploy execution');
      await db()
        .update(jobExecutions)
        .set({name: 'Deploy prod (attempt 1)'})
        .where(eq(jobExecutions.id, sourceExecution.id));
      await updateWorkflowRunStatus({
        workflowRunId: source.id,
        status: 'failed',
        expectedVersion: 1,
      });

      const rerun = await createRerunWorkflowRun({
        workflowRunId: source.id,
        mode: 'all',
        actorUserId: crypto.randomUUID(),
      });

      const [rerunJob] = await getJobsByWorkflowRunId(rerun.id);
      if (!rerunJob) throw new Error('Missing rerun deploy job');
      const [rerunExecution] = await getJobExecutionsByJobId(rerunJob.id);
      expect(rerunExecution?.name).toBe('Deploy prod (attempt 1)');
    });

    test('writes one run-attempt-created outbox event for the rerun', async () => {
      const source = await createTerminalSourceRun();

      const rerun = await createRerunWorkflowRun({
        workflowRunId: source.id,
        mode: 'all',
        actorUserId: crypto.randomUUID(),
      });

      const events = await runAttemptCreatedEvents(rerun.id);
      expect(events.find((event) => event.attempt === 2)).toEqual(
        expect.objectContaining({
          workflowRunId: rerun.id,
          attempt: 2,
          workspaceId: rerun.workspaceId,
          projectId: rerun.projectId,
          definitionId: rerun.definitionId,
        }),
      );
    });

    test('failed mode carries succeeded jobs and resets every non-succeeded job', async () => {
      const source = await createTerminalSourceRun();

      const rerun = await createRerunWorkflowRun({
        workflowRunId: source.id,
        mode: 'failed',
        actorUserId: crypto.randomUUID(),
      });

      const rerunJobs = await getJobsByWorkflowRunId(rerun.id);
      const build = rerunJobs.find((job) => job.key === 'build');
      const test = rerunJobs.find((job) => job.key === 'test');
      const deploy = rerunJobs.find((job) => job.key === 'deploy');
      const notify = rerunJobs.find((job) => job.key === 'notify');
      expect(build).toMatchObject({status: 'succeeded', carriedOver: true});
      expect(test).toMatchObject({status: 'pending', carriedOver: false});
      expect(deploy).toMatchObject({status: 'pending', carriedOver: false});
      expect(notify).toMatchObject({status: 'pending', carriedOver: false});

      const buildSteps = await getStepsByJobId(build?.id as string);
      expect(buildSteps.every((step) => step.status === 'succeeded')).toBe(true);
      expect(buildSteps.every((step) => step.currentAttempt === 1)).toBe(true);
      expect(await getStepAttempts(build?.id as string)).toEqual([]);
      const buildExecutions = await getJobExecutionsByJobId(build?.id as string);
      expect(buildExecutions).toHaveLength(1);
      expect(buildExecutions[0]).toMatchObject({
        jobId: build?.id,
        status: 'succeeded',
      });
      expect(buildExecutions[0]?.finishedAt).toBeInstanceOf(Date);

      for (const job of [test, deploy, notify]) {
        const jobSteps = await getStepsByJobId(job?.id as string);
        expect(jobSteps.every((step) => step.status === 'pending')).toBe(true);
        expect(jobSteps.every((step) => step.error === null)).toBe(true);
      }
    });

    test('increments attempts across a lineage', async () => {
      const source = await createTerminalSourceRun();

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

      expect(second.currentAttempt).toBe(2);
      expect(second.id).toBe(source.id);
      expect(third).toMatchObject({id: source.id, currentAttempt: 3});
    });

    test('rejects a concurrent rerun while a new attempt is active', async () => {
      const source = await createTerminalSourceRun();

      const results = await Promise.allSettled([
        createRerunWorkflowRun({
          workflowRunId: source.id,
          mode: 'all',
          actorUserId: crypto.randomUUID(),
        }),
        createRerunWorkflowRun({
          workflowRunId: source.id,
          mode: 'all',
          actorUserId: crypto.randomUUID(),
        }),
      ]);

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
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
      await updateWorkflowRunStatus({
        workflowRunId: succeeded.id,
        status: 'succeeded',
        expectedVersion: 1,
      });

      await expect(
        createRerunWorkflowRun({
          workflowRunId: running.id,
          mode: 'all',
          actorUserId: crypto.randomUUID(),
        }),
      ).rejects.toBeInstanceOf(RunNotTerminalError);
      await expect(
        createRerunWorkflowRun({
          workflowRunId: succeeded.id,
          mode: 'failed',
          actorUserId: crypto.randomUUID(),
        }),
      ).rejects.toBeInstanceOf(NoFailedJobsError);
    });

    test('rejects a missing source run', async () => {
      await expect(
        createRerunWorkflowRun({
          workflowRunId: crypto.randomUUID(),
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

  describe('resolveJobStatusFromJobExecutions', () => {
    function execution(status: 'succeeded' | 'failed' | 'cancelled'): JobExecution {
      return {
        id: crypto.randomUUID(),
        jobId: crypto.randomUUID(),
        sequence: 1,
        name: 'build',
        status,
        statusReason: status === 'failed' ? 'step_failed' : null,
        triggerEvents: [],
        version: 1,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        queuedAt: null,
        startedAt: null,
        finishedAt: null,
        timedOutAt: null,
      };
    }

    test('treats zero or cancelled listener executions as successful by default', () => {
      const empty = evaluateJobSuccess({success: null, executions: []});
      const cancelled = evaluateJobSuccess({success: null, executions: [execution('cancelled')]});

      expect(empty).toEqual({status: 'succeeded', statusReason: null});
      expect(cancelled).toEqual({status: 'succeeded', statusReason: null});
    });

    test('fails closed when a job has no executions', async () => {
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
      const [existingJob] = await getJobsByWorkflowRunId(run.id);
      if (!existingJob) throw new Error('Expected workflow job');
      const [job] = await db()
        .insert(jobs)
        .values({
          workflowRunAttemptId: existingJob.workflowRunAttemptId,
          key: 'no-execution',
          name: null,
          checkoutPersistCredentials: true,
          checkoutPermissionsContents: 'read',
          dependencies: [],
          runner: ['ubuntu-latest'],
          position: 99,
        })
        .returning();
      if (!job) throw new Error('Expected workflow job');

      const resolve = resolveJobStatusFromJobExecutions({jobId: job.id});

      await expect(resolve).rejects.toThrow('no job executions found');
    });

    test('resolves the default success expression over execution rows', async () => {
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
      const job = (await getJobsByWorkflowRunId(run.id))[0];
      if (!job) throw new Error('Expected workflow job');
      const jobExecution = await getFirstJobExecutionByJobId(job.id);
      if (!jobExecution) throw new Error('Expected workflow job execution');
      await updateJobExecutionStatus({
        jobExecutionId: jobExecution.id,
        status: 'succeeded',
        expectedVersion: jobExecution.version,
      });

      const resolved = await resolveJobStatusFromJobExecutions({jobId: job.id});

      expect(resolved.status).toBe('succeeded');
      expect((await getJobsByWorkflowRunId(run.id))[0]).toMatchObject({status: 'succeeded'});
    });

    test('fails the job when the default success expression is false', async () => {
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
      const job = (await getJobsByWorkflowRunId(run.id))[0];
      if (!job) throw new Error('Expected workflow job');
      const jobExecution = await getFirstJobExecutionByJobId(job.id);
      if (!jobExecution) throw new Error('Expected workflow job execution');
      await updateJobExecutionStatus({
        jobExecutionId: jobExecution.id,
        status: 'failed',
        expectedVersion: jobExecution.version,
        statusReason: 'step_failed',
      });

      const resolved = await resolveJobStatusFromJobExecutions({jobId: job.id});

      expect(resolved.status).toBe('failed');
      expect((await getJobsByWorkflowRunId(run.id))[0]).toMatchObject({
        status: 'failed',
        statusReason: 'step_failed',
      });
    });

    test('resolves custom job success expressions over execution rows', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({
          jobs: {
            build: {
              success: 'executions.exists(e, e.status == "failed")',
              steps: [{run: 'npm test'}],
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
      const job = (await getJobsByWorkflowRunId(run.id))[0];
      if (!job) throw new Error('Expected workflow job');
      const jobExecution = await getFirstJobExecutionByJobId(job.id);
      if (!jobExecution) throw new Error('Expected workflow job execution');
      await updateJobExecutionStatus({
        jobExecutionId: jobExecution.id,
        status: 'failed',
        expectedVersion: jobExecution.version,
        statusReason: 'step_failed',
      });

      const resolved = await resolveJobStatusFromJobExecutions({jobId: job.id});

      expect(resolved.status).toBe('succeeded');
      expect((await getJobsByWorkflowRunId(run.id))[0]).toMatchObject({
        status: 'succeeded',
        statusReason: null,
      });
    });

    test('resolves a custom success expression over the full execution shape', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({
          jobs: {
            build: {
              name: 'Build',
              success: 'executions.all(e, e.status == "succeeded" && e.name == "Build")',
              steps: [{run: 'npm test'}],
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
      const job = (await getJobsByWorkflowRunId(run.id))[0];
      if (!job) throw new Error('Expected workflow job');
      const jobExecution = await getFirstJobExecutionByJobId(job.id);
      if (!jobExecution) throw new Error('Expected workflow job execution');
      await updateJobExecutionStatus({
        jobExecutionId: jobExecution.id,
        status: 'succeeded',
        expectedVersion: jobExecution.version,
      });

      const resolved = await resolveJobStatusFromJobExecutions({jobId: job.id});

      expect(resolved.status).toBe('succeeded');
    });

    test('fails closed when the success expression throws at runtime', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({
          jobs: {
            build: {
              success: 'executions.all(e, 1 / 0 == 0)',
              steps: [{run: 'npm test'}],
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
      const job = (await getJobsByWorkflowRunId(run.id))[0];
      if (!job) throw new Error('Expected workflow job');
      const jobExecution = await getFirstJobExecutionByJobId(job.id);
      if (!jobExecution) throw new Error('Expected workflow job execution');
      await updateJobExecutionStatus({
        jobExecutionId: jobExecution.id,
        status: 'succeeded',
        expectedVersion: jobExecution.version,
      });

      const resolved = await resolveJobStatusFromJobExecutions({jobId: job.id});
      const resolvedJob = (await getJobsByWorkflowRunId(run.id))[0];

      expect(resolved.status).toBe('failed');
      expect(resolvedJob).toMatchObject({
        status: 'failed',
        statusReason: 'unknown',
      });
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
        workflowRunId: run.id,
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
      const job = (await getJobsByWorkflowRunId(run.id))[0];

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
        updateWorkflowRunStatus({workflowRunId: run.id, status: 'running', expectedVersion: 99}),
      ).rejects.toThrow('Optimistic lock failure');
    });

    test('throws when run not found', async () => {
      await expect(
        updateWorkflowRunStatus({
          workflowRunId: crypto.randomUUID(),
          status: 'running',
          expectedVersion: 1,
        }),
      ).rejects.toThrow('Workflow run not found');
    });

    test.each([
      'succeeded',
      'failed',
      'cancelled',
    ] as const)('writes one run-terminated event when the status becomes %s', async (status) => {
      const run = await createTestRun({workspaceId, projectId, definitionId});

      await updateWorkflowRunStatus({workflowRunId: run.id, status, expectedVersion: 1});

      const events = await runTerminatedEvents(run.id);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({workflowRunId: run.id, projectId: run.projectId, status});
    });

    test('writes no run-terminated event for a non-terminal transition', async () => {
      const run = await createTestRun({workspaceId, projectId, definitionId});

      await updateWorkflowRunStatus({workflowRunId: run.id, status: 'running', expectedVersion: 1});

      expect(await runTerminatedEvents(run.id)).toHaveLength(0);
    });

    test('does not mirror a non-current attempt terminal update to the run', async () => {
      const run = await createTestRun({workspaceId, projectId, definitionId});
      const attempts = await listRunAttempts({workflowRunId: run.id, projectId});
      const firstAttempt = attempts[0];
      if (!firstAttempt) throw new Error('Expected initial attempt');
      await db().insert(workflowRunAttempts).values({
        workflowRunId: run.id,
        attempt: 2,
        status: 'succeeded',
      });
      await db()
        .update(workflowRuns)
        .set({currentAttempt: 2, status: 'succeeded'})
        .where(eq(workflowRuns.id, run.id));

      const staleUpdate = await updateWorkflowRunStatus({
        workflowRunAttemptId: firstAttempt.id,
        status: 'failed',
        expectedVersion: 1,
      });

      expect(staleUpdate.status).toBe('succeeded');
      expect(await getWorkflowRunById(run.id)).toMatchObject({
        status: 'succeeded',
        currentAttempt: 2,
      });
      expect(await runTerminatedEvents(run.id)).toHaveLength(0);
    });

    test('idempotent retry: a second terminal update at the stale version emits once', async () => {
      const run = await createTestRun({workspaceId, projectId, definitionId});

      const first = await updateWorkflowRunStatus({
        workflowRunId: run.id,
        status: 'failed',
        expectedVersion: 1,
      });
      const retry = await updateWorkflowRunStatus({
        workflowRunId: run.id,
        status: 'failed',
        expectedVersion: 1,
      });

      expect(retry.version).toBe(first.version);
      expect(await runTerminatedEvents(run.id)).toHaveLength(1);
    });

    test('terminal-tolerant mismatch: existing terminal run returns without re-emitting', async () => {
      const run = await createTestRun({workspaceId, projectId, definitionId});
      const cancelled = await updateWorkflowRunStatus({
        workflowRunId: run.id,
        status: 'cancelled',
        expectedVersion: 1,
      });

      const retry = await updateWorkflowRunStatus({
        workflowRunId: run.id,
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
        workflowRunId: run.id,
        status: 'cancelled',
        expectedVersion: 1,
      });

      const retry = await updateWorkflowRunStatus({
        workflowRunId: run.id,
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
      await updateWorkflowRunStatus({workflowRunId: run.id, status: 'running', expectedVersion: 1});
      const [runningJobExecution, succeededJob, skippedJob] = await getJobsByWorkflowRunId(run.id);
      if (!runningJobExecution || !succeededJob || !skippedJob) throw new Error('Expected jobs');
      await updateJobStatus({jobId: runningJobExecution.id, status: 'running', expectedVersion: 1});
      await nextStepForJob(runningJobExecution.id);
      await updateJobStatus({jobId: succeededJob.id, status: 'succeeded', expectedVersion: 1});
      await updateJobStatus({
        jobId: skippedJob.id,
        status: 'skipped',
        expectedVersion: 1,
        statusReason: 'dependency_not_completed',
      });

      const cancelled = await cancelWorkflowRun({workflowRunId: run.id});

      expect(cancelled.status).toBe('cancelled');
      expect(cancelled.finishedAt).not.toBeNull();
      const [finalRunning, finalSucceeded, finalSkipped] = await getJobsByWorkflowRunId(run.id);
      expect(finalRunning).toMatchObject({status: 'cancelled', statusReason: 'run_cancelled'});
      expect(finalSucceeded).toMatchObject({status: 'succeeded', statusReason: null});
      expect(finalSkipped).toMatchObject({
        status: 'skipped',
        statusReason: 'dependency_not_completed',
      });
      expect((await getStepsByJobId(runningJobExecution.id)).map((step) => step.status)).toEqual([
        'cancelled',
        'cancelled',
        'cancelled',
      ]);
      expect(
        (await getStepsByJobId(skippedJob.id)).every((step) => step.status === 'pending'),
      ).toBe(true);
      expect(await runTerminatedEvents(run.id)).toEqual([
        expect.objectContaining({workflowRunId: run.id, projectId, status: 'cancelled'}),
      ]);
      expect(await runCancelledEvents(run.id)).toEqual([
        expect.objectContaining({workflowRunId: run.id, projectId}),
      ]);
      expect(await jobTerminatedEvents(runningJobExecution.id)).toEqual([
        expect.objectContaining({
          jobId: runningJobExecution.id,
          workflowRunId: run.id,
          status: 'cancelled',
          statusReason: 'run_cancelled',
        }),
      ]);
      expect(await stepAttemptTerminatedEvents(runningJobExecution.id)).toHaveLength(1);
      expect(await jobTerminatedEvents(succeededJob.id)).toHaveLength(1);
      expect(await jobTerminatedEvents(skippedJob.id)).toHaveLength(1);
    });

    test('cancels the current rerun attempt after current_attempt moves', async () => {
      const run = await createTestRun({workspaceId, projectId, definitionId});
      await updateWorkflowRunStatus({workflowRunId: run.id, status: 'failed', expectedVersion: 1});
      const firstAttempt = (await listRunAttempts({workflowRunId: run.id, projectId}))[0];
      if (!firstAttempt) throw new Error('Expected initial attempt');
      await createRerunWorkflowRun({
        workflowRunId: run.id,
        mode: 'all',
        actorUserId: crypto.randomUUID(),
      });
      const secondAttempt = (await listRunAttempts({workflowRunId: run.id, projectId})).find(
        (attempt) => attempt.attempt === 2,
      );
      if (!secondAttempt) throw new Error('Expected rerun attempt');
      await updateWorkflowRunStatus({workflowRunId: run.id, status: 'running', expectedVersion: 1});

      await cancelWorkflowRun({workflowRunId: run.id});

      expect(await runCancelledEvents(run.id)).toEqual([
        expect.objectContaining({
          workflowRunId: run.id,
          workflowRunAttemptId: secondAttempt.id,
          projectId,
        }),
      ]);
      const terminatedEvents = await runTerminatedEvents(run.id);
      expect(terminatedEvents).toHaveLength(2);
      expect(terminatedEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            workflowRunId: run.id,
            workflowRunAttemptId: firstAttempt.id,
            projectId,
            status: 'failed',
          }),
          expect.objectContaining({
            workflowRunId: run.id,
            workflowRunAttemptId: secondAttempt.id,
            projectId,
            status: 'cancelled',
          }),
        ]),
      );
    });

    test('throws without changing an already-terminal run', async () => {
      const run = await createTestRun({workspaceId, projectId, definitionId});
      const finished = await updateWorkflowRunStatus({
        workflowRunId: run.id,
        status: 'succeeded',
        expectedVersion: 1,
      });

      await expect(cancelWorkflowRun({workflowRunId: run.id})).rejects.toBeInstanceOf(
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
      const runJobs = await getJobsByWorkflowRunId(run.id);
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
      const job = (await getJobsByWorkflowRunId(run.id))[0];

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
      const runJobs = await getJobsByWorkflowRunId(run.id);

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
      const job = (await getJobsByWorkflowRunId(run.id))[0];
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
      const job = (await getJobsByWorkflowRunId(run.id))[0];
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
      const job = (await getJobsByWorkflowRunId(run.id))[0];
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
      expect((await getJobsByWorkflowRunId(run.id))[0]).toMatchObject({
        status: 'cancelled',
        version: cancelled.version,
      });
      expect(await jobTerminatedEvents(job?.id as string)).toHaveLength(1);
    });
  });

  describe('run lifecycle timing', () => {
    test('run: stamps started_at on running and preserves it through the terminal transition', async () => {
      const run = await createTestRun({workspaceId, projectId, definitionId});

      const running = await updateWorkflowRunStatus({
        workflowRunId: run.id,
        status: 'running',
        expectedVersion: 1,
      });

      expect(running.startedAt).not.toBeNull();
      expect(running.finishedAt).toBeNull();

      const finished = await updateWorkflowRunStatus({
        workflowRunId: run.id,
        status: 'succeeded',
        expectedVersion: 2,
      });

      expect(finished.finishedAt).not.toBeNull();
      expect(finished.startedAt?.getTime()).toBe(running.startedAt?.getTime());
    });

    test('run: cancelled straight from pending has no start but a finish', async () => {
      const run = await createTestRun({workspaceId, projectId, definitionId});

      const cancelled = await updateWorkflowRunStatus({
        workflowRunId: run.id,
        status: 'cancelled',
        expectedVersion: 1,
      });

      expect(cancelled.startedAt).toBeNull();
      expect(cancelled.finishedAt).not.toBeNull();
    });

    test('run: re-entering running keeps the first started_at (coalesce, not a fresh clock)', async () => {
      const run = await createTestRun({workspaceId, projectId, definitionId});
      const firstRunning = await updateWorkflowRunStatus({
        workflowRunId: run.id,
        status: 'running',
        expectedVersion: 1,
      });

      const secondRunning = await updateWorkflowRunStatus({
        workflowRunId: run.id,
        status: 'running',
        expectedVersion: 2,
      });

      expect(secondRunning.startedAt?.getTime()).toBe(firstRunning.startedAt?.getTime());
    });
  });

  describe('job terminal event (WORKFLOWS_JOB_TERMINATED)', () => {
    async function seedPendingJob() {
      const run = await createTestRun({workspaceId, projectId, definitionId});
      const jobId = (await getJobsByWorkflowRunId(run.id))[0]?.id as string;
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
      expect(events[0]).toMatchObject({jobId, workflowRunId: run.id, status, statusReason: null});
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
      expect(events[0]).toMatchObject({
        jobId,
        workflowRunId: run.id,
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

      await bulkUpdateJobStepStatuses({jobId, status: 'failed'});

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
