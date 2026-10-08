import {createWorkflowExpression} from '@shipfox/expression';
import type {Job} from '../entities/job.js';
import type {JobExecution} from '../entities/job-execution.js';
import type {WorkflowRun} from '../entities/workflow-run.js';
import {decideJobActivation} from './decide-job-activation.js';

describe('decideJobActivation', () => {
  test('starts a pending job without an activation condition', () => {
    const run = workflowRun();
    const job = workflowJob({key: 'build'});

    const decision = decideJobActivation({run, job, dependencies: []});

    expect(decision).toEqual({kind: 'start-job', jobId: job.id});
  });

  test('starts a failure-handling job when its dependency failed', () => {
    const run = workflowRun();
    const build = workflowJob({key: 'build', status: 'failed'});
    const notify = workflowJob({key: 'notify', dependencies: ['build']});

    const decision = decideJobActivation({
      run,
      job: notify,
      condition: expression('jobs.build.status == "failed"'),
      dependencies: [{job: build, executions: []}],
    });

    expect(decision).toEqual({kind: 'start-job', jobId: notify.id});
  });

  test('skips a conditional job when the predicate is false', () => {
    const run = workflowRun();
    const build = workflowJob({key: 'build', status: 'succeeded'});
    const notify = workflowJob({key: 'notify', dependencies: ['build']});

    const decision = decideJobActivation({
      run,
      job: notify,
      condition: expression('jobs.build.status == "failed"'),
      dependencies: [{job: build, executions: []}],
    });

    expect(decision).toEqual({
      kind: 'skip-job',
      jobId: notify.id,
      status: 'skipped',
      statusReason: 'condition_rejected',
      evaluationTrace: [
        expect.objectContaining({
          expression: 'jobs.build.status == "failed"',
          roots: ['jobs'],
          value: 'false',
          field: 'job.if',
        }),
      ],
    });
  });

  test('fails the job with condition_errored when the predicate cannot evaluate', () => {
    const run = workflowRun();
    const build = workflowJob({key: 'build', status: 'succeeded'});
    const notify = workflowJob({key: 'notify', dependencies: ['build']});

    const decision = decideJobActivation({
      run,
      job: notify,
      condition: expression('jobs.build.outputs.sha.missing == "abc123"'),
      dependencies: [{job: build, executions: []}],
    });

    expect(decision).toEqual({
      kind: 'fail-job',
      jobId: notify.id,
      status: 'failed',
      statusReason: 'condition_errored',
      statusReasonMessage: "The `if` of job `notify` can't be evaluated: No such key: sha",
      evaluationTrace: [
        expect.objectContaining({
          expression: 'jobs.build.outputs.sha.missing == "abc123"',
          roots: ['jobs'],
          value: 'false',
          degraded: true,
          field: 'job.if',
          error: {
            message: 'No such key: sha',
            path: 'jobs.build.outputs.sha',
            source: {kind: 'job', key: 'build', status: 'succeeded'},
          },
        }),
      ],
    });
  });

  test('names the skipped job whose output a failed condition reads', () => {
    const run = workflowRun();
    const write = workflowJob({key: 'write', status: 'skipped'});
    const notify = workflowJob({key: 'notify', dependencies: ['write']});

    const decision = decideJobActivation({
      run,
      job: notify,
      condition: expression('jobs.write.outputs.created_branch != ""'),
      dependencies: [{job: write, executions: []}],
    });

    expect(decision).toMatchObject({
      kind: 'fail-job',
      statusReason: 'condition_errored',
      evaluationTrace: [
        {
          error: {
            message: 'No such key: created_branch',
            path: 'jobs.write.outputs.created_branch',
            source: {kind: 'job', key: 'write', status: 'skipped'},
          },
        },
      ],
    });
  });

  test('returns terminal jobs unchanged', () => {
    const run = workflowRun();
    const job = workflowJob({key: 'build', status: 'skipped', version: 4});

    const decision = decideJobActivation({
      run,
      job,
      condition: expression('false'),
      dependencies: [],
    });

    expect(decision).toEqual({
      kind: 'terminal-job',
      jobId: job.id,
      status: 'skipped',
      jobVersion: 4,
    });
  });
});

function expression(source: string) {
  return createWorkflowExpression({source, check: {mode: 'syntax'}});
}

function workflowRun(): WorkflowRun {
  return {
    id: crypto.randomUUID(),
    number: 1,
    workspaceId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    definitionId: crypto.randomUUID(),
    name: 'Run',
    workflowName: 'Run',
    nameOverride: null,
    status: 'pending',
    origin: 'synced',
    devSource: null,
    currentAttempt: 1,
    triggerProvider: null,
    triggerSource: 'manual',
    triggerEvent: 'fire',
    triggerPayload: {
      source: 'manual',
      event: 'fire',
      subscriptionId: crypto.randomUUID(),
      userId: crypto.randomUUID(),
    },
    inputs: null,
    secretInputs: null,
    sourceSnapshot: null,
    triggerIdempotencyKey: null,
    timeoutMs: 3_600_000,
    version: 1,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    startedAt: null,
    finishedAt: null,
  };
}

function workflowJob(params: Partial<Job> & Pick<Job, 'key'>): Job {
  return {
    id: crypto.randomUUID(),
    workflowRunAttemptId: crypto.randomUUID(),
    key: params.key,
    mode: 'one_shot',
    name: null,
    status: params.status ?? 'pending',
    statusReason: null,
    carriedOver: false,
    checkout: {permissions: {contents: 'read'}, persistCredentials: true},
    success: null,
    evaluationTrace: null,
    executionTimeoutMs: null,
    listeningTimeoutMs: null,
    maxExecutions: null,
    onResolve: null,
    batchDebounceMs: null,
    batchMaxSize: null,
    batchMaxWaitMs: null,
    listenerStatus: 'inactive',
    resolutionReason: null,
    listeningOn: null,
    listeningUntil: null,
    outputs: params.outputs ?? null,
    dependencies: params.dependencies ?? [],
    runner: ['ubuntu-latest'],
    position: params.position ?? 0,
    version: params.version ?? 1,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

export function jobExecution(params: Partial<JobExecution> = {}): JobExecution {
  return {
    id: crypto.randomUUID(),
    jobId: params.jobId ?? crypto.randomUUID(),
    sequence: params.sequence ?? 1,
    nameOverride: params.nameOverride ?? params.name ?? 'build',
    name: params.name ?? 'build',
    runner: null,
    status: params.status ?? 'succeeded',
    statusReason: params.statusReason ?? null,
    outputs: params.outputs ?? null,
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
