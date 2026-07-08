import type {WorkflowModel} from '@shipfox/api-definitions';
import type {Job} from '../entities/job.js';
import type {JobExecution} from '../entities/job-execution.js';
import type {Step, StepAttempt} from '../entities/step.js';
import type {WorkflowRun} from '../entities/workflow-run.js';
import {
  assembleExecutionResolutionContext,
  type JobContextInput,
} from '../step-config/assemble-run-context.js';
import {materializeJobOutputs} from '../step-config/materialize-workflow-model.js';

export function deriveJobExecutionOutputs(params: {
  run: WorkflowRun;
  modelJob: WorkflowModel['jobs'][number];
  job: Job;
  jobExecution: JobExecution;
  executions: readonly JobExecution[];
  steps: readonly Step[];
  attempts: readonly StepAttempt[];
  jobs: readonly JobContextInput[];
  vars?: Record<string, string> | undefined;
}): Record<string, unknown> | null {
  const context = assembleExecutionResolutionContext({
    run: params.run,
    triggerPayload: params.run.triggerPayload,
    inputs: params.run.inputs,
    vars: params.vars,
    job: params.job,
    jobExecution: params.jobExecution,
    executions: params.executions,
    steps: params.steps,
    attempts: params.attempts,
    jobs: params.jobs,
  });

  return materializeJobOutputs({
    job: params.modelJob,
    context,
    definitionId: params.run.definitionId,
  });
}
