import type {WorkflowModel} from '@shipfox/api-definitions';
import type {AgentDefaultsResolver} from './agent-defaults.js';
import type {
  AgentToolMaterializationContext,
  AgentToolMaterializationSnapshot,
} from './agent-tools.js';
import type {Job} from './entities/job.js';
import type {
  JobExecution,
  JobExecutionStatus,
  WorkflowExecutionEvent,
} from './entities/job-execution.js';
import type {PersistedEvaluationTraceEntry} from './entities/step.js';
import type {WorkflowRun} from './entities/workflow-run.js';
import {
  AgentConfigUnresolvableError,
  AgentIntegrationMaterializationError,
  InterpolationUnresolvableError,
  InvalidJobRunnerLabelsError,
} from './errors.js';
import {
  assembleExecutionCreationContext,
  type MaterializedWorkflowStep,
  materializeJobExecutionSteps,
  materializeJobRunner,
  resolveJobExecutionName,
} from './step-config/index.js';

export interface MaterializeListenerExecutionParams {
  readonly model: WorkflowModel | null;
  readonly run: Pick<
    WorkflowRun,
    | 'id'
    | 'name'
    | 'definitionId'
    | 'projectId'
    | 'workspaceId'
    | 'createdAt'
    | 'triggerPayload'
    | 'inputs'
  >;
  readonly job: Pick<Job, 'id' | 'key'>;
  readonly sequence: number;
  readonly triggerEvents: readonly WorkflowExecutionEvent[];
  readonly priorExecutions: readonly JobExecution[];
  readonly resolveAgentDefaults?: AgentDefaultsResolver | undefined;
  readonly agentToolContext?: AgentToolMaterializationContext | undefined;
  readonly agentToolSnapshot?: AgentToolMaterializationSnapshot | null | undefined;
}

export interface MaterializedListenerExecution {
  readonly name: string;
  readonly runner: readonly string[];
  readonly status: JobExecutionStatus;
  readonly statusReason: 'unknown' | null;
  readonly triggerEvents: readonly WorkflowExecutionEvent[];
  readonly evaluationTrace: readonly PersistedEvaluationTraceEntry[] | null;
  readonly steps: readonly MaterializedWorkflowStep[];
}

export async function materializeListenerExecution(
  params: MaterializeListenerExecutionParams,
): Promise<MaterializedListenerExecution> {
  const fallbackName = `${params.job.key} #${params.sequence}`;
  let executionName = fallbackName;
  let evaluationTrace: readonly PersistedEvaluationTraceEntry[] = [];
  let runner: readonly string[] = [];
  let steps: readonly MaterializedWorkflowStep[] = [];
  let status: JobExecutionStatus = 'pending';

  try {
    if (!params.model) throw new PermanentListenerMaterializationError('Run attempt has no model');
    const modelJob = params.model.jobs.find((job) => job.key === params.job.key);
    if (!modelJob) {
      throw new PermanentListenerMaterializationError(
        `Workflow model has no job key: ${params.job.key}`,
      );
    }

    const resolvedName = resolveJobExecutionName({
      definitionId: params.run.definitionId,
      job: modelJob,
      fallbackName,
      context: listenerExecutionContext({...params, executionName, status}).values,
    });
    executionName = resolvedName.value;
    evaluationTrace = resolvedName.trace;

    const context = listenerExecutionContext({...params, executionName, status});
    runner = materializeJobRunner({
      job: modelJob,
      context,
      definitionId: params.run.definitionId,
    });
    steps = await materializeJobExecutionSteps({
      model: params.model,
      job: modelJob,
      context,
      resolveAgentDefaults: params.resolveAgentDefaults,
      definitionId: params.run.definitionId,
      agentToolContext: params.agentToolContext,
      agentToolSnapshot: params.agentToolSnapshot,
    });
  } catch (error) {
    if (!isPermanentListenerMaterializationError(error)) throw error;
    status = 'failed';
    steps = [];
    runner = [];
  }

  return {
    name: executionName,
    runner,
    status,
    statusReason: status === 'failed' ? 'unknown' : null,
    triggerEvents: params.triggerEvents,
    evaluationTrace: evaluationTrace.length === 0 ? null : evaluationTrace,
    steps,
  };
}

function listenerExecutionContext(
  params: Pick<
    MaterializeListenerExecutionParams,
    'run' | 'job' | 'sequence' | 'triggerEvents' | 'priorExecutions'
  > & {
    readonly executionName: string;
    readonly status: JobExecutionStatus;
  },
) {
  return assembleExecutionCreationContext({
    run: params.run,
    triggerPayload: params.run.triggerPayload,
    inputs: params.run.inputs,
    jobId: params.job.id,
    sequence: params.sequence,
    executionName: params.executionName,
    status: params.status,
    triggerEvents: params.triggerEvents,
    priorExecutions: params.priorExecutions,
  });
}

class PermanentListenerMaterializationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentListenerMaterializationError';
  }
}

function isPermanentListenerMaterializationError(error: unknown): boolean {
  return (
    error instanceof PermanentListenerMaterializationError ||
    error instanceof InterpolationUnresolvableError ||
    error instanceof InvalidJobRunnerLabelsError ||
    error instanceof AgentConfigUnresolvableError ||
    error instanceof AgentIntegrationMaterializationError
  );
}
