import {
  type AgentDefaultsResolver,
  catalogDefaultAgentResolver,
} from '@shipfox/api-agent/core/resolve-agent-config';
import type {WorkflowModel} from '@shipfox/api-definitions-dto';
import type {
  AgentToolMaterializationContext,
  AgentToolMaterializationSnapshot,
} from './agent-tools.js';
import type {JobExecution} from './entities/job-execution.js';
import type {TriggerPayload, WorkflowRun} from './entities/workflow-run.js';
import {
  assembleCreationContext,
  assembleExecutionCreationContext,
} from './step-config/assemble-run-context.js';
import {
  type MaterializedWorkflowJob,
  materializeJobRunner,
  materializeWorkflowModel,
} from './step-config/materialize-workflow-model.js';
import {resolveJobExecutionName} from './step-config/resolve-job-execution-name.js';

export function materializeWorkflowRunJobs(params: {
  run: WorkflowRun;
  model: WorkflowModel;
  triggerPayload: TriggerPayload;
  inputs?: Record<string, unknown> | null | undefined;
  vars?: Record<string, string> | undefined;
  resolveAgentDefaults?: AgentDefaultsResolver | undefined;
  definitionId: string;
  agentToolContext?: AgentToolMaterializationContext | undefined;
  agentToolSnapshot?: AgentToolMaterializationSnapshot | null | undefined;
}): readonly MaterializedWorkflowJob[] {
  const context = assembleCreationContext({
    run: params.run,
    triggerPayload: params.triggerPayload,
    inputs: params.inputs ?? null,
    vars: params.vars,
  });
  return materializeWorkflowModel({
    model: params.model,
    context,
    resolveAgentDefaults: params.resolveAgentDefaults ?? catalogDefaultAgentResolver,
    definitionId: params.definitionId,
    agentToolContext: params.agentToolContext,
    agentToolSnapshot: params.agentToolSnapshot,
  });
}

export function deriveInitialJobExecutionPlan(params: {
  run: WorkflowRun;
  modelJob: WorkflowModel['jobs'][number];
  job: MaterializedWorkflowJob;
  jobId: string;
  sequence: number;
  fallbackName: string;
  triggerPayload: TriggerPayload;
  inputs?: Record<string, unknown> | null | undefined;
  vars?: Record<string, string> | undefined;
}): {
  name: string;
  runner: readonly string[];
  evaluationTrace: JobExecution['evaluationTrace'];
} {
  const nameContext = assembleExecutionCreationContext({
    run: params.run,
    triggerPayload: params.triggerPayload,
    inputs: params.inputs ?? null,
    vars: params.vars,
    jobId: params.jobId,
    sequence: params.sequence,
    executionName: params.fallbackName,
    status: 'pending',
    triggerEvents: [],
    priorExecutions: [],
  });
  const resolvedName = resolveJobExecutionName({
    definitionId: params.run.definitionId,
    job: params.job,
    fallbackName: params.fallbackName,
    context: nameContext.values,
  });
  const runnerContext = assembleExecutionCreationContext({
    run: params.run,
    triggerPayload: params.triggerPayload,
    inputs: params.inputs ?? null,
    vars: params.vars,
    jobId: params.jobId,
    sequence: params.sequence,
    executionName: resolvedName.value,
    status: 'pending',
    triggerEvents: [],
    priorExecutions: [],
  });
  return {
    name: resolvedName.value,
    runner: materializeJobRunner({
      job: params.modelJob,
      context: runnerContext,
      definitionId: params.run.definitionId,
    }),
    evaluationTrace: resolvedName.trace,
  };
}

export function deriveJobExecutionRunner(params: {
  run: WorkflowRun;
  modelJob: WorkflowModel['jobs'][number];
  jobId: string;
  sequence: number;
  executionName: string;
  status: JobExecution['status'];
  triggerEvents?: readonly JobExecution['triggerEvents'][number][] | undefined;
  priorExecutions?: readonly JobExecution[] | undefined;
}): readonly string[] {
  return materializeJobRunner({
    job: params.modelJob,
    context: assembleExecutionCreationContext({
      run: params.run,
      triggerPayload: params.run.triggerPayload,
      inputs: params.run.inputs,
      jobId: params.jobId,
      sequence: params.sequence,
      executionName: params.executionName,
      status: params.status,
      triggerEvents: params.triggerEvents ?? [],
      priorExecutions: params.priorExecutions ?? [],
    }),
    definitionId: params.run.definitionId,
  });
}
