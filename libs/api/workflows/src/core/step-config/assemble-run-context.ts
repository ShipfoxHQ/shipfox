import type {WorkflowExpressionEvaluationContext} from '@shipfox/expression';
import type {JobExecution} from '#core/entities/job-execution.js';
import type {Step, StepAttempt, StepStatus} from '#core/entities/step.js';
import type {TriggerPayload, WorkflowRun} from '#core/entities/workflow-run.js';
import type {WorkflowEvaluationContext} from './workflow-evaluation-context.js';

export interface AssembleWorkflowRunContextParams {
  readonly run: Pick<
    WorkflowRun,
    'id' | 'name' | 'definitionId' | 'projectId' | 'workspaceId' | 'createdAt'
  >;
  readonly triggerPayload: TriggerPayload;
  readonly inputs?: Record<string, unknown> | null | undefined;
  readonly vars?: Record<string, string> | undefined;
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
    ...(params.vars === undefined ? {} : {vars: params.vars}),
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

export function assembleStepDispatchContext(params: {
  readonly steps: readonly Step[];
  readonly attempts: readonly StepAttempt[];
  readonly targetStepId: string;
  readonly jobExecution?: JobExecution;
}): WorkflowEvaluationContext {
  const attemptsByStepId = new Map(
    params.attempts
      .filter((attempt) => attempt.status !== 'running')
      .map((attempt) => [attempt.stepId, attempt]),
  );
  const stepsContext: Record<string, {outputs: Record<string, unknown>}> = {};

  for (const step of params.steps) {
    if (step.id === params.targetStepId || step.key === null) continue;
    const attempt = attemptsByStepId.get(step.id);
    if (attempt === undefined) continue;
    stepsContext[step.key] = {outputs: attempt.output ?? {}};
  }

  return {
    site: 'step-dispatch',
    values: {
      ...(params.jobExecution === undefined
        ? {}
        : {
            execution: {
              index: params.jobExecution.sequence,
              name: params.jobExecution.name,
              status: params.jobExecution.status,
              started_at: params.jobExecution.startedAt,
              finished_at: params.jobExecution.finishedAt,
              events: params.jobExecution.triggerEvents,
            },
          }),
      steps: stepsContext,
    },
  };
}

export function assembleGateContext(params: {
  readonly status: StepStatus;
  readonly exitCode: number;
}): WorkflowEvaluationContext {
  return {
    site: 'step-report',
    values: {
      step: {
        exit_code: BigInt(params.exitCode),
        status: params.status,
      },
    },
  };
}

export function assembleJobResolutionContext(
  executions: readonly JobExecution[],
): WorkflowEvaluationContext {
  return {
    site: 'job-resolution',
    values: assembleExecutionsContext(executions),
  };
}
