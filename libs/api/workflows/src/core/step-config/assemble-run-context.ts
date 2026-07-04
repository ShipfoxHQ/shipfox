import type {WorkflowExpressionEvaluationContext} from '@shipfox/expression';
import type {JobExecution} from '#core/entities/job-execution.js';
import type {TriggerPayload, WorkflowRun} from '#core/entities/workflow-run.js';
import type {WorkflowEvaluationContext} from './workflow-evaluation-context.js';

export interface AssembleWorkflowRunContextParams {
  readonly run: Pick<
    WorkflowRun,
    'id' | 'name' | 'definitionId' | 'projectId' | 'workspaceId' | 'createdAt'
  >;
  readonly triggerPayload: TriggerPayload;
  readonly inputs?: Record<string, unknown> | null | undefined;
}

export function assembleWorkflowRunContext(
  params: AssembleWorkflowRunContextParams,
): WorkflowExpressionEvaluationContext {
  return {
    run: {
      id: params.run.id,
      name: params.run.name,
      definition_id: params.run.definitionId,
      project_id: params.run.projectId,
      workspace_id: params.run.workspaceId,
      created_at: params.run.createdAt,
    },
    trigger: {
      source: params.triggerPayload.source,
      event: params.triggerPayload.event,
    },
    event: 'data' in params.triggerPayload ? params.triggerPayload.data : null,
    inputs: params.inputs ?? null,
  };
}

export function assembleCreationContext(
  params: AssembleWorkflowRunContextParams,
): WorkflowEvaluationContext {
  return {
    site: 'run-creation',
    values: assembleWorkflowRunContext(params),
  };
}

/**
 * Keeps job-success predicate values aligned with the registry's `executions`
 * type environment.
 */
export function assembleExecutionsContext(
  executions: readonly JobExecution[],
): WorkflowExpressionEvaluationContext {
  return {
    executions: executions.map((execution, index) => ({
      index,
      name: execution.name,
      status: execution.status,
      started_at: execution.startedAt,
      finished_at: execution.finishedAt,
      events: execution.triggerEvents,
    })),
  };
}
