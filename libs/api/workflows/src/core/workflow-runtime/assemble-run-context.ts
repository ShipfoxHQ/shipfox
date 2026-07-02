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
    phase: 'workflow-run-creation',
    values: assembleWorkflowRunContext(params),
  };
}

// Assemble the `executions` root for job-resolution predicates (job `success`).
// Mirrors the registry `executions` type environment field-for-field: `index` is the
// position in the resolution-ordered list, and `events` passes the execution's trigger
// events through unchanged (they already share the executionEvent shape).
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
