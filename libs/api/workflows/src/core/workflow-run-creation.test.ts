import type {WorkflowModel} from '@shipfox/api-definitions';
import {buildModel, template} from '#test/helpers/workflow-runs.js';
import type {TriggerPayload, WorkflowRun} from './entities/workflow-run.js';
import {
  deriveInitialJobExecutionPlan,
  materializeWorkflowRunJobs,
} from './workflow-run-creation.js';

const triggerPayload: TriggerPayload = {
  source: 'manual',
  event: 'fire',
  subscriptionId: 'subscription-1',
  userId: 'user-1',
};

describe('deriveInitialJobExecutionPlan', () => {
  it('resolves initial execution name and runner templates from creation context', () => {
    const model = buildModel({
      jobs: {
        deploy: {
          name: `Deploy ${template('inputs.environment')}`,
          runner: ['linux'],
          runnerTemplates: [template('inputs.runner')],
          steps: [{run: 'echo deploy'}],
        },
      },
    });
    const run = workflowRun({inputs: {environment: 'prod', runner: 'GPU'}});
    const {modelJob, job} = materializedJob(model, run, {inputs: run.inputs});

    const plan = deriveInitialJobExecutionPlan({
      run,
      modelJob,
      job,
      jobId: 'job-1',
      sequence: 1,
      fallbackName: 'deploy #1',
      triggerPayload,
      inputs: run.inputs,
    });

    expect(plan).toMatchObject({
      name: 'Deploy prod',
      runner: ['gpu', 'linux'],
      evaluationTrace: [
        {
          expression: 'inputs.environment',
          roots: ['inputs'],
          fillTarget: 'run-creation',
          evaluatedAt: 'execution-creation',
          value: 'prod',
          field: 'job.name',
        },
      ],
    });
  });

  it('resolves variables referenced only by job runner templates', () => {
    const model = buildModel({
      jobs: {
        build: {
          runnerTemplates: [template('vars.RUNNER')],
          steps: [{run: 'echo build'}],
        },
      },
    });
    const run = workflowRun();
    const {modelJob, job} = materializedJob(model, run, {vars: {RUNNER: 'GPU'}});

    const plan = deriveInitialJobExecutionPlan({
      run,
      modelJob,
      job,
      jobId: 'job-1',
      sequence: 1,
      fallbackName: 'build #1',
      triggerPayload,
      vars: {RUNNER: 'GPU'},
    });

    expect(plan.runner).toEqual(['gpu', 'ubuntu-latest']);
  });

  it('uses the fallback name for execution-name self references', () => {
    const model = buildModel({
      jobs: {
        deploy: {
          name: `Current ${template('execution.name')}`,
          steps: [{run: 'echo deploy'}],
        },
      },
    });
    const run = workflowRun();
    const {modelJob, job} = materializedJob(model, run);

    const plan = deriveInitialJobExecutionPlan({
      run,
      modelJob,
      job,
      jobId: 'job-1',
      sequence: 1,
      fallbackName: 'deploy #1',
      triggerPayload,
    });

    expect(plan.name).toBe('Current deploy #1');
  });
});

function materializedJob(
  model: WorkflowModel,
  run: WorkflowRun,
  context: {
    inputs?: Record<string, unknown> | null | undefined;
    vars?: Record<string, string> | undefined;
  } = {},
) {
  const [job] = materializeWorkflowRunJobs({
    run,
    model,
    triggerPayload,
    inputs: context.inputs,
    vars: context.vars,
    definitionId: run.definitionId,
  });
  const [modelJob] = model.jobs;
  if (!job || !modelJob) throw new Error('Expected materialized job');
  return {job, modelJob};
}

function workflowRun(params: {inputs?: Record<string, unknown> | null} = {}): WorkflowRun {
  const now = new Date('2026-01-01T00:00:00.000Z');
  return {
    id: 'run-1',
    workspaceId: 'workspace-1',
    projectId: 'project-1',
    definitionId: 'definition-1',
    name: 'Test workflow',
    status: 'pending',
    currentAttempt: 1,
    triggerProvider: null,
    triggerSource: triggerPayload.source,
    triggerEvent: triggerPayload.event,
    triggerPayload,
    inputs: params.inputs ?? null,
    sourceSnapshot: null,
    triggerIdempotencyKey: null,
    timeoutMs: 60_000,
    version: 1,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    finishedAt: null,
  };
}
