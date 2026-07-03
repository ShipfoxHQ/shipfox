import type {AgentDefaultsResolver} from '@shipfox/api-agent/core/resolve-agent-config';
import type {WorkflowModel} from '@shipfox/api-definitions';
import {
  type MaterializedWorkflowStep,
  materializeJobExecutionSteps,
} from './materialize-job-execution-steps.js';
import type {WorkflowEvaluationContext} from './workflow-evaluation-context.js';

type WorkflowModelJob = WorkflowModel['jobs'][number];
export interface MaterializedWorkflowJob {
  readonly key: string;
  readonly mode: WorkflowModelJob['mode'];
  readonly success?: string;
  readonly executionTimeoutMs?: number;
  readonly checkout: WorkflowModelJob['checkout'];
  readonly listening?: WorkflowModelJob['listening'];
  readonly name?: WorkflowModelJob['name'];
  readonly dependencies: readonly string[];
  readonly runner: readonly string[];
  readonly position: number;
  readonly steps: readonly MaterializedWorkflowStep[];
}

export interface MaterializeWorkflowModelParams {
  readonly model: WorkflowModel;
  readonly context?: WorkflowEvaluationContext | undefined;
  readonly resolveAgentDefaults?: AgentDefaultsResolver | undefined;
  readonly definitionId?: string | undefined;
}

export function materializeWorkflowModel(
  params: MaterializeWorkflowModelParams,
): readonly MaterializedWorkflowJob[] {
  const {
    model,
    context = {site: 'run-creation', values: {}},
    resolveAgentDefaults,
    definitionId = model.name,
  } = params;
  const jobsById = new Map(model.jobs.map((job) => [job.id, job]));

  return model.jobs.map((job, position) => ({
    key: job.key,
    mode: job.mode,
    ...(job.success === undefined ? {} : {success: job.success}),
    ...(job.executionTimeoutMs === undefined ? {} : {executionTimeoutMs: job.executionTimeoutMs}),
    checkout: job.checkout,
    ...(job.listening === undefined ? {} : {listening: job.listening}),
    ...(job.name === undefined ? {} : {name: job.name}),
    dependencies: dependencySourceNames(job, jobsById),
    runner: job.runner,
    position,
    steps:
      job.mode === 'listening'
        ? []
        : materializeJobExecutionSteps({
            model,
            job,
            context,
            resolveAgentDefaults,
            definitionId,
          }),
  }));
}

export function modelHasAgentStep(model: WorkflowModel): boolean {
  return model.jobs.some((job) => job.steps.some((step) => step.kind === 'agent'));
}

function dependencySourceNames(
  job: WorkflowModelJob,
  jobsById: ReadonlyMap<string, WorkflowModelJob>,
): readonly string[] {
  return job.dependencies.map((dependencyId) => {
    const dependency = jobsById.get(dependencyId);
    if (!dependency) {
      throw new Error(`Unresolved workflow model dependency "${dependencyId}" for job "${job.id}"`);
    }
    return dependency.key;
  });
}
